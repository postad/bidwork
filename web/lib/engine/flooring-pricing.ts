import type { SupabaseClient } from "@supabase/supabase-js";
import type { FlooringPricingDNA } from "./flooring-price";

/**
 * Build a flooring FlooringPricingDNA from a workspace's pricing_items rows for a
 * flooring sub-trade. Codes (parallels the WT loader in pricing.ts):
 *   SYS  → pricing.bySystem: [{name, perSqft}]   (the contractor's material catalog)
 *   PREP → sell_price ($/SF substrate prep)
 *   BASE → sell_price ($/LF base/trim)
 *   MOB  → sell_price (flat mobilization)
 *   TAX / DISCOUNT → sell_price as a percent (÷100), same convention as WT (0004).
 * Returns null if the rate card is incomplete (no priceable systems or no
 * mobilization) — the caller skips that contractor with a logged reason.
 */
export async function loadFlooringPricingDNA(
  db: SupabaseClient,
  workspaceId: string,
  tradeId: string,
): Promise<FlooringPricingDNA | null> {
  const { data: items, error } = await db
    .from("pricing_items")
    .select("code, sell_price, pricing")
    .eq("workspace_id", workspaceId)
    .eq("trade_id", tradeId)
    .eq("active", true);
  if (error) throw new Error(`load pricing_items: ${error.message}`);

  const byCode = new Map((items ?? []).map((i) => [i.code, i]));
  const sys = byCode.get("SYS")?.pricing as { bySystem?: { name: string; perSqft: number }[] } | undefined;
  const prep = byCode.get("PREP")?.sell_price;
  const base = byCode.get("BASE")?.sell_price;
  const mob = byCode.get("MOB")?.sell_price;
  const tax = byCode.get("TAX")?.sell_price;
  const discount = byCode.get("DISCOUNT")?.sell_price;

  const systems = (sys?.bySystem ?? []).filter((s) => s && s.name && s.perSqft != null);
  // A flooring rate card just needs ≥1 priceable system. Mobilization is OPTIONAL
  // (most contractors don't charge it separately) — treat missing as $0, don't skip.
  if (!systems.length) return null;

  return {
    salesTaxRate: tax != null ? Number(tax) / 100 : 0,
    mobilizationFee: mob != null ? Number(mob) : 0,
    defaultDiscountPct: discount != null ? Number(discount) / 100 : 0,
    rates: {
      systems: systems.map((s) => ({ name: s.name, perSqft: Number(s.perSqft) })),
      prepPerSqft: prep != null ? Number(prep) : null,
      baseTrimPerLf: base != null ? Number(base) : null,
    },
  };
}
