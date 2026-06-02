import type { PDFDocument } from "pdf-lib";
import { subsetBase64 } from "./pdf";
import { MODELS, addUsage, emptyUsage, pdfBlock, structuredCall, type Usage } from "./anthropic";
import { ExtractionResult } from "./schemas/extract";

export interface WtVerticalConfig {
  label: string;
  groupBy: string[];
  productTypes: { code: string; name: string; pricingUnit: string; attributes?: string[] }[];
  requiredEvidence: { key: string; label: string; blocking: boolean }[];
  noBidSignals: string[];
}

const SYSTEM = (cfg: WtVerticalConfig) =>
  `You are the extraction step for a WINDOW-TREATMENT subcontractor. You are given ONLY the pages a triage step judged relevant from a bid set.\n\n` +
  `Read the drawings and specifications and extract a complete, priceable scope of window treatments.\n\n` +
  `RULES:\n` +
  `- Product types in this trade: ${cfg.productTypes.map((p) => `${p.code} (${p.name}, priced ${p.pricingUnit})`).join("; ")}.\n` +
  `- Group locations by ${cfg.groupBy.join(" → ")} to mirror the drawings.\n` +
  `- CRITICAL: read shade GANGING — how many shades share one motor (shadesPerMotor) — because it changes pricing. Look at plans/elevations for ganged windows.\n` +
  `- Every field carries a confidence (0..1) and a citation (sheet/page). NEVER invent a value to fill the schema. If something is absent or unclear, set value=null with a reason. A flagged blank is safer than a confident wrong number.\n` +
  `- Capture project team contacts from title blocks / spec covers, with email when present (email may be null).\n` +
  `- List any sheets/specs the documents reference but that may not be present (e.g. "see A-601"), for downstream gap-chasing.\n` +
  `- Score trade relevance (bid/no-bid). No-bid signals: ${cfg.noBidSignals.join("; ")}.\n` +
  `- For evidenceFound, report present/absent for each of these keys: ${cfg.requiredEvidence.map((e) => e.key).join(", ")}.`;

export interface ExtractOutput {
  result: ExtractionResult;
  usage: Usage;
  pagesSent: number;
}

/** Pass A — structured spec/type/contact extraction from native PDF of the relevant pages. */
export async function extract(src: PDFDocument, relevantPages: number[], cfg: WtVerticalConfig): Promise<ExtractOutput> {
  // Fall back to the whole doc (capped) if triage found nothing — better to try than to fail blind.
  const pages = relevantPages.length ? relevantPages : Array.from({ length: Math.min(src.getPageCount(), 90) }, (_, i) => i);
  const base64 = await subsetBase64(src, pages.slice(0, 90));

  const { data, message } = await structuredCall({
    model: MODELS.extract,
    system: SYSTEM(cfg),
    content: [
      pdfBlock(base64),
      { type: "text", text: `These are the ${pages.length} pages triage flagged as relevant. Extract the full window-treatment scope now.` },
    ],
    toolName: "report_scope",
    toolDescription: "Report the extracted window-treatment scope, pricing-relevant attributes, contacts, and evidence found.",
    schema: ExtractionResult,
    maxTokens: 16000,
  });

  return { result: data, usage: addUsage(emptyUsage(), message), pagesSent: pages.length };
}
