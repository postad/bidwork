import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
dotenv.config({ path: resolve(ROOT, ".env") });

import { loadDoc, chunkForApi } from "./lib/pdf.js";
import { triage } from "./pipeline/triage.js";
import { extract } from "./pipeline/extract.js";
import { detectGaps } from "./pipeline/gaps.js";

const DEFAULT_SAMPLE = resolve(ROOT, "Projects/2160-Sunrise-Hwy-Merrick/Permit and Bid Set.pdf");

async function main() {
  const args = process.argv.slice(2);
  const probeOnly = args.includes("--probe-only");
  const samplePath = args.find((a) => !a.startsWith("--")) ?? DEFAULT_SAMPLE;

  console.log(`\n📄 Sample: ${samplePath}`);
  const { doc, pageCount, bytes } = await loadDoc(samplePath);
  console.log(`   ${pageCount} pages · ${(bytes / 1024 / 1024).toFixed(1)} MB`);

  const chunks = await chunkForApi(doc);
  console.log(`   → ${chunks.length} API chunk(s): ${chunks.map((c) => `${c.pageIndices.length}p/${(c.bytes / 1024 / 1024).toFixed(0)}MB`).join(", ")}`);

  if (probeOnly) {
    console.log("\n(--probe-only: stopping before any API calls.)\n");
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("\n❌ ANTHROPIC_API_KEY not set in ../.env — add it and re-run.\n");
    process.exit(1);
  }

  const cfg = JSON.parse(await readFile(resolve(__dirname, "../config/window-treatments.json"), "utf8"));

  // Triage cache — Haiku reads every page, so don't re-spend while iterating on extraction.
  // Keyed per input file so different samples never share a cache.
  await mkdir(resolve(__dirname, "../out"), { recursive: true });
  const slug = samplePath.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const triageCache = resolve(__dirname, `../out/${slug}.triage.json`);
  const freshTriage = args.includes("--fresh-triage");
  let t: Awaited<ReturnType<typeof triage>>;
  if (!freshTriage) {
    try {
      t = JSON.parse(await readFile(triageCache, "utf8"));
      console.log("\n🔎 Triage — using cached result (pass --fresh-triage to re-run).");
    } catch {
      console.log("\n🔎 Triage (Haiku) — finding the pages that matter…");
      t = await triage(doc, cfg.router.keywords);
      await writeFile(triageCache, JSON.stringify(t, null, 2));
    }
  } else {
    console.log("\n🔎 Triage (Haiku) — finding the pages that matter…");
    t = await triage(doc, cfg.router.keywords);
    await writeFile(triageCache, JSON.stringify(t, null, 2));
  }
  console.log(`   relevant pages: ${t.relevantPages.map((p) => p + 1).join(", ") || "(none)"}`);
  console.log(`   window-treatment scope present: ${t.anyScope}`);

  console.log("\n🧠 Extract (Opus) — structured scope from the relevant pages…");
  const e = await extract(doc, t.relevantPages, cfg);

  const gaps = detectGaps(e.result, cfg);

  // ---- Summary vs ground truth ----
  console.log("\n────────── RESULT ──────────");
  console.log(`trade relevance : ${e.result.tradeRelevance.bid ? "BID" : "NO-BID"} (${(e.result.tradeRelevance.confidence * 100).toFixed(0)}%)`);
  console.log(`shade types     : ${e.result.shadeTypes.map((s) => s.code).join(", ") || "(none)"}`);
  console.log(`unit totals     : ${JSON.stringify(e.result.unitTotals.byProductType)} (total ${e.result.unitTotals.totalUnits})`);
  console.log(`locations       : ${e.result.locations.length}`);
  console.log(`contacts        : ${e.result.contacts.length} (${e.result.contacts.filter((c) => c.email).length} with email)`);
  console.log(`gaps            : ${gaps.filter((g) => g.severity === "critical").length} critical, ${gaps.filter((g) => g.severity === "warning").length} warning`);
  console.log(`\nGROUND TRUTH (Estimate #14473): WT1=11 motorized, MB1=12 blinds, FPS1=2 fixed → 25 units total.`);

  const tok = { triageIn: t.usage.input, triageOut: t.usage.output, extractIn: e.usage.input, extractOut: e.usage.output };
  console.log(`\ntokens          : triage ${tok.triageIn}→${tok.triageOut} · extract ${tok.extractIn}→${tok.extractOut}`);

  // ---- Persist ----
  await mkdir(resolve(__dirname, "../out"), { recursive: true });
  const outPath = resolve(__dirname, `../out/${slug}.result.json`);
  await writeFile(outPath, JSON.stringify({ triage: t, extraction: e.result, gaps, tokens: tok }, null, 2));
  console.log(`\n💾 Full result → ${outPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
