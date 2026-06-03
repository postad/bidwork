import { loadDoc, mergePagesToBase64 } from "./pdf";
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
const MAX_PLAN_PAGES = 6; // cap the (expensive) tiled count across the whole package
const MAX_EXTRACT_PAGES = 90;

const merge = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
});

/**
 * The validated window-treatments engine, now MULTI-DOC: a package's relevant
 * pages may be split across files (schedule in one PDF, plan in another). Pass A
 * extracts over the relevant pages of the WHOLE package; Pass B tile-counts each
 * doc's plan pages (rendering needs per-doc page indices) and sums; assemble reads
 * the merged plan pages into a priceable Scope.
 */
export async function runWtPipeline(docs: PipelineDoc[], cfg: WtVerticalConfig): Promise<WtPipelineResult> {
  let usage = emptyUsage();
  if (!docs.length) throw new Error("no documents to extract from");

  // Per-doc page sets. The scan's `kind` labels are unreliable for finding the
  // tag-bearing plan, so plan pages = plan-kind matches first, then all relevant.
  const prepared: { id: string; bytes: Uint8Array; total: number; rel: number[]; plan: number[] }[] = [];
  for (const d of docs) {
    const { doc } = await loadDoc(d.bytes);
    const total = doc.getPageCount();
    const rel = [...new Set(d.relevantPages.map((p) => p.page - 1).filter((i) => i >= 0 && i < total))].sort((a, b) => a - b);
    const planMatched = d.relevantPages.filter((p) => PLAN_KIND.test(p.kind)).map((p) => p.page - 1).filter((i) => i >= 0 && i < total);
    const plan = [...new Set([...planMatched, ...rel])];
    prepared.push({ id: d.id, bytes: d.bytes, total, rel, plan });
  }

  // Pass A — extract over the merged relevant pages of the whole package.
  const anyRel = prepared.some((p) => p.rel.length);
  const extractItems = anyRel
    ? prepared.map((p) => ({ bytes: p.bytes, indices: p.rel }))
    : prepared.slice(0, 1).map((p) => ({ bytes: p.bytes, indices: Array.from({ length: Math.min(p.total, MAX_EXTRACT_PAGES) }, (_, i) => i) }));
  const extractB64 = await mergePagesToBase64(extractItems, MAX_EXTRACT_PAGES);
  const pagesSent = Math.min(extractItems.reduce((a, it) => a + it.indices.length, 0), MAX_EXTRACT_PAGES);
  const ex = await extract(extractB64, cfg, pagesSent);
  usage = merge(usage, ex.usage);

  // Pass B — tiled tag count per doc's plan pages (cap total across the package).
  const counts = { WT: 0, MB: 0, FPS: 0 };
  const planItems: { bytes: Uint8Array; indices: number[] }[] = [];
  let budget = MAX_PLAN_PAGES;
  for (const p of prepared) {
    if (budget <= 0) break;
    const planPages = (p.plan.length ? p.plan : p.rel).slice(0, budget);
    if (!planPages.length) continue;
    planItems.push({ bytes: p.bytes, indices: planPages });
    for (const pi of planPages) {
      if (budget <= 0) break;
      const { page, usage: u } = await countPage(p.bytes, pi, TYPE_CODES);
      usage = merge(usage, u);
      counts.WT += page.byType.WT1 ?? 0;
      counts.MB += page.byType.MB1 ?? 0;
      counts.FPS += page.byType.FPS1 ?? 0;
      budget--;
    }
  }
  console.log("wt-pipeline multi-doc", {
    docs: prepared.map((p) => ({ id: p.id, total: p.total, rel: p.rel.length, plan: p.plan.length })),
    pagesSent,
    counts,
  });

  // Assemble priceable scope from the merged plan pages.
  const asmB64 = planItems.length ? await mergePagesToBase64(planItems, MAX_PLAN_PAGES) : extractB64;
  const asm = await assemble(asmB64, counts);
  usage = merge(usage, asm.usage);
  console.log("wt-pipeline scope", { motorizedSets: asm.scope.motorizedSets.length, blinds: asm.scope.blinds.length, fixed: asm.scope.fixedPanels });

  const gaps = detectGaps(ex.result, cfg);

  return { extraction: ex.result, scope: asm.scope, gaps, counts, usage };
}
