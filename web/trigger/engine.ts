import { schemaTask, logger, metadata } from "@trigger.dev/sdk";
import { z } from "zod";
import { engineDb } from "../lib/engine/supabase";
import { runMultiTradeScan, type ScanDoc, type TradeInput } from "../lib/engine/scan";

/**
 * engine.scan-request — read the uploaded package ONCE and score every trade.
 * Writes per-trade bid/no-bid to bid_requests.trade_scores and flips status to
 * needs_review (admin confirms before dispatch). Extraction per bid-trade is a
 * separate task triggered after admin review.
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
    return {
      bidTrades: bidTrades.map((t) => t.slug),
      tradeScores: result.trades.map((t) => ({ slug: t.slug, relevance: t.relevance, confidence: t.confidence })),
      contacts: result.contacts,
    };
  },
});
