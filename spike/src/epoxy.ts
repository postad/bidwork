import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import dotenv from "dotenv";
import { PDFDocument } from "pdf-lib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
dotenv.config({ path: resolve(ROOT, ".env") });

import { extractEpoxy } from "./pipeline/extract-epoxy.js";

const DIR = resolve(ROOT, "Projects/52626  ABH Absecon");
// The complete package now includes the Architectural Set — the finish schedule
// (A8.01) + finish plans the engine previously flagged as MISSING. We target the
// finish-relevant pages (a real triage step would select these) to stay within
// the 200k-token limit rather than sending all 58 pages of 5 files.
const SELECT: { file: string; pages0: number[] | null }[] = [
  { file: "2. Architectural SetIssued for Permit050826.pdf", pages0: [0, 1, 2, 16, 17, 18, 19, 20] }, // notes + finish schedule + finish plans
  { file: "3. Structural Set Issued for Permit050826.pdf", pages0: [0, 2] }, // SOG / substrate context
];

/** Merge selected pages of a multi-file package into one PDFDocument. */
async function mergePackage(dir: string, select: typeof SELECT): Promise<PDFDocument> {
  const out = await PDFDocument.create();
  for (const s of select) {
    const src = await PDFDocument.load(await readFile(resolve(dir, s.file)), { ignoreEncryption: true });
    const idx = (s.pages0 ?? src.getPageIndices()).filter((i) => i < src.getPageCount());
    const pages = await out.copyPages(src, idx);
    pages.forEach((p) => out.addPage(p));
  }
  return out;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("\n❌ ANTHROPIC_API_KEY not set.\n"); process.exit(1); }
  const cfg = JSON.parse(await readFile(resolve(__dirname, "../config/epoxy-floors.json"), "utf8"));

  console.log(`\n📦 Package: complete set incl. Architectural finish schedule (the doc previously flagged missing)`);
  const doc = await mergePackage(DIR, SELECT);
  console.log(`   merged ${doc.getPageCount()} finish-relevant pages`);

  console.log("\n🧠 Extract (Opus) — epoxy relevance + disambiguation…");
  const { result: e, usage, pages } = await extractEpoxy(doc, cfg);

  console.log("\n────────── EPOXY SCOPE ──────────");
  console.log(`relevance      : ${e.tradeRelevance.bid ? "BID" : "NO-BID"} (${(e.tradeRelevance.confidence * 100).toFixed(0)}%)`);
  console.log(`               : ${e.tradeRelevance.reasoning}`);
  console.log(`disambiguation : epoxy-flooring present? ${e.disambiguation.epoxyFlooringScopePresent} · epoxy=anchor/adhesive? ${e.disambiguation.epoxyMentionsAreAnchorOrAdhesive}`);
  console.log(`               : ${e.disambiguation.explanation}`);
  console.log(`floor finishes :`);
  for (const f of e.floorFinishes) console.log(`   ${(f.code ?? "—").padEnd(6)} ${f.material.padEnd(20)} ${f.rooms ?? ""}`);
  console.log(`epoxy areas    : ${e.epoxyAreas.length ? e.epoxyAreas.map((a) => `${a.room ?? "?"} ${a.sqft ?? "?"}SF`).join(", ") : "(none)"}`);
  console.log(`substrate      : SOG ${e.substrate.slabOnGradeSqft ?? "?"} SF — ${e.substrate.slabNotes ?? ""}`);
  console.log(`contacts       : ${e.contacts.length} (${e.contacts.filter((c) => c.email).length} with email)`);
  console.log(`missing docs   : ${e.missingDocuments.join("; ") || "(none flagged)"}`);
  if (e.assumptions.length) { console.log(`assumptions    :`); for (const a of e.assumptions) console.log(`   • ${a}`); }
  console.log(`\ntokens: extract ${usage.input}→${usage.output} · ${pages} pages`);

  await mkdir(resolve(__dirname, "../out"), { recursive: true });
  await writeFile(resolve(__dirname, "../out/abh-absecon.epoxy.json"), JSON.stringify(e, null, 2));
  console.log(`💾 out/abh-absecon.epoxy.json\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
