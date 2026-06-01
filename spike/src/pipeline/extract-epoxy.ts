import type { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { subsetBase64 } from "../lib/pdf.js";
import { MODELS, addUsage, pdfBlock, structuredCall, type Usage } from "../lib/anthropic.js";
import { EpoxyExtraction } from "../lib/schema-epoxy.js";

interface EpoxyConfig {
  label: string;
  router: { negativeKeywords: string[] };
  noBidSignals: string[];
  requiredEvidence: { key: string; label: string; blocking: boolean }[];
}

const SYSTEM = (cfg: EpoxyConfig) =>
  `You are the extraction step for an EPOXY / RESINOUS FLOORING contractor (fluid-applied floor coatings: epoxy, urethane cement, MMA, broadcast quartz, polished/sealed concrete).\n\n` +
  `CRITICAL DISAMBIGUATION: the word "epoxy" in construction documents most often refers to things that are NOT this trade:\n` +
  `  • epoxy ANCHORS / epoxy ADHESIVE (e.g. Hilti HIT-HY, rebar dowels, post-installed anchors) — a structural fastener;\n` +
  `  • epoxy NOSE FILLER for stair-tread installation.\n` +
  `Do NOT count those as flooring scope. Decide whether actual epoxy/resinous FLOOR COATING is specified.\n\n` +
  `Negative signals (epoxy that is NOT flooring): ${cfg.router.negativeKeywords.join(", ")}.\n\n` +
  `Extract:\n` +
  `- ALL floor finishes found (code, material type, rooms) — this is how you justify bid/no-bid. Resilient (VCT/LVT/rubber/carpet) is NOT epoxy.\n` +
  `- Any epoxy/resinous floor areas (room, SF, system) — empty if none.\n` +
  `- Substrate: slab-on-grade area & notes (epoxy is applied to concrete, so the structural slab info is relevant context).\n` +
  `- Contacts (with email if present), evidence present/absent for: ${cfg.requiredEvidence.map((e) => e.key).join(", ")}.\n` +
  `- missingDocuments: expected docs not in this package (e.g. architectural finish schedule, Division 09 6x spec).\n\n` +
  `RULES: never invent areas; null + assumption instead. Score trade relevance honestly — no-bid signals: ${cfg.noBidSignals.join("; ")}. ` +
  `If every 'epoxy' is an anchor/adhesive/nose-filler and floors are resilient, this is NO-BID for epoxy flooring (but still note contacts for networking).`;

export async function extractEpoxy(src: PDFDocument, cfg: EpoxyConfig): Promise<{ result: EpoxyExtraction; usage: Usage; pages: number }> {
  const pages = Array.from({ length: Math.min(src.getPageCount(), 90) }, (_, i) => i);
  const base64 = await subsetBase64(src, pages);
  const jsonSchema = z.toJSONSchema(EpoxyExtraction, { target: "draft-7" }) as Record<string, unknown>;

  const { data, message } = await structuredCall({
    model: MODELS.extract,
    system: SYSTEM(cfg),
    content: [pdfBlock(base64), { type: "text", text: "Determine epoxy/resinous flooring scope. Disambiguate epoxy-as-anchor from epoxy-as-floor explicitly." }],
    toolName: "report_epoxy_scope",
    toolDescription: "Report epoxy flooring scope (or its absence), the disambiguation, floor finishes, substrate, contacts, and missing documents.",
    inputSchema: jsonSchema,
    maxTokens: 8000,
  });

  return { result: EpoxyExtraction.parse(data), usage: addUsage({ input: 0, output: 0 }, message), pages: pages.length };
}
