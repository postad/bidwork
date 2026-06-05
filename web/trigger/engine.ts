import { schemaTask, logger, metadata } from "@trigger.dev/sdk";
import { z } from "zod";
import { unzipSync } from "fflate";
import { engineDb } from "../lib/engine/supabase";
import { runMultiTradeScan, type ScanDoc, type TradeInput } from "../lib/engine/scan";
import { type PipelineDoc } from "../lib/engine/wt-pipeline";
import { VERTICALS } from "../lib/engine/verticals";
import { mergeToBase64 } from "../lib/engine/pdf";
import { triageDocuments } from "../lib/engine/triage";
import { selectSpecPages, activeDivisions } from "../lib/engine/page-triage";
import { extractPricingDna } from "../lib/engine/extract-pricing";
import { extractFlooringPricingDna } from "../lib/engine/extract-flooring-pricing";

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
  retry: { maxAttempts: 1 }, // re-reads the whole package per attempt; a 400 (credits/auth) is permanent — don't burn 12 min retrying
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

    // Documents for this request → download from Storage. Skip files triage dropped
    // (standalone takeoffs, bonds, insurance certs) so the scan reads only scope content.
    const { data: docs, error: dErr } = await db
      .from("documents")
      .select("id, filename, storage_path, page_meta")
      .eq("bid_request_id", bidRequestId)
      .eq("skipped", false);
    if (dErr) throw new Error(`load documents: ${dErr.message}`);
    if (!docs?.length) throw new Error("no documents for this bid request");

    const scanDocs: ScanDoc[] = [];
    for (const d of docs) {
      const { data: blob, error } = await db.storage.from("bid-docs").download(d.storage_path);
      if (error || !blob) throw new Error(`download ${d.filename}: ${error?.message}`);
      // Spec page-triage stored which pages to scan; undefined → whole doc.
      const pages = (d.page_meta as { scanPages?: number[] } | null)?.scanPages;
      scanDocs.push({ id: d.id, bytes: new Uint8Array(await blob.arrayBuffer()), pages: pages?.length ? pages : undefined });
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

    // Extraction + pricing per bid trade (background) — but ONLY for trades a
    // contractor actually covers. Running the (expensive Opus) extraction for a trade
    // nobody bids is pure waste; uncovered bid trades still show as scored demand in
    // review (recruit a contractor + re-trigger later). This is the main cost lever.
    if (bidTrades.length) {
      const { data: tRows } = await db.from("trades").select("id, slug").in("slug", bidTrades.map((t) => t.slug));
      const idBySlug = new Map((tRows ?? []).map((t) => [t.slug as string, t.id as string]));
      const allIds = [...idBySlug.values()];
      const { data: cov } = allIds.length
        ? await db.from("workspace_trades").select("trade_id").in("trade_id", allIds)
        : { data: [] as { trade_id: string }[] };
      const covered = new Set((cov ?? []).map((c) => c.trade_id as string));
      const toExtract = bidTrades.filter((t) => covered.has(idBySlug.get(t.slug) ?? ""));
      logger.info("Extraction gating", { bidTrades: bidTrades.length, covered: toExtract.length, slugs: toExtract.map((t) => t.slug) });
      if (toExtract.length) {
        await extractBid.batchTrigger(toExtract.map((t) => ({ payload: { bidRequestId, tradeSlug: t.slug } })));
      }
    }

    return {
      bidTrades: bidTrades.map((t) => t.slug),
      tradeScores: result.trades.map((t) => ({ slug: t.slug, relevance: t.relevance, confidence: t.confidence })),
      contacts: result.contacts,
    };
  },
});

/**
 * engine.ingest — the entry point for a PlanHub project zip. The browser uploads ONE
 * zip (one project) to Storage; this unzips it server-side, triages each PDF (cheap
 * Haiku read of page 1 → keep/drop), registers the PDFs as documents (dropped ones
 * flagged skipped), enriches the request with the project name/ZIP read off the spec
 * cover, deletes the transient zip, and kicks off the scan over the kept files.
 */
