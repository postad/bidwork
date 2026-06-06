import { MODELS, addUsage, emptyUsage, pdfBlock, structuredCall, type Usage } from "./anthropic";
import { WtPricingDnaExtract } from "./schemas/wt-pricing-dna";

const SYSTEM =
  `You are setting up a WINDOW TREATMENTS subcontractor's pricing model from their OWN past proposals. ` +
  `Read the attached proposals and recover their CHARGED prices (what they quote customers — never cost or margin).\n\n` +
  `Window treatments are priced PER UNIT (one shade/blind), by product. Extract:\n` +
  `- products: for EACH shade product they install, the charged price PER UNIT. Distinguish by OPERATION (manual vs motorized) and FABRIC/light character (solar screen vs room-darkening/blackout vs dual/double vs multi-band) — these price very differently. Also capture manual aluminum/mini blinds, draperies, etc. Use the contractor's OWN wording for the product name (e.g. 'Motorized solar roller shade', 'Manual room-darkening dual shade', 'Manual aluminum blind').\n` +
  `- size: for EACH product, the REFERENCE/default window size that its price is quoted for, formatted EXACTLY as \`60"W x 96"H\`. If the same product appears at several sizes/prices, that SIZE is what distinguishes them — capture each size+price as its own product row (never two identical-named rows). Null only if no size is ever stated.\n` +
  `- DO NOT create separate rows for ganged sets (e.g. "2 shades on 1 motor", "3 on 1 motor"). Recover ONE per-unit price for the product (the single-unit rate); the cheaper grouped pricing is handled by the discount below — note the typical grouping discount in discountPct if you can infer it.\n` +
  `- mobilizationFee: any flat mobilization/setup/minimum fee.\n` +
  `- discountPct / taxPct: any standard discount and the sales-tax rate seen.\n` +
  `- paymentTerms, warranty, validityDays, exclusions: from the boilerplate.\n\n` +
  `Use ONLY rates you actually see. If something isn't present, leave it null / empty — never invent a price. ` +
  `Set confidence by how consistently the rates appear across the proposals, and proposalsRead to how many you read.`;

export interface WtPricingDnaOutput {
  dna: WtPricingDnaExtract;
  usage: Usage;
}

/**
 * Make product NAMES unique. Same-named products (e.g. two "Manual aluminum blind"
 * rows at different prices/sizes the model couldn't tell apart) would otherwise
 * collide in the name→rate map downstream — one price silently wins. Suffix each
 * duplicate with its distinguishing detail: the size if present, else the price.
 */
function disambiguateNames(products: WtPricingDnaExtract["products"]): WtPricingDnaExtract["products"] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const counts = new Map<string, number>();
  for (const p of products) counts.set(norm(p.name), (counts.get(norm(p.name)) ?? 0) + 1);
  return products.map((p) => {
    if ((counts.get(norm(p.name)) ?? 0) <= 1) return p;
    const tag = p.size && p.size.trim() ? p.size.trim() : `$${p.perShade}`;
    return { ...p, name: `${p.name} (${tag})` };
  });
}

/** Read 1–N of a window-treatments contractor's past proposals (single combined
 *  base64 PDF) and recover their per-shade charged-price rate card by product. */
export async function extractWtPricingDna(proposalsB64: string): Promise<WtPricingDnaOutput> {
  const { data, message } = await structuredCall({
    model: MODELS.extract,
    system: SYSTEM,
    content: [
      pdfBlock(proposalsB64),
      { type: "text", text: "Recover this contractor's window-treatment charged-price model (per-shade by product, mobilization, discount/tax, boilerplate) from these proposals." },
    ],
    toolName: "report_wt_pricing_dna",
    toolDescription: "The window-treatments contractor's charged-price rate card + boilerplate, recovered from their own proposals.",
    schema: WtPricingDnaExtract,
    maxTokens: 4000,
  });
  return { dna: { ...data, products: disambiguateNames(data.products) }, usage: addUsage(emptyUsage(), message) };
}
