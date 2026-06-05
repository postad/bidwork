import { z } from "zod";

/**
 * Output of the WT envelope check. For each window the model decides only whether
 * it's a NORMAL window the contractor's width/ganging tiers price correctly
 * (inEnvelope=true) or an ABNORMAL one that needs the contractor's own price
 * (inEnvelope=false) — e.g. a 20 ft blind (freight, multi-section), an unusual
 * config, or a product not in the price list. It never sets a price; the tier math
 * stays deterministic. Biased toward in-envelope so normal packages are unchanged.
 *
 * Flat shape (arrays of scalar-only objects). See [[engine-flat-tool-schemas]].
 */
const WtVerdict = z.object({
  index: z.number().int().describe("0-based index of the item, matching input order"),
  inEnvelope: z.boolean().describe("true = a normal window your tiers price fine; false = abnormal/oversized/unsupported → flag for the contractor to price"),
  reason: z.string().describe("Short reason, e.g. 'normal'; '20 ft blind — needs freight + multi-section'; 'drape — not in your price list'."),
});

export const WtMatchResult = z.object({
  motorized: z.array(WtVerdict).describe("One verdict per motorized set, by index"),
  blinds: z.array(WtVerdict).describe("One verdict per blind, by index"),
});

export type WtMatchResult = z.infer<typeof WtMatchResult>;
