import { z } from "zod";

/**
 * Output of the AI pricing-match step. The model decides WHICH rate-card system
 * applies to each scope area (semantic judgment: "grind & seal" ≈ a listed "grind
 * & polish"; "carpet" ≠ a concrete system) — it returns the system NAME, never a
 * number. The script then derives the actual rate from the contractor's list, so a
 * price can never be invented. If nothing reasonably applies, matchedSystem is null
 * and the area is left unpriced (flagged for the contractor), never force-fit.
 *
 * Flat shape (array of scalar-only objects). See [[engine-flat-tool-schemas]].
 */
export const RateMatch = z.object({
  areaIndex: z.number().int().describe("Index of the scope area this decision is for (0-based, matching the input order)"),
  matchedSystem: z.string().nullable().describe("EXACT name of the system from the contractor's price list that applies — copy it verbatim. null if no listed system reasonably applies (do NOT force a match)."),
  source: z.enum(["rate_card", "memory", "unpriced"]).describe("rate_card = matched a listed system; memory = matched a past learned correction; unpriced = nothing applies"),
  confidence: z.number().min(0).max(1),
  reason: z.string().describe("Short reason, e.g. 'grind & seal ≈ your grind & polish'; 'carpet — no concrete system in your list'."),
});

export const RateMatchResult = z.object({
  matches: z.array(RateMatch),
});

export type RateMatchResult = z.infer<typeof RateMatchResult>;
