import { loadDoc, chunkForApi, subsetBase64 } from "./pdf";
import { MODELS, addUsage, emptyUsage, pdfBlock, structuredCall, type Usage } from "./anthropic";
import { ScanChunkResult } from "./schemas/scan";

export interface TradeInput {
  slug: string;
  label: string;
  keywords: string[];
  negativeKeywords?: string[];
  noBidSignals: string[];
  disambiguation?: string;
}

export interface ScanDoc {
  id: string; // document id (or filename) for page citations
  bytes: Uint8Array;
}

export interface ScanTradeResult {
  slug: string;
  label: string;
  relevance: "bid" | "no_bid";
  confidence: number;
  reasoning: string;
  relevantPages: { documentId: string; page: number; kind: string }[];
}

export interface ScanContact {
  name: string;
  role: string;
  company: string | null;
  email: string | null;
  source: string;
}

export interface ScanResult {
  trades: ScanTradeResult[];
  contacts: ScanContact[];
  usage: Usage;
}

const SYSTEM = (trades: TradeInput[]) =>
  `You are the relevance-scan step of a multi-trade construction-bidding platform. You read part of a bid package ONCE and decide, for EACH trade below, whether it contains BIDDABLE scope for that trade.\n\n` +
  `Judge SEMANTICALLY, never by keyword frequency. A word can appear many times yet be irrelevant (e.g. "epoxy" usually means epoxy ANCHORS/adhesive or stair nose filler — NOT epoxy flooring). Use each trade's negative signals and no-bid signals.\n\n` +
  `TRADES:\n` +
  trades
    .map(
      (t) =>
        `• ${t.slug} (${t.label})\n  bid signals: ${t.keywords.join(", ")}\n` +
        (t.negativeKeywords?.length ? `  NOT this trade: ${t.negativeKeywords.join(", ")}\n` : "") +
        `  no-bid: ${t.noBidSignals.join("; ")}` +
        (t.disambiguation ? `\n  note: ${t.disambiguation}` : ""),
    )
    .join("\n") +
  `\n\nReturn one entry for EVERY trade slug. For each, scopePresent + confidence + reason + the relevant page numbers (within this chunk). Also extract project-team contacts (name, role, company, email if present) from title blocks / spec covers.`;

const isOverflow = (e: unknown) => /too long|too large|request_too_large|maximum/i.test((e as Error)?.message ?? "");

export async function runMultiTradeScan(docs: ScanDoc[], trades: TradeInput[]): Promise<ScanResult> {
  let usage = emptyUsage();
  // slug → aggregate
  const agg = new Map<string, { present: boolean; conf: number; reason: string; pages: Map<string, { documentId: string; page: number; kind: string }> }>();
  for (const t of trades) agg.set(t.slug, { present: false, conf: 0, reason: "", pages: new Map() });
  const contactsByKey = new Map<string, ScanContact>();
  const tradeList = trades.map((t) => t.slug).join(", ");

  async function scanIndices(doc: ScanDoc, src: Awaited<ReturnType<typeof loadDoc>>["doc"], indices: number[], label: string): Promise<void> {
    const base64 = await subsetBase64(src, indices);
    let data: ScanChunkResult;
    try {
      const r = await structuredCall({
        model: MODELS.scan,
        system: SYSTEM(trades),
        content: [
          pdfBlock(base64, true), // cache the document — per-chunk reads ride the cache
          { type: "text", text: `Chunk ${label} (${indices.length} pages). Score every trade [${tradeList}] and return relevant page numbers within THIS chunk.` },
        ],
        toolName: "report_scan",
        toolDescription: "Per-trade relevance + relevant pages + project contacts for these pages.",
        schema: ScanChunkResult,
        maxTokens: 4000,
      });
      usage = addUsage(usage, r.message);
      data = r.data;
    } catch (e) {
      if (isOverflow(e) && indices.length > 1) {
        const mid = Math.ceil(indices.length / 2);
        await scanIndices(doc, src, indices.slice(0, mid), `${label}a`);
        await scanIndices(doc, src, indices.slice(mid), `${label}b`);
        return;
      }
      throw e;
    }

    for (const t of data.trades) {
      const a = agg.get(t.slug);
      if (!a) continue;
      if (t.scopePresent) {
        a.present = true;
        if (t.confidence > a.conf) {
          a.conf = t.confidence;
          a.reason = t.reason;
        }
        for (const p of t.relevantPages ?? []) {
          const globalPage = indices[p.pageInChunk - 1];
          if (globalPage == null) continue;
          a.pages.set(`${doc.id}:${globalPage}`, { documentId: doc.id, page: globalPage + 1, kind: p.kind });
        }
      } else if (!a.present && t.confidence > a.conf) {
        a.conf = t.confidence;
        a.reason = t.reason;
      }
    }
    for (const c of data.contacts ?? []) {
      const key = (c.email ?? `${c.name}|${c.company ?? ""}`).toLowerCase();
      if (!contactsByKey.has(key)) contactsByKey.set(key, c);
    }
  }

  for (const doc of docs) {
    const { doc: src } = await loadDoc(doc.bytes);
    const chunks = await chunkForApi(src);
    for (const [ci, chunk] of chunks.entries()) {
      await scanIndices(doc, src, chunk.pageIndices, `${doc.id}#${ci + 1}/${chunks.length}`);
    }
  }

  const result: ScanTradeResult[] = trades.map((t) => {
    const a = agg.get(t.slug)!;
    return {
      slug: t.slug,
      label: t.label,
      relevance: a.present ? "bid" : "no_bid",
      confidence: a.conf,
      reasoning: a.reason,
      relevantPages: [...a.pages.values()].sort((x, y) => x.page - y.page),
    };
  });

  return { trades: result, contacts: [...contactsByKey.values()], usage };
}
