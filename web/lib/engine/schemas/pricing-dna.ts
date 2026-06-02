import { z } from "zod";

/**
 * Pricing-DNA extracted from a contractor's OWN past window-treatment proposals.
 * Maps directly onto the engine's pricing model (see lib/engine/price.ts +
 * lib/engine/pricing.ts): motorized rates by ganging, blind rates by width tier,
 * fixed-panel flat, install, plus the tenant's typical discount/tax and boilerplate.
 *
 * Flat shape (scalars + arrays only, no top-level objects) — Claude mangles
 * top-level object tool-input fields. See [[engine-flat-tool-schemas]].
 */
export const PricingDnaExtract = z.object({
  motorizedByGanging: z
    .array(z.object({ shadesPerMotor: z.number().int().describe("1, 2, or 3 shades on one motor"), price: z.number().describe("charged price per motor SET"), source: z.string().nullable() }))
    .describe("Motorized roller shade charged price by ganging tier. Empty if not found."),
  blindsByWidth: z
    .array(z.object({ maxWidthInches: z.number().describe("upper bound of this width tier in inches"), price: z.number(), source: z.string().nullable() }))
    .describe("Manual aluminum/mini-blind charged price by width tier. Empty if not found."),
  fixedPanelPrice: z.number().nullable().describe("Flat charged price per fixed-panel shade"),
  installFee: z.number().nullable().describe("Flat delivery/installation fee per project"),
  discountPct: z.number().nullable().describe("Typical proposal discount as a percent, e.g. 20"),
  taxPct: z.number().nullable().describe("Sales tax rate as a percent, e.g. 8.875"),
  paymentTerms: z.string().nullable().describe("e.g. '50% deposit, 50% on completion'"),
  warranty: z.string().nullable(),
  validityDays: z.number().int().nullable().describe("How many days the quote is valid"),
  exclusions: z.array(z.string()).describe("Standard exclusions from the proposals' boilerplate"),
  confidence: z.number().min(0).max(1),
  proposalsRead: z.number().int(),
});

export type PricingDnaExtract = z.infer<typeof PricingDnaExtract>;
