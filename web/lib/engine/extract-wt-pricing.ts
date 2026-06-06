import { MODELS, addUsage, emptyUsage, pdfBlock, structuredCall, type Usage } from "./anthropic";
import { WtPricingDnaExtract } from "./schemas/wt-pricing-dna";

const SYSTEM =
  `You are setting up a WINDOW TREATMENTS subcontractor's pricing model from their OWN past proposals. ` +
  `Read the attached proposals and recover their CHARGED prices (what they quote customers — never cost or margin).\n\n` +
  `Window treatments are priced PER SHADE, by product. Extract:\n` +
  `- products: for EACH shade product they install, the charged price PER SHADE. Distinguish by OPERATION (manual vs motorized) and FABRIC/light character (solar screen vs room-darkening/blackout vs dual/double vs multi-band) — these price very differently. Also capture manual aluminum/mini blinds, draperies, etc. Use the contractor's OWN wording for the product name (e.g. 'Motorized solar roller shade', 'Manual room-darkening dual shade', 'Manual aluminum blind').\n` +
  `- mobilizationFee: any flat mobilization/setup/minimum fee.\n` +
  `- discountPct / taxPct: any standard discount and the sales-tax rate seen.\n` +
  `- paymentTerms, warranty, validityDays, exclusions: from the boilerplate.\n\n` +
  `Use ONLY rates you actually see. If something isn't present, leave it null / empty — never invent a price. ` +
  `Set confidence by how consistently the rates appear across the proposals, and proposalsRead to how many you read.`;

export interface WtPricingDnaOutput {
  dna: WtPricingDnaExtract;
  usage: Usage;
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
  return { dna: data, usage: addUsage(emptyUsage(), message) };
}
