import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
dotenv.config({ path: resolve(ROOT, ".env") });

import { countPage, type PageCount } from "./pipeline/count.js";
import type { Usage } from "./lib/anthropic.js";

const PDF = resolve(ROOT, "Projects/2160-Sunrise-Hwy-Merrick/Permit and Bid Set.pdf");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("\n❌ ANTHROPIC_API_KEY not set in ../.env\n");
    process.exit(1);
  }

  const dpi = Number(arg("dpi") ?? 150);

  // Pages to count: --pages 11,12  (1-based) OR the floor_plan/rcp pages from cached triage.
  let pages1: number[];
  const pagesArg = arg("pages");
  if (pagesArg) {
    pages1 = pagesArg.split(",").map((s) => Number(s.trim()));
  } else {
    const triage = JSON.parse(await readFile(resolve(__dirname, "../out/2160-sunrise.triage.json"), "utf8"));
    // Count on any page that places treatment tags — including the "shade_schedule"
    // page, which on this project IS the tagged plan (A-402), not a tabular schedule.
    pages1 = [...new Set((triage.details as { page: number; kind: string }[]).filter((d) => ["floor_plan", "rcp", "shade_schedule", "elevation"].includes(d.kind)).map((d) => d.page))];
  }

  // Type codes from the extraction pass.
  let typeCodes = ["WT1", "MB1", "FPS1"];
  try {
    const ext = JSON.parse(await readFile(resolve(__dirname, "../out/2160-sunrise.result.json"), "utf8"));
    typeCodes = [...new Set([...typeCodes, ...ext.extraction.shadeTypes.map((s: { code: string }) => s.code.toUpperCase().replace(/[\s-]/g, ""))])];
  } catch {}

  console.log(`\n🔢 Counting pass — pages ${pages1.join(", ")} @ ${dpi}dpi · types ${typeCodes.join(", ")}\n`);

  const pageResults: PageCount[] = [];
  let usage: Usage = { input: 0, output: 0 };
  for (const p1 of pages1) {
    const { page, usage: u } = await countPage(PDF, p1 - 1, typeCodes, { dpi });
    pageResults.push(page);
    usage = { input: usage.input + u.input, output: usage.output + u.output };
  }

  const total: Record<string, number> = {};
  for (const pr of pageResults) for (const [k, v] of Object.entries(pr.byType)) total[k] = (total[k] ?? 0) + v;

  console.log("\n────────── COUNT RESULT ──────────");
  console.log(`per-page : ${pageResults.map((p) => `p${p.pageIndex + 1}=${JSON.stringify(p.byType)}`).join("  ")}`);
  console.log(`TOTAL    : ${JSON.stringify(total)}`);
  console.log(`\nGROUND TRUTH: WT1=11 (motorized shades), MB1=12 (mini-blinds), FPS1=2 (fixed) → 25 units.`);
  console.log(`tokens   : count ${usage.input}→${usage.output} (model ${process.env.MODEL_COUNT ?? "claude-sonnet-4-6"})`);

  await mkdir(resolve(__dirname, "../out"), { recursive: true });
  const out = resolve(__dirname, `../out/2160-sunrise.count.json`);
  await writeFile(out, JSON.stringify({ dpi, pages: pages1, typeCodes, pageResults, total, usage }, null, 2));
  console.log(`\n💾 ${out}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
