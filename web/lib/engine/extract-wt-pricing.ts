import { MODELS, addUsage, emptyUsage, pdfBlock, structuredCall, type Usage } from "./anthropic";
import { WtPricingDnaExtract } from "./schemas/wt-pricing-dna";

const SYSTEM =
  `You are setting up a WINDOW TREATMENTS subcontractor's pricing model from their OWN past proposals. ` +
  `Read the attached proposals and recover their CHARGED prices (what they quote customers — never cost or margin).\n\n` +
  `Window treatments are priced PER UNIT (one shade/blind), by product, and the unit price varies by SIZE (small / standard / large). Extract:\n` +
  `- products: ONE row per distinct product, by OPERATION (manual vs motorized) and FABRIC/light character (solar vs room-darkening/blackout vs dual vs multi-band). Use the contractor's OWN wording.\n` +
  `  • priceStandard = the per-unit price at the typical/default size (if only one price exists for the product, put it here).\n` +
  `  • priceSmall / priceLarge = the per-unit price if the proposal shows the SAME product cheaper at a smaller size / pricier at a larger size; else null.\n` +
  `  • If the same product appears at several sizes/prices, FOLD them into ONE row's small/standard/large — NEVER create two rows for the same product.\n` +
  `  • Do NOT split by ganging ("2 on 1 motor", "3 on 1 motor") — recover one per-unit price; grouped savings go in discountPct.\n` +
  `- size buckets (in INCHES): infer the workspace's Small / Standard / Large cutoffs (max width + height of each) from the window sizes you see across the proposals. Leave null if you can't tell.\n` +
  `- mobilizationFee: any flat mobilization/setup/minimum fee.\n` +
  `- discountPct / taxPct: any standard discount (and grouped-shade savings) and the sales-tax rate seen.\n` +
  `- paymentTerms, warranty, validityDays, exclusions: from the boilerplate.\n\n` +
  `Use ONLY rates you actually see. If something isn't present, leave it null / empty — never invent a price. ` +
  `Set confidence by how consistently the rates appear across the proposals, and proposalsRead to how many you read.`;

export interface WtPricingDnaOutput {
  dna: WtPricingDnaExtract;
  usage: Usage;
}

/**
 * Make product NAMES unique. Same-named products (the model occasionally emits two
 * rows for one product it couldn't fold) would otherwise collide in the name→product
 * map downstream — one silently wins. Suffix each duplicate with its Standard price.
 */
function disambiguateNames(products: WtPricingDnaExtract["products"]): WtPricingDnaExtract["products"] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const counts = new Map<string, number>();
  for (const p of products) counts.set(norm(p.name), (counts.get(norm(p.name)) ?? 0) + 1);
  return products.map((p) => ((counts.get(norm(p.name)) ?? 0) <= 1 ? p : { ...p, name: `${p.name} ($${p.priceStandard})` }));
}

/** Read 1–N of a window-treatments contractor's past proposals (single combined
 *  base64 PDF) and recover their per-product, per-size-tier charged-price rate card. */
export async function extractWtPricingDna(proposalsB64: string): Promise<WtPricingDnaOutput> {
  const { data, message } = await structuredCall({
    model: MODELS.extract,
    system: SYSTEM,
    content: [
      pdfBlock(proposalsB64),
      { type: "text", text: "Recover this contractor's window-treatment charged-price model (per-product small/standard/large prices, the S/M/L size cutoffs, mobilization, discount/tax, boilerplate) from these proposals." },
    ],
    toolName: "report_wt_pricing_dna",
    toolDescription: "The window-treatments contractor's charged-price rate card + boilerplate, recovered from their own proposals.",
    schema: WtPricingDnaExtract,
    maxTokens: 4000,
  });
  return { dna: { ...data, products: disambiguateNames(data.products) }, usage: addUsage(emptyUsage(), message) };
}
