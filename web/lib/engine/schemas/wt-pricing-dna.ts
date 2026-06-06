import { z } from "zod";

/**
 * Pricing-DNA from a window-treatments contractor's OWN past proposals → the per-PRODUCT,
 * per-SIZE-TIER WT model (lib/engine/wt-price.ts). Each product has up to three prices
 * (small / STANDARD / large); the workspace's S/M/L size cutoffs are recovered once.
 *
 * Flat shape (scalars + arrays only, no top-level objects — see [[engine-flat-tool-schemas]]):
 * the size buckets are flattened to six top-level numbers; each product carries three
 * scalar prices.
 */
export const WtPricingDnaExtract = z.object({
  products: z
    .array(z.object({
      name: z.string().describe("Shade product as the contractor names it, by OPERATION + FABRIC (e.g. 'Motorized solar roller shade', 'Manual aluminum blind'). Do NOT split by ganging — that grouping discount is captured in discountPct."),
      priceStandard: z.number().describe("Charged price per UNIT at the STANDARD (default) size. If the proposal shows only one price for this product, put it here."),
      priceSmall: z.number().nullable().describe("Per-unit price for the SMALL size tier, if the proposal shows a cheaper price for smaller units of this same product; else null."),
      priceLarge: z.number().nullable().describe("Per-unit price for the LARGE size tier, if the proposal shows a higher price for larger units of this same product; else null."),
      source: z.string().nullable(),
    }))
    .describe("One row per distinct shade product (by operation+fabric). When the same product appears at multiple sizes/prices, fold them into ONE row's small/standard/large — never two rows for the same product."),
  // Workspace S/M/L size cutoffs (in INCHES), inferred from the sizes seen in the proposals.
  smallMaxW: z.number().nullable().describe('SMALL bucket: max width in inches (a shade up to this W and smallMaxH prices at Small). Null if not inferable.'),
  smallMaxH: z.number().nullable().describe("SMALL bucket: max height in inches."),
  standardMaxW: z.number().nullable().describe("STANDARD bucket: max width in inches (the default size band)."),
  standardMaxH: z.number().nullable().describe("STANDARD bucket: max height in inches."),
  largeMaxW: z.number().nullable().describe("LARGE bucket: max width in inches."),
  largeMaxH: z.number().nullable().describe("LARGE bucket: max height in inches."),
  globalCharges: z
    .array(z.object({
      label: z.string().describe('e.g. "Installation", "Delivery", "Mobilization", "Minimum job charge"'),
      amount: z.number().describe("The dollar amount if kind=flat, or the percent value (e.g. 15) if kind=percent"),
      kind: z.enum(["flat", "percent"]).describe('"flat" = a fixed $ amount; "percent" = a % of the product total (e.g. installation quoted as 15% of materials).'),
    }))
    .describe("Per-project charges the contractor adds on top of products (installation, delivery, mobilization, minimum) — each a flat $ or a % of the products. Empty if none."),
  discountPct: z.number().nullable().describe("Typical proposal discount as a percent, e.g. 10 (also where grouped/ganged savings land)"),
  taxPct: z.number().nullable().describe("Sales tax rate as a percent, e.g. 8.875"),
  paymentTerms: z.string().nullable().describe("e.g. '50% deposit, 50% on completion'"),
  warranty: z.string().nullable(),
  validityDays: z.number().int().nullable().describe("How many days the quote is valid"),
  exclusions: z.array(z.string()).describe("Standard exclusions from the proposals' boilerplate"),
  confidence: z.number().min(0).max(1),
  proposalsRead: z.number().int(),
});

export type WtPricingDnaExtract = z.infer<typeof WtPricingDnaExtract>;
