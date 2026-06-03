"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Learning loop: apply a contractor's price edit back to their Pricing DNA so the
 * next auto-generated bid uses the corrected rate. Maps the edited line (by code +
 * attrs) onto the right rate-card entry — WT by ganging, MB by width tier, FPS flat.
 * Human-in-the-loop by design: the contractor chooses to teach the rate card.
 */
export async function applyPricingEdit(editId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: profile } = await supabase.from("profiles").select("workspace_id").eq("id", user.id).single();
  if (!profile?.workspace_id) throw new Error("No workspace on this account.");

  const { data: edit } = await supabase.from("bid_edits").select("new_value, line_item_id").eq("id", editId).single();
  if (!edit?.line_item_id) throw new Error("Edit not found");
  const newPrice = Number(edit.new_value);

  const { data: line } = await supabase.from("bid_line_items").select("type_code, attrs").eq("id", edit.line_item_id).single();
  if (!line?.type_code) throw new Error("Line item not found");
  const code = line.type_code;
  const attrs = (line.attrs ?? {}) as { shadesPerMotor?: number; widthInches?: number };

  const { data: trade } = await supabase.from("trades").select("id").eq("slug", "window-treatments").single();
  if (!trade) throw new Error("window-treatments trade not found");
  const { data: item } = await supabase
    .from("pricing_items")
    .select("id, pricing, sell_price")
    .eq("workspace_id", profile.workspace_id)
    .eq("trade_id", trade.id)
    .eq("code", code)
    .single();
  if (!item) throw new Error(`No rate-card row for ${code} — set it up in onboarding first.`);

  const pricing = (item.pricing ?? {}) as { byShadesPerMotor?: Record<string, number>; byWidthTier?: { maxWidthInches: number; price: number }[] };
  let sellPrice = item.sell_price as number | null;

  if (code === "WT" && attrs.shadesPerMotor != null) {
    pricing.byShadesPerMotor = { ...(pricing.byShadesPerMotor ?? {}), [String(attrs.shadesPerMotor)]: newPrice };
  } else if (code === "MB") {
    const w = Number(attrs.widthInches ?? 0);
    const tiers = pricing.byWidthTier ?? [];
    const tier = tiers.find((t) => w <= t.maxWidthInches) ?? tiers[tiers.length - 1];
    if (tier) tier.price = newPrice;
    pricing.byWidthTier = tiers;
  } else if (code === "FPS") {
    sellPrice = newPrice;
  } else {
    throw new Error(`Can't map a ${code} edit to the rate card.`);
  }

  const { error } = await supabase.from("pricing_items").update({ pricing, sell_price: sellPrice }).eq("id", item.id);
  if (error) throw new Error(`update rate card: ${error.message}`);

  revalidatePath("/app");
  return { ok: true };
}
