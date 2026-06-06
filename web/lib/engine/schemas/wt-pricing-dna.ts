import { z } from "zod";

/**
 * Pricing-DNA extracted from a window-treatments contractor's OWN past proposals.
 * Maps onto the per-product WT pricing model (lib/engine/wt-price.ts): a charged
 * price PER SHADE for each product the contractor installs, plus mobilization, the
 * tenant's typical discount/tax, and boilerplate. Mirrors the flooring DNA schema,
 * with `products` ($/shade) in place of `systems` ($/SF).
 *
 * Flat shape (scalars + arrays only, no top-level objects). See [[engine-flat-tool-schemas]].
 */
export const WtPricingDnaExtract = z.object({
  products: z
    .array(z.object({
      name: z.string().describe("Shade product as the contractor names it, e.g. 'Motorized solar roller shade', 'Manual room-darkening dual shade', 'Manual aluminum blind'"),
      perShade: z.number().describe("charged price per shade"),
      source: z.string().nullable(),
    }))
    .describe("Per-shade charged price for each shade product the contractor installs. Empty if not found."),
  mobilizationFee: z.number().nullable().describe("Flat mobilization / setup / minimum fee per project"),
  discountPct: z.number().nullable().describe("Typical proposal discount as a percent, e.g. 10"),
  taxPct: z.number().nullable().describe("Sales tax rate as a percent, e.g. 8.875"),
  paymentTerms: z.string().nullable().describe("e.g. '50% deposit, 50% on completion'"),
  warranty: z.string().nullable(),
  validityDays: z.number().int().nullable().describe("How many days the quote is valid"),
  exclusions: z.array(z.string()).describe("Standard exclusions from the proposals' boilerplate"),
  confidence: z.number().min(0).max(1),
  proposalsRead: z.number().int(),
});

export type WtPricingDnaExtract = z.infer<typeof WtPricingDnaExtract>;
