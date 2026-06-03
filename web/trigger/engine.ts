import { schemaTask, logger, metadata } from "@trigger.dev/sdk";
import { z } from "zod";
import { engineDb } from "../lib/engine/supabase";
import { runMultiTradeScan, type ScanDoc, type TradeInput } from "../lib/engine/scan";
import { runWtPipeline, type PipelineDoc } from "../lib/engine/wt-pipeline";
import { loadWtPricingDNA } from "../lib/engine/pricing";
import { priceScope } from "../lib/engine/price";
import { mergeToBase64 } from "../lib/engine/pdf";
import { extractPricingDna } from "../lib/engine/extract-pricing";
import type { WtVerticalConfig } from "../lib/engine/extract";

/**
 * engine.scan-request — read the uploaded package ONCE and score every trade.
 * Writes per-trade bid/no-bid to bid_requests.trade_scores, flips status to
 * needs_review, then triggers engine.extract-bid for each bid trade (extraction +
 * pricing runs in the background; the admin reviews priced drafts).
 */
export const scanRequest = schemaTask({
  id: "engine.scan-request",
  machine: { preset: "medium-1x" }, // pdf-lib loads big packages into memory
  maxDuration: 1800,
  schema: z.object({ bidRequestId: z.string().uuid() }),
  run: async ({ bidRequestId }) => {
    const db = engineDb();
    metadata.set("status", "loading");

    // Active trade catalog → relevance inputs from each VerticalConfig.
    const { data: trades, error: tErr } = await db.from("trades").select("slug, label, vertical_config").eq("active", true);
    if (tErr) throw new Error(`load trades: ${tErr.message}`);
    const tradeInputs: TradeInput[] = (trades ?? []).map((t) => {
      const vc = (t.vertical_config ?? {}) as any;
      return {
        slug: t.slug,
        label: t.label,
        keywords: vc.router?.keywords ?? [],
        negativeKeywords: vc.router?.negativeKeywords ?? [],
        noBidSignals: vc.noBidSignals ?? [],
        disambiguation: vc.disambiguation,
      };
    });

    // Documents for this request → download from Storage.
    const { data: docs, error: dErr } = await db
      .from("documents")
      .select("id, filename, storage_path")
      .eq("bid_request_id", bidRequestId);
    if (dErr) throw new Error(`load documents: ${dErr.message}`);
    if (!docs?.length) throw new Error("no documents for this bid request");

    const scanDocs: ScanDoc[] = [];
    for (const d of docs) {
      const { data: blob, error } = await db.storage.from("bid-docs").download(d.storage_path);
      if (error || !blob) throw new Error(`download ${d.filename}: ${error?.message}`);
      scanDocs.push({ id: d.id, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }

    logger.info("Scanning package", { docs: scanDocs.length, trades: tradeInputs.length });
    metadata.set("status", "scanning");

    const result = await runMultiTradeScan(scanDocs, tradeInputs);

    const bidTrades = result.trades.filter((t) => t.relevance === "bid");
    logger.info("Scan complete", {
      bid: bidTrades.map((t) => `${t.slug} (${Math.round(t.confidence * 100)}%)`),
      noBid: result.trades.filter((t) => t.relevance === "no_bid").map((t) => t.slug),
      contacts: result.contacts.length,
      tokens: result.usage,
    });

    const { error: uErr } = await db
      .from("bid_requests")
      .update({ trade_scores: result.trades, status: "needs_review" })
      .eq("id", bidRequestId);
    if (uErr) throw new Error(`write trade_scores: ${uErr.message}`);

    metadata.set("status", "needs_review");

    // Extraction + pricing per bid trade (background). Window-treatments has the
    // full pipe in Stage 1; other trades no-op until their verticals land (Stage 3).
    if (bidTrades.length) {
      await extractBid.batchTrigger(bidTrades.map((t) => ({ payload: { bidRequestId, tradeSlug: t.slug } })));
    }

    return {
      bidTrades: bidTrades.map((t) => t.slug),
      tradeScores: result.trades.map((t) => ({ slug: t.slug, relevance: t.relevance, confidence: t.confidence })),
      contacts: result.contacts,
    };
  },
});

/**
 * engine.extract-bid — for ONE bid trade: extract a priceable scope from the pages
 * the scan flagged, deterministically price it from each in-range contractor's
 * Pricing DNA, and write the extraction + draft bids (+ line items) + gaps +
 * contacts. The admin then reviews and dispatches. Window-treatments only in
 * Stage 1; other verticals return early until their extraction pipes are built.
 */
export const extractBid = schemaTask({
  id: "engine.extract-bid",
  machine: { preset: "medium-1x" }, // tiled rendering (mupdf + sharp) is memory-hungry
  maxDuration: 1800,
  retry: { maxAttempts: 1 }, // expensive (Opus + tiled vision) — don't multiply spend on a bad run

  schema: z.object({ bidRequestId: z.string().uuid(), tradeSlug: z.string() }),
  run: async ({ bidRequestId, tradeSlug }) => {
    const db = engineDb();

    const { data: trade, error: tErr } = await db
      .from("trades")
      .select("id, slug, label, vertical_config")
      .eq("slug", tradeSlug)
      .single();
    if (tErr || !trade) throw new Error(`load trade ${tradeSlug}: ${tErr?.message}`);

    if (tradeSlug !== "window-treatments") {
      logger.info("No extraction pipe for this trade yet — skipping", { tradeSlug });
      return { skipped: true, reason: "vertical not yet implemented (Stage 3)" };
    }

    const cfg = (trade.vertical_config ?? {}) as WtVerticalConfig;

    // Pull the scan's per-trade relevant pages (grouped by document).
    const { data: req, error: rErr } = await db
      .from("bid_requests")
      .select("trade_scores, doc_gaps")
      .eq("id", bidRequestId)
      .single();
    if (rErr || !req) throw new Error(`load bid request: ${rErr?.message}`);
    const scores = (Array.isArray(req.trade_scores) ? req.trade_scores : []) as {
      slug: string;
      relevantPages?: { documentId: string; page: number; kind: string }[];
    }[];
    const thisScore = scores.find((s) => s.slug === tradeSlug);
    const relevant = thisScore?.relevantPages ?? [];

    // Download docs and attach their relevant pages.
    const { data: docs, error: dErr } = await db
      .from("documents")
      .select("id, filename, storage_path")
      .eq("bid_request_id", bidRequestId);
    if (dErr) throw new Error(`load documents: ${dErr.message}`);
    if (!docs?.length) throw new Error("no documents for this bid request");

    const pipelineDocs: PipelineDoc[] = [];
    for (const d of docs) {
      const { data: blob, error } = await db.storage.from("bid-docs").download(d.storage_path);
      if (error || !blob) throw new Error(`download ${d.filename}: ${error?.message}`);
      pipelineDocs.push({
        id: d.id,
        bytes: new Uint8Array(await blob.arrayBuffer()),
        relevantPages: relevant.filter((p) => p.documentId === d.id).map((p) => ({ page: p.page, kind: p.kind })),
      });
    }

    metadata.set("status", "extracting");
    logger.info("Extracting window-treatments scope", { docs: pipelineDocs.length, relevantPages: relevant.length });

    const { extraction, scope, gaps, counts, usage } = await runWtPipeline(pipelineDocs, cfg);
    logger.info("Extraction complete", { counts, motorizedSets: scope.motorizedSets.length, blinds: scope.blinds.length, fixed: scope.fixedPanels, tokens: usage });

    // 1 · Persist the extraction artifact (one per request × trade).
    const { error: exErr } = await db.from("extractions").upsert(
      {
        bid_request_id: bidRequestId,
        trade_id: trade.id,
        relevance: extraction.bid ? "bid" : "no_bid",
        confidence: extraction.bidConfidence,
        result: extraction as unknown as Record<string, unknown>,
      },
      { onConflict: "bid_request_id,trade_id" },
    );
    if (exErr) throw new Error(`write extraction: ${exErr.message}`);

    // 2 · Merge gaps onto the request (replace this trade's gaps; keep others).
    const existingGaps = (Array.isArray(req.doc_gaps) ? req.doc_gaps : []) as { trade?: string }[];
    const otherGaps = existingGaps.filter((g) => g.trade !== tradeSlug);
    const taggedGaps = gaps.map((g) => ({ ...g, trade: tradeSlug }));
    const { error: gErr } = await db.from("bid_requests").update({ doc_gaps: [...otherGaps, ...taggedGaps] }).eq("id", bidRequestId);
    if (gErr) throw new Error(`write gaps: ${gErr.message}`);

    // 3 · In-range contractors for this trade → price each from their own DNA.
    const { data: coverage, error: cErr } = await db
      .from("workspace_trades")
      .select("workspace_id")
      .eq("trade_id", trade.id);
    if (cErr) throw new Error(`load coverage: ${cErr.message}`);

    const gc = extraction.contacts.find((c) => c.role === "GC" && c.email) ?? extraction.contacts.find((c) => c.email);
    const projectName = extraction.projectName ?? null;
    // Scope present but not quantifiable (named in keynotes, but no schedule/plan/
    // tags to count) → a no-price site-visit request instead of an install-only
    // floor. Shows we read the project and asks to field-measure. (SPEC-ADDITIONS #1)
    const quantifiable = scope.motorizedSets.length > 0 || scope.blinds.length > 0 || scope.fixedPanels > 0;
    const scopeSummary = extraction.bidReasoning;
    let bidsCreated = 0;

    for (const cov of coverage ?? []) {
      // Replace any prior draft for this (request, trade, contractor) so replays don't duplicate.
      await db.from("bids").delete().eq("bid_request_id", bidRequestId).eq("trade_id", trade.id).eq("workspace_id", cov.workspace_id).eq("status", "draft");

      if (!quantifiable) {
        // No Pricing DNA needed — there's no number to compute, just a visit ask.
        const { error: svErr } = await db.from("bids").insert({
          workspace_id: cov.workspace_id,
          bid_request_id: bidRequestId,
          trade_id: trade.id,
          status: "draft",
          kind: "site_visit",
          project_name: projectName,
          gc_contact_name: gc?.name ?? null,
          gc_contact_email: gc?.email ?? null,
          notes_to_gc: scopeSummary,
        });
        if (svErr) throw new Error(`create site-visit bid: ${svErr.message}`);
        bidsCreated++;
      } else {
        const dna = await loadWtPricingDNA(db, cov.workspace_id, trade.id);
        if (!dna) {
          logger.warn("Skipping contractor — incomplete Pricing DNA", { workspaceId: cov.workspace_id });
          continue;
        }
        const priced = priceScope(scope, dna);

        const { data: bid, error: bErr } = await db
          .from("bids")
          .insert({
            workspace_id: cov.workspace_id,
            bid_request_id: bidRequestId,
            trade_id: trade.id,
            status: "draft",
            kind: "priced",
            project_name: projectName,
            gc_contact_name: gc?.name ?? null,
            gc_contact_email: gc?.email ?? null,
            subtotal: priced.subtotal,
            discount_label: `${Math.round(priced.discountPct * 100)}%`,
            discount_amount: priced.discount,
            delivery_install: priced.installFee,
            tax_rate: dna.salesTaxRate,
            tax_amount: priced.tax,
            total: priced.total,
          })
          .select("id")
          .single();
        if (bErr || !bid) throw new Error(`create bid: ${bErr?.message}`);

        const lineRows = priced.lines.map((l, i) => ({
          bid_id: bid.id,
          sort_order: i,
          location: (l.attrs?.location as string) ?? null,
          type_code: l.code,
          description: l.label,
          qty: l.qty,
          unit: l.code === "FPS" ? "shade" : l.code === "MB" ? "blind" : "motor-set",
          unit_price: l.unitRate,
          amount: l.amount,
          attrs: l.attrs ?? {},
        }));
        if (lineRows.length) {
          const { error: liErr } = await db.from("bid_line_items").insert(lineRows);
          if (liErr) throw new Error(`create line items: ${liErr.message}`);
        }
        bidsCreated++;
      }

      // 4 · Contacts (with email) → this contractor's Network. email is the unit.
      const contactRows = extraction.contacts
        .filter((c) => c.email)
        .map((c) => ({
          workspace_id: cov.workspace_id,
          name: c.name,
          role: c.role,
          company: c.company,
          email: c.email,
          found_in: c.source,
          source_bid_request_id: bidRequestId,
        }));
      if (contactRows.length) {
        await db.from("contacts").upsert(contactRows, { onConflict: "workspace_id,email", ignoreDuplicates: true });
      }
    }

    metadata.set("status", "priced");
    return { trade: tradeSlug, counts, bidsCreated, gaps: gaps.length };
  },
});

/**
 * engine.extract-pricing — onboarding. Read a contractor's own past proposals and
 * recover their charged-price rate card + boilerplate, staged into
 * workspaces.settings.pendingDna for the contractor to confirm (then written to
 * pricing_items). Never touches another tenant's data — pricing is private.
 */
export const extractPricing = schemaTask({
  id: "engine.extract-pricing",
  machine: { preset: "medium-1x" },
  maxDuration: 900,
  retry: { maxAttempts: 1 },
  schema: z.object({ workspaceId: z.string().uuid(), storagePaths: z.array(z.string()).min(1) }),
  run: async ({ workspaceId, storagePaths }) => {
    const db = engineDb();

    const setStatus = async (patch: Record<string, unknown>) => {
      const { data: ws } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();
      const settings = (ws?.settings ?? {}) as Record<string, unknown>;
      const pendingDna = { ...((settings.pendingDna as Record<string, unknown>) ?? {}), ...patch };
      await db.from("workspaces").update({ settings: { ...settings, pendingDna } }).eq("id", workspaceId);
    };

    try {
      await setStatus({ status: "extracting", error: null });
      const bytes: Uint8Array[] = [];
      for (const path of storagePaths) {
        const { data: blob, error } = await db.storage.from("bid-docs").download(path);
        if (error || !blob) throw new Error(`download ${path}: ${error?.message}`);
        bytes.push(new Uint8Array(await blob.arrayBuffer()));
      }

      logger.info("Reading past proposals for pricing DNA", { files: bytes.length });
      const merged = await mergeToBase64(bytes);
      const { dna, usage } = await extractPricingDna(merged);
      logger.info("Pricing DNA extracted", {
        motorized: dna.motorizedByGanging.length,
        blinds: dna.blindsByWidth.length,
        fps: dna.fixedPanelPrice,
        install: dna.installFee,
        tokens: usage,
      });

      await setStatus({ status: "ready", error: null, ...dna });
      return { ok: true, motorized: dna.motorizedByGanging.length, blinds: dna.blindsByWidth.length };
    } catch (e) {
      await setStatus({ status: "error", error: (e as Error).message });
      throw e;
    }
  },
});
