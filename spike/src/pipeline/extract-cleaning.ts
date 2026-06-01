import type { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { subsetBase64 } from "../lib/pdf.js";
import { MODELS, addUsage, pdfBlock, structuredCall, type Usage } from "../lib/anthropic.js";
import { CleaningExtraction } from "../lib/schema-cleaning.js";

interface CleaningConfig {
  label: string;
  scopeServices: string[];
  noBidSignals: string[];
  requiredEvidence: { key: string; label: string; blocking: boolean }[];
}

const SYSTEM = (cfg: CleaningConfig) =>
  `You are the extraction step for a CONSTRUCTION CLEANING & WASTE-REMOVAL contractor. Their services: ${cfg.scopeServices.join(", ")}.\n\n` +
  `These documents are an architectural/permit set. There is NO dedicated "cleaning" section — that is normal. Derive the cleaning scope from what IS here:\n` +
  `- Floor AREAS by level (read the area schedule on the title sheet and confirm against floor plans). Mark which areas are cleanable.\n` +
  `- Number of levels, bedrooms, BATHROOMS + powder rooms, kitchens (count from the plans).\n` +
  `- WINDOW count (from elevations/schedule) for final glass cleaning.\n` +
  `- Debris / waste signals: new-construction area & volume, disturbed area — these size the haul-off.\n` +
  `- Building type and new-construction vs. renovation.\n\n` +
  `RULES:\n` +
  `- Every number carries a confidence + citation (sheet/page). If a value is not stated, set it null and add an explicit assumption rather than inventing it.\n` +
  `- Decide which of the trade's services actually apply to THIS project (applicableServices).\n` +
  `- Score trade relevance (bid/no-bid). No-bid signals: ${cfg.noBidSignals.join("; ")}. For cleaning, relevance is broad — any real building scope is normally a bid.\n` +
  `- Report present/absent for each evidence key: ${cfg.requiredEvidence.map((e) => e.key).join(", ")}.`;

export async function extractCleaning(src: PDFDocument, cfg: CleaningConfig): Promise<{ result: CleaningExtraction; usage: Usage; pages: number }> {
  const pages = Array.from({ length: Math.min(src.getPageCount(), 90) }, (_, i) => i);
  const base64 = await subsetBase64(src, pages);
  const jsonSchema = z.toJSONSchema(CleaningExtraction, { target: "draft-7" }) as Record<string, unknown>;

  const { data, message } = await structuredCall({
    model: MODELS.extract,
    system: SYSTEM(cfg),
    content: [pdfBlock(base64), { type: "text", text: "Derive the full construction-cleaning & waste-removal scope from this set." }],
    toolName: "report_cleaning_scope",
    toolDescription: "Report the area/count-derived cleaning scope, debris signals, contacts, and evidence.",
    inputSchema: jsonSchema,
    maxTokens: 8000,
  });

  return { result: CleaningExtraction.parse(data), usage: addUsage({ input: 0, output: 0 }, message), pages: pages.length };
}
