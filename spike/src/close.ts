import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
dotenv.config({ path: resolve(ROOT, ".env") });

import { loadDoc, subsetBase64 } from "./lib/pdf.js";
import { priceScope, type PricingDNA, type Scope } from "./pipeline/price.js";
import { assemble } from "./pipeline/assemble.js";

const PDF = resolve(ROOT, "Projects/2160-Sunrise-Hwy-Merrick/Permit and Bid Set.pdf");
const TARGET = 17003.01;

function show(title: string, p: ReturnType<typeof priceScope>) {
  console.log(`\n${title}`);
  for (const l of p.lines) console.log(`   ${l.qty}× ${l.label.padEnd(48)} @ $${l.unitRate} = $${l.amount}`);
  console.log(`   products $${p.productsSubtotal}  ·  discount ${(p.discountPct * 100).toFixed(0)}% $${p.discount}  ·  install $${p.installFee}`);
  console.log(`   subtotal $${p.subtotal}  ·  tax $${p.tax}  ·  TOTAL $${p.total}`);
}

async function main() {
  const dna: PricingDNA = JSON.parse(await readFile(resolve(__dirname, "../config/pricing-dna.shade-co.json"), "utf8"));

  // ── PART 1 · Pricing engine proof (deterministic, no API) ─────────────────
  // The confirmed scope (what the contractor approves in review) → must reproduce $17,003.01.
  const confirmed: Scope = {
    motorizedSets: [
      { shadesPerMotor: 2, location: "set A" }, { shadesPerMotor: 2, location: "set B" },
      { shadesPerMotor: 3, location: "set C" }, { shadesPerMotor: 3, location: "set D" },
      { shadesPerMotor: 1, location: "set E" },
    ],
    blinds: [
      ...Array.from({ length: 8 }, () => ({ widthInches: 48, location: "wide" })),
      ...Array.from({ length: 4 }, () => ({ widthInches: 28, location: "narrow" })),
    ],
    fixedPanels: 2,
  };
  const proof = priceScope(confirmed, dna);
  show("PART 1 · Confirmed scope priced deterministically", proof);
  const exact = proof.total === TARGET;
  console.log(`   → matches submitted proposal ($${TARGET})? ${exact ? "✅ EXACT" : `❌ off by $${(proof.total - TARGET).toFixed(2)}`}`);

  if (process.argv.includes("--proof-only")) return;
  if (!process.env.ANTHROPIC_API_KEY) { console.error("\n❌ ANTHROPIC_API_KEY not set.\n"); process.exit(1); }

  // ── PART 2 · Fully automated read (AI assemble from the plan) ─────────────
  const count = JSON.parse(await readFile(resolve(__dirname, "../out/2160-sunrise.count.json"), "utf8"));
  const counts = { WT: count.total.WT1 ?? 0, MB: count.total.MB1 ?? 0, FPS: count.total.FPS1 ?? 0 };

  const { doc } = await loadDoc(PDF);
  const planB64 = await subsetBase64(doc, [12, 13]); // A-402 plan + details (pages 13-14)

  console.log("\nPART 2 · AI assemble (reading ganging + widths from A-402)…");
  const { scope, usage } = await assemble(planB64, counts);
  console.log(`   motorized sets: ${scope.motorizedSets.map((s) => s.shadesPerMotor).join("+")} shades/motor`);
  console.log(`   blinds: ${scope.blinds.length} (widths ${[...new Set(scope.blinds.map((b) => b.widthInches))].join(", ")})  ·  fixed: ${scope.fixedPanels}`);
  const auto = priceScope(scope, dna);
  show("   Automated draft priced", auto);
  console.log(`   → vs submitted proposal: $${auto.total} vs $${TARGET}  (Δ $${(auto.total - TARGET).toFixed(2)})`);
  console.log(`   tokens: ${usage.input}→${usage.output}`);

  console.log(`\n────────────────────────────────────────`);
  console.log(`Pricing engine: ${exact ? "exact" : "off"}.  Automated read total: $${auto.total} (proposal $${TARGET}).`);
  console.log(`Residual deltas are the ganging tiers / blind sizes the contractor confirms in review — by design.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