export const ingestZip = schemaTask({
  id: "engine.ingest",
  machine: { preset: "medium-1x" }, // unzip + pdf-lib hold the package in memory
  maxDuration: 1800,
  retry: { maxAttempts: 1 },
  schema: z.object({ bidRequestId: z.string().uuid(), zipPath: z.string() }),
  run: async ({ bidRequestId, zipPath }) => {
    const db = engineDb();
    metadata.set("status", "reading");

    const { data: blob, error } = await db.storage.from("bid-docs").download(zipPath);
    if (error || !blob) throw new Error(`download upload: ${error?.message}`);

    // Accept EITHER a PlanHub project zip OR a single PDF — detect by magic bytes
    // (a truncated/non-matching upload throws a clear error instead of fflate's).
    const buf = new Uint8Array(await blob.arrayBuffer());
    const isZip = buf[0] === 0x50 && buf[1] === 0x4b; // 'PK'
    const isPdf = buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // '%PDF'

    let docs: { name: string; bytes: Uint8Array }[];
    if (isZip) {
      const entries = unzipSync(buf, { filter: (f) => /\.pdf$/i.test(f.name) && !f.name.startsWith("__MACOSX") });
      docs = Object.entries(entries).map(([name, bytes]) => ({ name: name.split("/").pop() ?? name, bytes }));
      if (!docs.length) throw new Error("zip contained no PDF files");
      logger.info("Unzipped package", { pdfs: docs.length });
    } else if (isPdf) {
      docs = [{ name: zipPath.split("/").pop() ?? "document.pdf", bytes: buf }];
      logger.info("Single PDF upload", { name: docs[0].name });
    } else {
      throw new Error(`Unsupported upload: expected a .zip or .pdf (got ${buf.length} bytes, header ${buf[0]?.toString(16)} ${buf[1]?.toString(16)}) — likely a non-PDF/zip file or a truncated upload.`);
    }

    metadata.set("status", "triaging");
    const { results: verdicts, usage } = await triageDocuments(docs);
    // Triage prunes junk from a big PlanHub zip, but it must NEVER zero out the whole
    // request — a single uploaded PDF (or a package triage misjudged) IS the scope. If
    // it kept nothing, keep everything and let the scan score relevance instead of dead-ending.
    if (!verdicts.some((v) => v.keep)) {
      logger.warn("Triage kept nothing — keeping all files so the request can still scan", { docs: docs.length });
      verdicts.forEach((v) => { v.keep = true; });
    }
    const kept = verdicts.filter((v) => v.keep);
    logger.info("Triage complete", {
      kept: kept.map((v) => `${v.name} (${v.kind})`),
      dropped: verdicts.filter((v) => !v.keep).map((v) => `${v.name} (${v.kind}, ${Math.round(v.confidence * 100)}%)`),
      tokens: usage,
    });

    // Page-level triage for the spec book: read the active trades' CSI divisions and
    // keep only those pages, so the scan reads ~10% of a 2,000-page spec. Divisions
    // come from the live catalog's configs — add a category, its division joins.
    const { data: activeTrades } = await db.from("trades").select("vertical_config").eq("active", true);
    const divisions = activeDivisions((activeTrades ?? []).map((t) => (t.vertical_config ?? {}) as { router?: { csiSections?: string[]; keywords?: string[] } }));
    logger.info("Page-triage divisions", { divisions: [...divisions] });

    // Upload every PDF (kept and dropped) and register it; dropped → skipped=true so
    // it's visible in review but never scanned. email/title/zip enriched from triage.
    let projectName: string | null = null;
    let projectZip: string | null = null;
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      const v = verdicts[i];
      const safe = d.name.replace(/[^\w.\-]+/g, "_");
      const path = `${bidRequestId}/${safe}`;
      const { error: upErr } = await db.storage.from("bid-docs").upload(path, d.bytes, { contentType: "application/pdf", upsert: true });
      if (upErr) throw new Error(`upload ${d.name}: ${upErr.message}`);

      // Spec books get page-triaged to the active divisions; everything else scans whole.
      // Gate on the triage kind OR a "spec" filename (belt-and-suspenders if Haiku
      // mislabels the file) — only real spec books match, and page-triage is safe on them.
      let pageMeta: Record<string, unknown> = {};
      if (v.keep && (v.kind === "specs" || /spec/i.test(d.name)) && divisions.size) {
        const scanPages = selectSpecPages(d.bytes, divisions);
        pageMeta = { scanPages };
        logger.info("Spec page-triage", { file: d.name, kept: scanPages.length });
      }

      const { error: insErr } = await db.from("documents").insert({
        bid_request_id: bidRequestId,
        filename: d.name,
        storage_path: path,
        bytes: d.bytes.byteLength,
        skipped: !v.keep,
        page_meta: pageMeta,
        triage: { kind: v.kind, keep: v.keep, confidence: v.confidence, reason: v.reason },
      });
      if (insErr) throw new Error(`register ${d.name}: ${insErr.message}`);
      if (!projectName && v.projectName) projectName = v.projectName;
      if (!projectZip && v.projectZip) projectZip = v.projectZip;
    }

    // Enrich the request with what triage read off the cover (don't clobber with nulls).
    const patch: Record<string, unknown> = {};
    if (projectName) patch.title = projectName;
    if (projectZip) patch.center_zip = projectZip;
    if (Object.keys(patch).length) await db.from("bid_requests").update(patch).eq("id", bidRequestId);

    // Drop the transient zip now that the PDFs are extracted.
    await db.storage.from("bid-docs").remove([zipPath]);

    metadata.set("status", "scanning");
    await scanRequest.trigger({ bidRequestId });

    return { pdfs: docs.length, kept: kept.length, dropped: docs.length - kept.length };
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
      .select("id, slug, label, vertical_config, category")
      .eq("slug", tradeSlug)
      .single();
    if (tErr || !trade) throw new Error(`load trade ${tradeSlug}: ${tErr?.message}`);

    // Dispatch by category — every flooring sub-trade shares the flooring pipeline.
    const vertical = VERTICALS[(trade.category ?? "") as string];
    if (!vertical) {
      logger.info("No pipeline for this trade's category — skipping", { tradeSlug, category: trade.category });
      return { skipped: true, reason: `no vertical pipeline for category '${trade.category}'` };
    }

    // Inject the trade's label (it lives on the column, not in vertical_config) so
    // verticals can name the trade in prompts.
    const cfg = { ...((trade.vertical_config ?? {}) as Record<string, unknown>), label: trade.label };

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

    // Download docs and attach their relevant pages (skip triage-dropped files —
    // they were never scanned, so they carry no relevant pages anyway).
    const { data: docs, error: dErr } = await db
      .from("documents")
      .select("id, filename, storage_path")
      .eq("bid_request_id", bidRequestId)
      .eq("skipped", false);
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
    logger.info("Extracting scope", { tradeSlug, category: trade.category, docs: pipelineDocs.length, relevantPages: relevant.length });

    const { extraction, scope, gaps, quantifiable, scopeSummary, usage } = await vertical.run(pipelineDocs, cfg);
    logger.info("Extraction complete", { tradeSlug, quantifiable, gaps: gaps.length, tokens: usage });

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
    // `quantifiable` + `scopeSummary` come from the vertical. A scope named but not
    // quantifiable (no SF / no counts) → a no-price site-visit request instead of an
    // install-only bid. Shows we read the project and asks to field-measure. (SPEC-ADDITIONS #1)
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
        const dna = await vertical.loadDNA(db, cov.workspace_id, trade.id);
        if (!dna) {
          logger.warn("Skipping contractor — incomplete Pricing DNA", { workspaceId: cov.workspace_id });
          continue;
        }
        const priced = await vertical.price(scope, dna);

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
            tax_rate: priced.taxRate,
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
          unit: vertical.lineUnit(l.code),
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
    return { trade: tradeSlug, quantifiable, bidsCreated, gaps: gaps.length };
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
  schema: z.object({ workspaceId: z.string().uuid(), storagePaths: z.array(z.string()).min(1), category: z.string().default("window-treatments") }),
  run: async ({ workspaceId, storagePaths, category }) => {
    const db = engineDb();

    const setStatus = async (patch: Record<string, unknown>) => {
      const { data: ws } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();
      const settings = (ws?.settings ?? {}) as Record<string, unknown>;
      const pendingDna = { ...((settings.pendingDna as Record<string, unknown>) ?? {}), ...patch };
      await db.from("workspaces").update({ settings: { ...settings, pendingDna } }).eq("id", workspaceId);
    };

    try {
      await setStatus({ status: "extracting", error: null, category });
      const bytes: Uint8Array[] = [];
      for (const path of storagePaths) {
        const { data: blob, error } = await db.storage.from("bid-docs").download(path);
        if (error || !blob) throw new Error(`download ${path}: ${error?.message}`);
        bytes.push(new Uint8Array(await blob.arrayBuffer()));
      }

      logger.info("Reading past proposals for pricing DNA", { files: bytes.length, category });
      const merged = await mergeToBase64(bytes);

      // Branch the DNA extractor by category — flooring recovers a per-SF-by-system
      // rate card; window-treatments recovers shade/blind rates.
      if (category === "flooring") {
        const { dna, usage } = await extractFlooringPricingDna(merged);
        logger.info("Flooring pricing DNA extracted", { systems: dna.systems.length, prep: dna.prepPerSqft, base: dna.baseTrimPerLf, mob: dna.mobilizationFee, tokens: usage });
        await setStatus({ status: "ready", error: null, category, ...dna });
        return { ok: true, systems: dna.systems.length };
      }

      const { dna, usage } = await extractPricingDna(merged);
      logger.info("Pricing DNA extracted", {
        motorized: dna.motorizedByGanging.length,
        blinds: dna.blindsByWidth.length,
        fps: dna.fixedPanelPrice,
        install: dna.installFee,
        tokens: usage,
      });

      await setStatus({ status: "ready", error: null, category, ...dna });
      return { ok: true, motorized: dna.motorizedByGanging.length, blinds: dna.blindsByWidth.length };
    } catch (e) {
      await setStatus({ status: "error", error: (e as Error).message });
      throw e;
    }
  },
});
