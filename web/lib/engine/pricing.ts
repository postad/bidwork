import type { SupabaseClient } from "@supabase/supabase-js";
import type { PricingDNA } from "./price";

/**
 * Build a window-treatments PricingDNA from a workspace's pricing_items rows.
 * Codes: WT (byShadesPerMotor), MB (byWidthTier), FPS (flat sell_price),
 * INSTALL (flat sell_price), TAX/DISCOUNT (sell_price as a percent — see 0004).
 * Returns null if the rate card is incomplete — the caller skips that contractor
 * with a reason (mirrors the "incomplete Pricing DNA" skip in the mockup).
 */
export async function loadWtPricingDNA(
  db: SupabaseClient,
  workspaceId: string,
  tradeId: string,
): Promise<PricingDNA | null> {
  const { data: items, error } = await db
    .from("pricing_items")
    .select("code, sell_price, pricing")
    .eq("workspace_id", workspaceId)
    .eq("trade_id", tradeId)
    .eq("active", true);
  if (error) throw new Error(`load pricing_items: ${error.message}`);

  const byCode = new Map((items ?? []).map((i) => [i.code, i]));
  const wt = byCode.get("WT")?.pricing as { byShadesPerMotor?: Record<string, number> } | undefined;
  const mb = byCode.get("MB")?.pricing as { byWidthTier?: { maxWidthInches: number; price: number }[] } | undefined;
  const fps = byCode.get("FPS")?.sell_price;
  const install = byCode.get("INSTALL")?.sell_price;
  const tax = byCode.get("TAX")?.sell_price;
  const discount = byCode.get("DISCOUNT")?.sell_price;

  // Required pieces for a complete window-treatments rate card.
  if (!wt?.byShadesPerMotor || !mb?.byWidthTier || fps == null || install == null) return null;

  return {
    salesTaxRate: tax != null ? Number(tax) / 100 : 0,
    installFee: Number(install),
    defaultDiscountPct: discount != null ? Number(discount) / 100 : 0,
    rates: {
      WT: { byShadesPerMotor: wt.byShadesPerMotor },
      MB: { byWidthTier: mb.byWidthTier },
      FPS: { flat: Number(fps) },
    },
  };
}
