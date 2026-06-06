/**
 * Global charges — flat or percentage fees a contractor adds on top of the priced
 * products (Installation, Delivery, mobilization, minimum). Shared across verticals
 * (window-treatments, flooring, …) so every trade prices charges the same way.
 */
export type GlobalCharge = { label: string; amount: number; kind: "flat" | "percent" };

/** Sum charges against a base (the products subtotal): flat $ as-is, percent as %×base. */
export function sumGlobalCharges(charges: GlobalCharge[] | undefined | null, base: number): number {
  if (!charges?.length) return 0;
  const n = charges.reduce((a, c) => a + (c.kind === "percent" ? (base * (Number(c.amount) || 0)) / 100 : Number(c.amount) || 0), 0);
  return Math.round(n * 100) / 100;
}

/** Parse a stored CHARGES pricing_items row (with a legacy flat MOB fallback). */
export function parseGlobalCharges(chargeItems: { label: string; amount: number; kind?: "flat" | "percent" }[] | undefined, legacyFlat: number | null): GlobalCharge[] {
  if (chargeItems?.length) {
    return chargeItems.filter((c) => c && c.label && c.amount != null).map((c) => ({ label: c.label, amount: Number(c.amount), kind: c.kind === "percent" ? "percent" : "flat" }));
  }
  return legacyFlat != null ? [{ label: "Mobilization", amount: Number(legacyFlat), kind: "flat" }] : [];
}
