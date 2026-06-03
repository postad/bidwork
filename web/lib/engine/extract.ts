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
}

/** Pass A — structured spec/type/contact extraction over the relevant pages of the
 *  WHOLE package (pre-merged across docs into one base64 PDF by the caller). */
export async function extract(pagesB64: string, cfg: WtVerticalConfig, pageCount: number): Promise<ExtractOutput> {
  const { data, message } = await structuredCall({
    model: MODELS.extract,
    system: SYSTEM(cfg),
    content: [
      pdfBlock(pagesB64),
      { type: "text", text: `These are the ${pageCount} pages flagged as relevant across the package. Extract the full window-treatment scope now.` },
    ],
    toolName: "report_scope",
    toolDescription: "Report the extracted window-treatment scope, pricing-relevant attributes, contacts, and evidence found.",
    schema: ExtractionResult,
    maxTokens: 16000,
  });

  return { result: data, usage: addUsage(emptyUsage(), message) };
}
