import { MODELS, addUsage, emptyUsage, pdfBlock, structuredCall, type Usage } from "./anthropic";
import { PricingDnaExtract } from "./schemas/pricing-dna";

const SYSTEM =
  `You are setting up a WINDOW-TREATMENT subcontractor's pricing model from their OWN past proposals. ` +
  `Read the attached proposals and recover their CHARGED prices (what they quote customers — never cost or margin).\n\n` +
  `Extract:\n` +
  `- motorizedByGanging: motorized roller shade price per MOTOR SET, by how many shades share one motor (1/2/3). A "2 on 1 motor" set costs more than a single.\n` +
  `- blindsByWidth: manual aluminum/mini-blind price by window width tier (e.g. ≤30" one rate, wider another).\n` +
  `- fixedPanelPrice: flat price per fixed-panel shade.\n` +
  `- installFee: the delivery/installation fee.\n` +
  `- discountPct / taxPct: any standard discount and the sales-tax rate seen.\n` +
  `- paymentTerms, warranty, validityDays, exclusions: from the boilerplate.\n\n` +
  `Use ONLY rates you actually see. If something isn't present, leave it null / empty — never invent a price. ` +
  `Set confidence by how consistently the rates appear across the proposals, and proposalsRead to how many you read.`;

export interface PricingDnaOutput {
  dna: PricingDnaExtract;
  usage: Usage;
}

/** Read 1–N of the contractor's past proposals (already a single combined base64
 *  PDF) and recover their charged-price rate card. */
export async function extractPricingDna(proposalsB64: string): Promise<PricingDnaOutput> {
  const { data, message } = await structuredCall({
    model: MODELS.extract,
    system: SYSTEM,
    content: [
      pdfBlock(proposalsB64),
      { type: "text", text: "Recover this contractor's window-treatment charged-price model from these proposals." },
    ],
    toolName: "report_pricing_dna",
    toolDescription: "The contractor's charged-price rate card + boilerplate, recovered from their own proposals.",
    schema: PricingDnaExtract,
    maxTokens: 4000,
  });
  return { dna: data, usage: addUsage(emptyUsage(), message) };
}
