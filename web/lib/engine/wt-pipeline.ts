import { loadDoc, subsetBase64 } from "./pdf";
import { extract, type WtVerticalConfig } from "./extract";
import { countPage } from "./count";
import { assemble } from "./assemble";
import { detectGaps, type Gap } from "./gaps";
import { emptyUsage, type Usage } from "./anthropic";
import type { Scope } from "./price";
import type { ExtractionResult } from "./schemas/extract";

export interface PipelineDoc {
  id: string;
  bytes: Uint8Array;
  relevantPages: { page: number; kind: string }[]; // page is 1-based, from the scan
}

export interface WtPipelineResult {
  extraction: ExtractionResult;
  scope: Scope;
  gaps: Gap[];
  counts: { WT: number; MB: number; FPS: number };
  usage: Usage;
}

const PLAN_KIND = /plan|schedule|rcp|legend|elevation|treatment|shade|window|detail|finish/i;
const TYPE_CODES = ["WT1", "MB1", "FPS1"];
const MAX_PLAN_PAGES = 6; // cap the (expensive) tiled count to the densest plan pages

const merge = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
});

/**
 * The validated window-treatments engine (spike `run` + `close`): Pass A extracts
 * spec/types/contacts/gaps from native PDF of the relevant pages; Pass B renders
 * the tag-bearing plan pages at high DPI, tiles them, and counts tags; `assemble`
 * reads ganging + widths into a priceable Scope, cross-checked against the count.
 * Multi-doc merge is Stage 3 — here we read the package's primary doc.
 */
export async function runWtPipeline(docs: PipelineDoc[], cfg: WtVerticalConfig): Promise<WtPipelineResult> {
  let usage = emptyUsage();

  const primary = [...docs].sort((a, b) => b.relevantPages.length - a.relevantPages.length)[0];
  if (!primary) throw new Error("no documents to extract from");
  const { doc } = await loadDoc(primary.bytes);
  const totalPages = doc.getPageCount();

  // The scan gave 1-based relevant pages + a freeform `kind` per page.
  const relIdx = [...new Set(primary.relevantPages.map((p) => p.page - 1).filter((i) => i >= 0 && i < totalPages))].sort((a, b) => a - b);
  // Plan-bearing pages (where the tags live). If the scan's kinds don't match,
  // fall back to ALL relevant pages — never to "first N", which misses later plans.
  const planMatched = [...new Set(primary.relevantPages.filter((p) => PLAN_KIND.test(p.kind)).map((p) => p.page - 1).filter((i) => i >= 0 && i < totalPages))].sort((a, b) => a - b);
  const planPages = (planMatched.length ? planMatched : relIdx).slice(0, MAX_PLAN_PAGES);

  console.log("wt-pipeline page selection", {
    totalPages,
    relevant: primary.relevantPages.map((p) => `${p.page}:${p.kind}`),
    relIdx,
    planMatched,
    planPages,
  });

  // Pass A — structured extraction over the relevant pages.
  const ex = await extract(doc, relIdx, cfg);
  usage = merge(usage, ex.usage);

  // Pass B — tiled tag count on the plan pages.
  const counts = { WT: 0, MB: 0, FPS: 0 };
  for (const pi of planPages) {
    const { page, usage: u } = await countPage(primary.bytes, pi, TYPE_CODES);
    usage = merge(usage, u);
    counts.WT += page.byType.WT1 ?? 0;
    counts.MB += page.byType.MB1 ?? 0;
    counts.FPS += page.byType.FPS1 ?? 0;
  }
  console.log("wt-pipeline counts", counts);

  // Assemble priceable scope from the plan pages.
  const planB64 = await subsetBase64(doc, planPages.length ? planPages : relIdx.slice(0, MAX_PLAN_PAGES));
  const asm = await assemble(planB64, counts);
  usage = merge(usage, asm.usage);
  console.log("wt-pipeline scope", { motorizedSets: asm.scope.motorizedSets.length, blinds: asm.scope.blinds.length, fixed: asm.scope.fixedPanels });

  const gaps = detectGaps(ex.result, cfg);

  return { extraction: ex.result, scope: asm.scope, gaps, counts, usage };
}
