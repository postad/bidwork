import { z } from "zod";
import { loadDoc, subsetBase64 } from "./pdf";
import { MODELS, addUsage, emptyUsage, pdfBlock, structuredCall, type Usage } from "./anthropic";

/**
 * File triage — the cheap pre-filter in front of the expensive multi-trade scan.
 * A PlanHub project zip bundles ~8 large drawing sets + a spec book + admin junk
 * (takeoff spreadsheets, bid bonds, insurance certs, wage forms). Reading every
 * page of every file with Opus/Sonnet+vision is slow and costly, so here we read
 * ONLY the first pages (the cover / sheet-index — where "what is this file" lives)
 * with Haiku and decide whether the file is worth deep-scanning.
 *
 * SAFE BY DESIGN: we only DROP files the model classifies as clear non-content with
 * high confidence. Specs, drawings, schedules, addenda, and anything uncertain are
 * always kept — a false drop (losing real scope) is far more expensive than scanning
 * one junk file. Sheet-level triage (scan only relevant sheets within a drawing set)
 * is a later upgrade once file-level triage is trusted on real packages.
 */

const TRIAGE_PAGES = 2; // cover + index/TOC is enough to identify a file
const DROP_KINDS = new Set(["takeoff", "admin_junk"]);
const DROP_CONFIDENCE = 0.7;

const TriageVerdict = z.object({
  kind: z.enum(["specs", "drawings", "schedule", "takeoff", "addendum", "admin_junk", "unknown"]),
  keep: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  projectName: z.string().nullable(),
  projectZip: z.string().nullable(), // 5-digit US ZIP off the cover, if present
});
type TriageVerdict = z.infer<typeof TriageVerdict>;

export interface TriageDoc {
  name: string;
  bytes: Uint8Array;
}

export interface TriageResult {
  name: string;
  kind: TriageVerdict["kind"];
  keep: boolean;
  confidence: number;
  reason: string;
  projectName: string | null;
  projectZip: string | null;
}

const SYSTEM =
  `You are the file-triage step of a construction-bidding platform. You see the FIRST pages (cover sheet / table of contents / sheet index) of ONE file pulled from a bid package. ` +
  `Identify the file and decide whether it is worth deep-scanning for biddable trade scope.\n\n` +
  `KIND:\n` +
  `• specs — written specification book (CSI divisions, Section 12 etc.)\n` +
  `• drawings — architectural / structural / MEP drawing set (sheet index, plans, elevations)\n` +
  `• schedule — finish schedule, door/window schedule, equipment schedule\n` +
  `• addendum — addenda / bulletins that may revise scope\n` +
  `• takeoff — a standalone quantity-takeoff spreadsheet/export (not the source drawings)\n` +
  `• admin_junk — bid bond, insurance certificate, prevailing-wage form, sign-in sheet, generic administrative form with no biddable scope\n` +
  `• unknown — can't tell from these pages\n\n` +
  `KEEP RULE: keep=true for specs, drawings, schedule, addendum, and anything you are unsure about. ` +
  `Only set keep=false for takeoff or admin_junk you are confident carry no biddable scope. When in doubt, KEEP — dropping real scope is far worse than scanning a junk file.\n\n` +
  `Also read the cover for the project NAME and the project's 5-digit ZIP/postal code (from the site address) if visible; null if not.`;

async function triageOne(doc: TriageDoc): Promise<{ verdict: TriageVerdict; usage: Usage }> {
  const { doc: src, pageCount } = await loadDoc(doc.bytes);
  const indices = Array.from({ length: Math.min(TRIAGE_PAGES, pageCount) }, (_, i) => i);
  const base64 = await subsetBase64(src, indices);
  const { data, message } = await structuredCall({
    model: MODELS.triage,
    system: SYSTEM,
    content: [
      pdfBlock(base64),
      { type: "text", text: `File name: "${doc.name}". Classify this file and decide keep/drop.` },
    ],
    toolName: "report_triage",
    toolDescription: "Classification + keep decision + project name/ZIP for this one file.",
    schema: TriageVerdict,
    maxTokens: 1024,
  });
  return { verdict: data, usage: addUsage(emptyUsage(), message) };
}

/** Triage each file in parallel. Returns verdicts aligned to the input order. */
export async function triageDocuments(docs: TriageDoc[]): Promise<{ results: TriageResult[]; usage: Usage }> {
  const settled = await Promise.all(
    docs.map(async (d): Promise<{ result: TriageResult; usage: Usage }> => {
      try {
        const { verdict, usage } = await triageOne(d);
        // Only honor a drop for a clear-junk kind at high confidence — otherwise keep.
        const keep = !(DROP_KINDS.has(verdict.kind) && !verdict.keep && verdict.confidence >= DROP_CONFIDENCE);
        return {
          result: { name: d.name, kind: verdict.kind, keep, confidence: verdict.confidence, reason: verdict.reason, projectName: verdict.projectName, projectZip: verdict.projectZip },
          usage,
        };
      } catch (e) {
        // A triage failure must never silently drop a file — keep it and let the scan decide.
        return {
          result: { name: d.name, kind: "unknown", keep: true, confidence: 0, reason: `triage failed, kept: ${(e as Error).message}`, projectName: null, projectZip: null },
          usage: emptyUsage(),
        };
      }
    }),
  );
  let usage = emptyUsage();
  for (const s of settled) usage = { input: usage.input + s.usage.input, output: usage.output + s.usage.output, cacheRead: usage.cacheRead + s.usage.cacheRead, cacheWrite: usage.cacheWrite + s.usage.cacheWrite };
  return { results: settled.map((s) => s.result), usage };
}
