import { z } from "zod";

/**
 * Pricing-DNA extracted from a flooring contractor's OWN past proposals. Maps onto
 * the flooring pricing model (lib/engine/flooring-price.ts + flooring-pricing.ts):
 * per-SF charged price for each system the contractor installs, plus substrate prep
 * ($/SF), base/trim ($/LF), mobilization, and the tenant's typical discount/tax and
 * boilerplate. Material-agnostic — `systems` is whatever they actually quote
 * (epoxy, carpet, polished concrete, …).
 *
 * Flat shape (scalars + arrays only, no top-level objects). See [[engine-flat-tool-schemas]].
 */
export const FlooringPricingDnaExtract = z.object({
  systems: z
    .array(z.object({
      name: z.string().describe("Floor system as the contractor names it, e.g. 'Self-leveling epoxy', 'Carpet tile', 'Polished concrete L3'"),
      perSqft: z.number().describe("charged price per square foot"),
      source: z.string().nullable(),
    }))
    .describe("Per-SF charged price for each floor system the contractor installs. Empty if not found."),
  prepPerSqft: z.number().nullable().describe("Substrate prep charged price per SF (grind/shot-blast/moisture/leveling)"),
  baseTrimPerLf: z.number().nullable().describe("Base / cove / transition charged price per linear foot"),
  mobilizationFee: z.number().nullable().describe("Flat mobilization / setup fee per project"),
  discountPct: z.number().nullable().describe("Typical proposal discount as a percent, e.g. 10"),
  taxPct: z.number().nullable().describe("Sales tax rate as a percent, e.g. 8.875"),
  paymentTerms: z.string().nullable().describe("e.g. '50% deposit, 50% on completion'"),
  warranty: z.string().nullable(),
  validityDays: z.number().int().nullable().describe("How many days the quote is valid"),
  exclusions: z.array(z.string()).describe("Standard exclusions from the proposals' boilerplate"),
  confidence: z.number().min(0).max(1),
  proposalsRead: z.number().int(),
});

export type FlooringPricingDnaExtract = z.infer<typeof FlooringPricingDnaExtract>;
