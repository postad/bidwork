import { MODELS, addUsage, emptyUsage, pdfBlock, structuredCall, type Usage } from "./anthropic";
import { FlooringExtractionResult } from "./schemas/flooring-extract";

/**
 * Material-agnostic flooring config. One pipeline serves every flooring sub-trade
 * (epoxy, carpet, resilient, polished/sealed concrete, wood, tile, …); the material
 * lives entirely in `scopeDrivers` (what to look for) + the contractor's rate card.
 */
export interface FlooringVerticalConfig {
  label: string;
  groupBy: string[];
  scopeDrivers: { key: string; label: string; pricingUnit: string; blocking?: boolean }[];
  requiredEvidence: { key: string; label: string; blocking: boolean }[];
  noBidSignals: string[];
  disambiguation?: string;
}

const SYSTEM = (cfg: FlooringVerticalConfig) =>
  `You are the extraction step for a ${(cfg.label ?? "flooring").toUpperCase()} subcontractor. You are given ONLY the pages a triage step judged relevant from a bid set.\n\n` +
  `Read the floor-finish schedule, the relevant Division 09 specification, and the plans, and extract a complete, priceable flooring scope FOR THIS TRADE ONLY.\n\n` +
  `RULES:\n` +
  `- This trade is priced by these drivers: ${cfg.scopeDrivers.map((d) => `${d.label} (${d.pricingUnit})`).join("; ")}.\n` +
  `- Identify the distinct floor SYSTEMS in scope (with their spec/build) and, for EACH room the finish schedule assigns one to, report the floor AREA in square feet.\n` +
  `- SCOPE ONLY — count an area ONLY if it RECEIVES this trade's new work. EXCLUDE any area the documents mark as "(existing) finish to remain", "no work", "NIC"/"not in contract", "by others", or shown merely as an adjacent existing finish for reference. Finish/takeoff schedules routinely list BOTH the work scope AND existing finishes that stay — counting a "to remain" area over-bills the job. (Note: "finish to MATCH existing" IS work — that area is getting new finish and counts; only an area whose existing finish REMAINS as-is is excluded.)\n` +
  `- CRITICAL: report sqft ONLY when the schedule/plan states or directly gives it (room area, dimensions). If a room clearly gets this floor but NO area is available, set sqft=null with low-ish confidence — a flagged blank becomes a field-measure request, which is far safer than a guessed number.\n` +
  `- Report total base/trim in linear feet (wall base, integral cove base, transitions) when stated, and any separately-scoped substrate prep (type + SF).\n` +
  `- Every field carries a confidence (0..1) and a citation (sheet/page). NEVER invent a value to fill the schema.\n` +
  `- Capture project team contacts from title blocks / spec covers, with email when present (email may be null).\n` +
  `- List any sheets/specs the documents reference but that may not be present (e.g. "see A-601"), for downstream gap-chasing.\n` +
  `- Score trade relevance (bid/no-bid). No-bid signals: ${cfg.noBidSignals.join("; ")}.\n` +
  (cfg.disambiguation ? `- Disambiguation: ${cfg.disambiguation}\n` : "") +
  `- For evidenceFound, report present/absent for each of these keys: ${cfg.requiredEvidence.map((e) => e.key).join(", ")}.`;

export interface FlooringExtractOutput {
  result: FlooringExtractionResult;
  usage: Usage;
}

/** Single structured pass over the relevant pages of the whole package (pre-merged
 *  into one base64 PDF by the caller). Areas come from the finish schedule — there
 *  is no tiled vision count step (flooring is area-priced, not tag-counted). */
export async function extractFlooring(pagesB64: string, cfg: FlooringVerticalConfig, pageCount: number): Promise<FlooringExtractOutput> {
  const { data, message } = await structuredCall({
    model: MODELS.extract,
    system: SYSTEM(cfg),
    content: [
      pdfBlock(pagesB64),
      { type: "text", text: `These are the ${pageCount} pages flagged as relevant across the package. Extract the full ${cfg.label ?? "flooring"} scope now.` },
    ],
    toolName: "report_flooring_scope",
    toolDescription: "Report the extracted flooring scope (systems, room areas in SF, base/trim, prep), contacts, and evidence found.",
    schema: FlooringExtractionResult,
    maxTokens: 16000,
  });

  return { result: data, usage: addUsage(emptyUsage(), message) };
}
