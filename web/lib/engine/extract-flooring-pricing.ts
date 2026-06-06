import { MODELS, addUsage, emptyUsage, pdfBlock, structuredCall, type Usage } from "./anthropic";
import { FlooringPricingDnaExtract } from "./schemas/flooring-pricing-dna";

const SYSTEM =
  `You are setting up a FLOORING subcontractor's pricing model from their OWN past proposals. ` +
  `Read the attached proposals and recover their CHARGED prices (what they quote customers — never cost or margin).\n\n` +
  `Flooring is priced by the SQUARE FOOT, by system. Extract:\n` +
  `- systems: for EACH floor system they install (e.g. self-leveling epoxy, urethane cement, carpet tile, broadloom, LVT, VCT, polished concrete, sealed concrete, hardwood, tile), the charged price PER SQUARE FOOT. Use the contractor's own wording for the system name.\n` +
  `- prepPerSqft: substrate prep charged per SF (grinding/shot-blast/moisture mitigation/leveling), if itemized.\n` +
  `- baseTrimPerLf: cove/wall base + transitions charged per linear foot, if itemized.\n` +
  `- globalCharges: per-project charges added on top of the floor systems (mobilization, delivery, minimum). One entry each {label, amount, kind}. kind="flat" for a fixed $; kind="percent" if quoted as a % of the material/product total (amount is the percent). Empty if none.\n` +
  `- discountPct / taxPct: any standard discount and the sales-tax rate seen.\n` +
  `- paymentTerms, warranty, validityDays, exclusions: from the boilerplate.\n\n` +
  `Use ONLY rates you actually see. If something isn't present, leave it null / empty — never invent a price. ` +
  `Set confidence by how consistently the rates appear across the proposals, and proposalsRead to how many you read.`;

export interface FlooringPricingDnaOutput {
  dna: FlooringPricingDnaExtract;
  usage: Usage;
}

/** Read 1–N of a flooring contractor's past proposals (single combined base64 PDF)
 *  and recover their per-SF charged-price rate card by system. */
export async function extractFlooringPricingDna(proposalsB64: string): Promise<FlooringPricingDnaOutput> {
  const { data, message } = await structuredCall({
    model: MODELS.extract,
    system: SYSTEM,
    content: [
      pdfBlock(proposalsB64),
      { type: "text", text: "Recover this contractor's flooring charged-price model (per-SF by system, prep, base/trim, mobilization) from these proposals." },
    ],
    toolName: "report_flooring_pricing_dna",
    toolDescription: "The flooring contractor's charged-price rate card + boilerplate, recovered from their own proposals.",
    schema: FlooringPricingDnaExtract,
    maxTokens: 4000,
  });
  return { dna: data, usage: addUsage(emptyUsage(), message) };
}
