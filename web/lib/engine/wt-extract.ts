import { MODELS, addUsage, emptyUsage, pdfBlock, structuredCall, type Usage } from "./anthropic";
import { WtExtractionResult } from "./schemas/wt-extract";

/**
 * Window-treatments config — mirrors FlooringVerticalConfig. WT now shares the
 * flooring engine (area-priced, AI-matched, deterministic compute); the only
 * WT-specific code is THIS extraction (reading a shade schedule ≠ a finish schedule).
 */
export interface WtVerticalConfig {
  label: string;
  scopeDrivers?: { key: string; label: string; pricingUnit: string }[];
  requiredEvidence?: { key: string; label: string; blocking: boolean }[];
  noBidSignals: string[];
  disambiguation?: string;
}

const SYSTEM = (cfg: WtVerticalConfig) =>
  `You are the extraction step for a WINDOW TREATMENTS subcontractor. You are given ONLY the pages a triage step judged relevant from a bid set.\n\n` +
  `Read the window-treatment / roller-shade specification (CSI Section 12 20 00 / 12 24 00) AND the shade SCHEDULE on the architectural/interior (A/I) drawings, and extract a complete, priceable window-treatment scope.\n\n` +
  `RULES:\n` +
  `- Identify the distinct shade PRODUCTS in scope as written — DO NOT assume a fixed tag vocabulary. Projects label them differently ("Shade Type 1-5", "WT1/MB1", "SHD", "RS-1"…). For each, capture a descriptive product name (e.g. "Motorized solar roller shade", "Manual room-darkening dual shade", "Manual aluminum mini-blind"), whether it is MANUAL or MOTORIZED, and the fabric/light character (solar screen, room-darkening/blackout, dual, multi-band).\n` +
  `- A DOUBLE / DUAL shade (two shades on one bracket — e.g. room-darkening + solar) is ONE opening but a combined product; report it as the dual product (its rate reflects both bands), not as two separate openings.\n` +
  `- For EACH opening/run the schedule lists, report which product it gets, its WIDTH and HEIGHT in INCHES (convert callouts: 2'-6" → 30), the quantity, and the room/location.\n` +
  `- CRITICAL: report width/height/qty ONLY when the schedule/plan states or directly gives them. If a shade is clearly in scope but a dimension or count is not available, set it NULL with lower confidence — a flagged blank becomes a field-measure request, far safer than a guessed number.\n` +
  `- SCOPE ONLY — include an opening ONLY if it RECEIVES a new window treatment in this contract. EXCLUDE any opening marked "existing to remain", "NIC"/"not in contract", or "by others".\n` +
  `- The spec may say some items are "furnished for installation by others" or coordinated with other sections (ceiling pockets under 09 51 13, wiring by Division 26) — these affect scope but are not separate shade products.\n` +
  `- Every field carries a confidence (0..1) and a citation (sheet/page). NEVER invent a value to fill the schema.\n` +
  `- Capture project-team contacts from title blocks, project-team lists, and spec covers. For EACH, pull their EMAIL ADDRESS into the email field whenever one is printed anywhere on the page — title blocks and team blocks often show it beside Tel/Voice/Fax, and firms list a general "info@" address. Put the literal email in the email field, NOT only in the citation. Set email null only when none is printed (a contact with no email is dropped downstream, so don't miss one that's there).\n` +
  `- List any sheets/specs the documents reference but that may not be present (e.g. "see A-601"), for downstream gap-chasing.\n` +
  `- Score trade relevance (bid/no-bid). No-bid signals: ${cfg.noBidSignals.join("; ")}.\n` +
  (cfg.disambiguation ? `- Disambiguation: ${cfg.disambiguation}\n` : "") +
  (cfg.requiredEvidence?.length ? `- For evidenceFound, report present/absent for each of these keys: ${cfg.requiredEvidence.map((e) => e.key).join(", ")}.` : "");

export interface WtExtractOutput {
  result: WtExtractionResult;
  usage: Usage;
}

/** Single structured pass over the relevant pages of the whole package (pre-merged
 *  into one base64 PDF by the caller). Shades come from the schedule + Section 12
 *  spec — no tiled vision tag-count (the old WT1/MB1/FPS1 path is retired). */
export async function extractWt(pagesB64: string, cfg: WtVerticalConfig, pageCount: number): Promise<WtExtractOutput> {
  const { data, message } = await structuredCall({
    model: MODELS.extract,
    system: SYSTEM(cfg),
    content: [
      pdfBlock(pagesB64),
      { type: "text", text: `These are the ${pageCount} pages flagged as relevant across the package. Extract the full window-treatment scope now.` },
    ],
    toolName: "report_wt_scope",
    toolDescription: "Report the extracted window-treatment scope (shade products, scheduled openings with sizes + qty + room), contacts, and evidence found.",
    schema: WtExtractionResult,
    maxTokens: 16000,
  });

  return { result: data, usage: addUsage(emptyUsage(), message) };
}