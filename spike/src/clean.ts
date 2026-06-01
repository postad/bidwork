import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
dotenv.config({ path: resolve(ROOT, ".env") });

import { loadDoc } from "./lib/pdf.js";
import { extractCleaning } from "./pipeline/extract-cleaning.js";

const DEFAULT = resolve(ROOT, "Projects/62 Eagle   11.02.25/62 Eagle   11.02.25.pdf");
const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("\n❌ ANTHROPIC_API_KEY not set.\n"); process.exit(1); }
  const samplePath = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? DEFAULT;
  const cfg = JSON.parse(await readFile(resolve(__dirname, "../config/cleaning-waste-removal.json"), "utf8"));
  const dna = JSON.parse(await readFile(resolve(__dirname, "../config/pricing-dna.cleaning-illustrative.json"), "utf8"));

  console.log(`\n📄 ${samplePath}`);
  const { doc, pageCount } = await loadDoc(samplePath);
  console.log(`   ${pageCount} pages`);

  console.log("\n🧠 Extract (Opus) — deriving cleaning scope from the architectural set…");
  const { result: e, usage, pages } = await extractCleaning(doc, cfg);

  console.log("\n────────── CLEANING SCOPE ──────────");
  console.log(`relevance : ${e.tradeRelevance.bid ? "BID" : "NO-BID"} (${(e.tradeRelevance.confidence * 100).toFixed(0)}%) — ${e.tradeRelevance.reasoning}`);
  console.log(`project   : ${e.project.buildingType ?? "?"} · ${e.project.work} · ${e.project.address ?? ""}`);
  console.log(`areas     :`);
  for (const a of e.areas) console.log(`   ${a.level.padEnd(16)} ${String(a.sqft ?? "?").padStart(6)} SF  ${a.type}${a.cleanable ? " · cleanable" : ""}`);
  console.log(`totals    : cleanable ${e.totals.cleanableSqft ?? "?"} SF · new ${e.totals.newConstructionSqft ?? "?"} SF · ${e.totals.levels ?? "?"} levels`);
  console.log(`rooms     : ${e.rooms.bedrooms ?? "?"} bed · ${e.rooms.bathrooms ?? "?"} bath · ${e.rooms.powderRooms ?? "?"} powder · ${e.rooms.kitchens ?? "?"} kitchen`);
  console.log(`windows   : ${e.windows.count ?? "?"} (conf ${e.windows.confidence})`);
  console.log(`services  : ${e.applicableServices.join(", ")}`);
  console.log(`contacts  : ${e.contacts.length} (${e.contacts.filter((c) => c.email).length} with email)`);
  if (e.assumptions.length) { console.log(`assumptions:`); for (const a of e.assumptions) console.log(`   • ${a}`); }

  // ── Illustrative pricing (placeholder rates — no ground truth) ──
  const sf = e.totals.cleanableSqft ?? 0;
  const baths = (e.rooms.bathrooms ?? 0) + (e.rooms.powderRooms ?? 0);
  const kitchens = e.rooms.kitchens ?? 0;
  const wins = e.windows.count ?? 0;
  const newSf = e.totals.newConstructionSqft ?? sf;
  const dumpsters = Math.max(1, Math.ceil(newSf / dna.rates.debris.sqftPerDumpster));

  const lines = [
    { label: `Rough clean ${sf} SF @ $${dna.rates.roughCleanPerSqft}/SF`, amt: r2(sf * dna.rates.roughCleanPerSqft) },
    { label: `Final clean ${sf} SF @ $${dna.rates.finalCleanPerSqft}/SF`, amt: r2(sf * dna.rates.finalCleanPerSqft) },
    { label: `${baths} bath/powder @ $${dna.rates.perBathroom}`, amt: baths * dna.rates.perBathroom },
    { label: `${kitchens} kitchen @ $${dna.rates.perKitchen}`, amt: kitchens * dna.rates.perKitchen },
    { label: `${wins} windows @ $${dna.rates.perWindow}`, amt: wins * dna.rates.perWindow },
    { label: `Debris haul-off ${dumpsters} dumpster(s) @ $${dna.rates.debris.perDumpster}`, amt: dumpsters * dna.rates.debris.perDumpster },
  ];
  const subtotal = r2(Math.max(dna.flatMinimum, lines.reduce((a, l) => a + l.amt, 0)));
  const tax = r2(subtotal * dna.salesTaxRate);

  console.log(`\n────────── ILLUSTRATIVE PRICE (placeholder rates) ──────────`);
  for (const l of lines) console.log(`   ${l.label.padEnd(46)} $${l.amt}`);
  console.log(`   subtotal $${subtotal} · tax $${tax} · TOTAL $${r2(subtotal + tax)}`);
  console.log(`   ⚠️  rates are illustrative — no ground-truth cleaning proposal yet.`);

  console.log(`\ntokens: extract ${usage.input}→${usage.output} · ${pages} pages`);
  await mkdir(resolve(__dirname, "../out"), { recursive: true });
  await writeFile(resolve(__dirname, "../out/62-eagle.cleaning.json"), JSON.stringify({ extraction: e, dumpsters, lines, subtotal, tax }, null, 2));
  console.log(`💾 out/62-eagle.cleaning.json\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
