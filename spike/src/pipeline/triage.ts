import type { PDFDocument } from "pdf-lib";
import { chunkForApi, subsetBase64 } from "../lib/pdf.js";
import { MODELS, addUsage, pdfBlock, structuredCall, type Usage } from "../lib/anthropic.js";

export interface TriageResult {
  relevantPages: number[]; // 0-based indices into the original document
  details: { page: number; kind: string; reason: string }[];
  anyScope: boolean;
  usage: Usage;
}

const TRIAGE_TOOL = {
  type: "object",
  additionalProperties: false,
  properties: {
    anyWindowTreatmentScope: {
      type: "boolean",
      description: "Does this chunk contain ANY evidence of interior window-treatment scope (shades, blinds, drapery, fascia, Division 12 furnishings)?",
    },
    relevantPages: {
      type: "array",
      description: "Only the pages that actually matter for pricing window treatments. Be selective — skip irrelevant MEP/structural/civil pages.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          pageInThisChunk: { type: "integer", description: "1-based page number within THIS chunk" },
          kind: { type: "string", enum: ["shade_schedule", "type_definitions", "floor_plan", "rcp", "elevation", "division_12_spec", "finish_legend", "contacts_title_block", "other"] },
          reason: { type: "string" },
        },
        required: ["pageInThisChunk", "kind", "reason"],
      },
    },
  },
  required: ["anyWindowTreatmentScope", "relevantPages"],
};

const SYSTEM =
  "You are a triage step in a construction bid pipeline for a WINDOW-TREATMENT subcontractor (roller shades, blinds, drapery, fascia/valance). " +
  "You receive part of a large bid set (drawings + specs). Identify ONLY the pages that matter for scoping and pricing window treatments: " +
  "shade/blind schedules, type definitions, floor plans and reflected ceiling plans showing windows/shades, interior elevations, finish legends, " +
  "Division 12 (Furnishings, CSI 12 24 00 / 12 21 00) specifications, and title blocks with the project team's contact info. " +
  "Ignore plumbing, HVAC, fire-suppression, electrical, and structural pages unless they directly inform shade motorization/control. " +
  "If there is no interior window-treatment scope at all, say so.";

const isOverflow = (e: any) => /too long|too large|request_too_large|maximum/i.test(e?.message ?? "");

export async function triage(src: PDFDocument, keywords: string[]): Promise<TriageResult> {
  const chunks = await chunkForApi(src);
  let usage: Usage = { input: 0, output: 0 };
  const relevant = new Set<number>();
  const details: TriageResult["details"] = [];
  let anyScope = false;

  // Triage a set of (global, 0-based) page indices; on a size/token overflow,
  // split the page range and recurse so a single dense chunk can't kill the run.
  async function triageIndices(indices: number[], label: string): Promise<void> {
    const base64 = await subsetBase64(src, indices);
    let data: any;
    try {
      const r = await structuredCall({
        model: MODELS.triage,
        system: SYSTEM,
        content: [
          pdfBlock(base64),
          { type: "text", text: `Chunk ${label} (${indices.length} pages). Relevance keywords: ${keywords.join(", ")}. Return 1-based page numbers within THIS chunk that matter.` },
        ],
        toolName: "report_triage",
        toolDescription: "Report which pages of this chunk are relevant to window-treatment scope.",
        inputSchema: TRIAGE_TOOL,
        maxTokens: 2000,
      });
      usage = addUsage(usage, r.message);
      data = r.data;
    } catch (e: any) {
      if (isOverflow(e) && indices.length > 1) {
        const mid = Math.ceil(indices.length / 2);
        console.log(`  · chunk ${label} overflowed — splitting ${indices.length}p`);
        await triageIndices(indices.slice(0, mid), `${label}a`);
        await triageIndices(indices.slice(mid), `${label}b`);
        return;
      }
      throw e;
    }

    if (data.anyWindowTreatmentScope) anyScope = true;
    for (const p of data.relevantPages ?? []) {
      const globalIdx = indices[p.pageInThisChunk - 1];
      if (globalIdx == null) continue;
      relevant.add(globalIdx);
      details.push({ page: globalIdx + 1, kind: p.kind, reason: p.reason });
    }
    console.log(`  · triage chunk ${label} → ${data.relevantPages?.length ?? 0} relevant page(s)`);
  }

  for (const [ci, chunk] of chunks.entries()) await triageIndices(chunk.pageIndices, `${ci + 1}/${chunks.length}`);

  return {
    relevantPages: [...relevant].sort((a, b) => a - b),
    details: details.sort((a, b) => a.page - b.page),
    anyScope,
    usage,
  };
}
