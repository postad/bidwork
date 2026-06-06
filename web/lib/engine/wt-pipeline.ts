import { mergePagesToBase64, loadDoc } from "./pdf";
import { extractWt, type WtVerticalConfig } from "./wt-extract";
import { detectWtGaps } from "./gaps";
import { type Usage } from "./anthropic";
import type { WtScope } from "./wt-price";
import type { Gap } from "./gaps";
import type { WtExtractionResult } from "./schemas/wt-extract";

export interface PipelineDoc {
  id: string;
  bytes: Uint8Array;
  relevantPages: { page: number; kind: string }[]; // page is 1-based, from the scan
}

export interface WtPipelineResult {
  extraction: WtExtractionResult;
  scope: WtScope; // per-product: counted shades + GC-facing clarifications
  gaps: Gap[];
  usage: Usage;
}

const MAX_EXTRACT_PAGES = 90;

/**
 * The window-treatments engine, now SCHEDULE-DRIVEN and PER-PRODUCT. A single
 * extraction pass reads the shade schedule + Section 12 spec into shade products +
 * scheduled openings; each opening with a KNOWN COUNT becomes a priceable item
 * (qty × price-per-product downstream). The price tracks the authoritative documented
 * scope; everything uncertain (an opening with no count, etc.) becomes a GC-facing
 * CLARIFICATION note that never changes the price. The old WT1/MB1/FPS1 tiled
 * tag-count is retired (see memory wt-extraction-hardwired-tags).
 */
export async function runWtPipeline(docs: PipelineDoc[], cfg: WtVerticalConfig): Promise<WtPipelineResult> {
  if (!docs.length) throw new Error("no documents to extract from");

  // Per-doc relevant page sets (1-based pages from the scan → 0-based indices).
  const items: { bytes: Uint8Array; indices: number[] }[] = [];
  let anyRel = false;
  for (const d of docs) {
    const { doc } = await loadDoc(d.bytes);
    const total = doc.getPageCount();
    const rel = [...new Set(d.relevantPages.map((p) => p.page - 1).filter((i) => i >= 0 && i < total))].sort((a, b) => a - b);
    if (rel.length) anyRel = true;
    items.push({ bytes: d.bytes, indices: rel });
  }

  // Fall back to the first doc's leading pages if the scan flagged none.
  const extractItems = anyRel
    ? items
    : await (async () => {
        const { doc } = await loadDoc(docs[0].bytes);
        const n = Math.min(doc.getPageCount(), MAX_EXTRACT_PAGES);
        return [{ bytes: docs[0].bytes, indices: Array.from({ length: n }, (_, i) => i) }];
      })();

  const b64 = await mergePagesToBase64(extractItems, MAX_EXTRACT_PAGES);
  const pagesSent = Math.min(extractItems.reduce((a, it) => a + it.indices.length, 0), MAX_EXTRACT_PAGES);
  const ex = await extractWt(b64, cfg, pagesSent);

  // Resolve each opening's system reference (a tag like "Shade Type 1") to the
  // extraction's descriptive product name, so the AI match judges the real product.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const sysByRef = new Map<string, string>();
  for (const s of ex.result.systems) {
    if (s.code) sysByRef.set(norm(s.code), s.name);
    if (s.name) sysByRef.set(norm(s.name), s.name);
  }

  // Split the schedule into PRICEABLE items (count known) and GC-facing clarifications.
  const priceable: WtScope["items"] = [];
  const clarifications: string[] = [];
  let anyMissingSize = false;
  for (const it of ex.result.items) {
    const product = sysByRef.get(norm(it.system)) ?? it.system;
    const where = [it.level, it.room].filter(Boolean).join(" / ") || undefined;
    if (it.qty != null && it.qty > 0) {
      // Carry size when stated → drives the S/M/L tier; absent → priced at Standard.
      priceable.push({ product, qty: it.qty, location: where, widthInches: it.widthInches, heightInches: it.heightInches });
      if (it.widthInches == null || it.heightInches == null) anyMissingSize = true;
    } else {
      // No count → can't price (count × rate). EXCLUDE + note for the GC, per the
      // "price the source, professionally note the rest" rule. Not a blocking line.
      clarifications.push(`${product}${where ? ` at ${where}` : ""} — shown in the documents but the quantity is not specified; excluded from this price pending confirmation.`);
    }
  }
  if (priceable.length && anyMissingSize) {
    clarifications.push("Shades priced at the Standard size tier where the documents give no size; field dimensions to be confirmed.");
  }

  const scope: WtScope = { items: priceable, clarifications };

  console.log("wt-pipeline", { pagesSent, products: ex.result.systems.length, openings: ex.result.items.length, priceable: priceable.length, excluded: clarifications.length });

  const gaps = detectWtGaps(ex.result, cfg);

  return { extraction: ex.result, scope, gaps, usage: ex.usage };
}
