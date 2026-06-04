import { mergePagesToBase64, loadDoc } from "./pdf";
import { extractFlooring, type FlooringVerticalConfig } from "./flooring-extract";
import { detectFlooringGaps } from "./gaps";
import { emptyUsage, type Usage } from "./anthropic";
import type { FlooringScope } from "./flooring-price";
import type { Gap } from "./gaps";
import type { PipelineDoc } from "./wt-pipeline";
import type { FlooringExtractionResult } from "./schemas/flooring-extract";

export interface FlooringPipelineResult {
  extraction: FlooringExtractionResult;
  scope: FlooringScope;
  gaps: Gap[];
  usage: Usage;
}

const MAX_EXTRACT_PAGES = 90;

/**
 * The material-agnostic flooring engine. Unlike WT (which tile-counts tags on a
 * plan), flooring is AREA-priced from the finish schedule, so this is a SINGLE
 * extraction pass over the package's relevant pages — no vision count step. The
 * priceable Scope is assembled deterministically from the extraction: rooms with a
 * stated SF become priceable areas; rooms with no SF are left out of scope (and
 * flagged as gaps → a site-visit bid downstream).
 */
export async function runFlooringPipeline(docs: PipelineDoc[], cfg: FlooringVerticalConfig): Promise<FlooringPipelineResult> {
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
  const ex = await extractFlooring(b64, cfg, pagesSent);

  // Assemble the priceable scope deterministically — only rooms with a known SF.
  const areas = ex.result.areas
    .filter((a) => a.sqft != null && a.sqft > 0)
    .map((a) => ({
      system: a.system,
      sqft: a.sqft as number,
      location: [a.level, a.room].filter(Boolean).join(" / ") || undefined,
    }));
  const baseTrimLf = ex.result.baseTrimLf ?? 0;
  const prep = ex.result.prepSqft != null && ex.result.prepSqft > 0 ? { type: ex.result.prepType ?? "Substrate prep", sqft: ex.result.prepSqft } : null;
  const scope: FlooringScope = { areas, baseTrimLf, prep };

  console.log("flooring-pipeline", { pagesSent, systems: ex.result.systems.length, areas: areas.length, unpricedRooms: ex.result.areas.length - areas.length });

  const gaps = detectFlooringGaps(ex.result, cfg);

  return { extraction: ex.result, scope, gaps, usage: ex.usage };
}
