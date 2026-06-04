"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { engineDb } from "@/lib/engine/supabase";

/**
 * Pricing-model editor — lets a contractor SEE and fine-tune their trained Pricing
 * DNA after onboarding, per covered sub-trade. Reads/writes pricing_items through
 * the user client (RLS already allows own-workspace rate cards — see applyPricingEdit).
 * Showing the rate card per trade also surfaces the "this trade has no rate card →
 * no priced bid" state directly, which is the QA debug aid.
 */

async function requireWorkspace() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: profile } = await supabase.from("profiles").select("workspace_id").eq("id", user.id).single();
  if (!profile?.workspace_id) throw new Error("No workspace on this account.");
  return { supabase, workspaceId: profile.workspace_id as string };
}

export type FlooringCard = {
  systems: { name: string; perSqft: number }[];
  prepPerSqft: number | null;
  baseTrimPerLf: number | null;
  mobilizationFee: number | null;
  taxPct: number | null;
  discountPct: number | null;
};
export type WtCard = {
  motorized: { shadesPerMotor: number; price: number }[];
  blinds: { maxWidthInches: number; price: number }[];
  fixedPanelPrice: number | null;
  installFee: number | null;
  taxPct: number | null;
  discountPct: number | null;
};
export type TradeCard = {
  tradeId: string;
  slug: string;
  label: string;
  category: string;
  covered: boolean; // is this sub-trade switched on for bidding (workspace_trades)?
  complete: boolean;
  flooring?: FlooringCard;
  wt?: WtCard;
};

type Item = { trade_id: string; code: string; sell_price: number | null; pricing: Record<string, unknown> };

function buildFlooring(items: Item[]): { card: FlooringCard; complete: boolean } {
  const by = new Map(items.map((i) => [i.code, i]));
  const systems = ((by.get("SYS")?.pricing as { bySystem?: { name: string; perSqft: number }[] })?.bySystem ?? []).map((s) => ({ name: s.name, perSqft: Number(s.perSqft) }));
  const num = (c: string) => (by.get(c)?.sell_price != null ? Number(by.get(c)!.sell_price) : null);
  const card: FlooringCard = { systems, prepPerSqft: num("PREP"), baseTrimPerLf: num("BASE"), mobilizationFee: num("MOB"), taxPct: num("TAX"), discountPct: num("DISCOUNT") };
  return { card, complete: systems.length > 0 };
}

function buildWt(items: Item[]): { card: WtCard; complete: boolean } {
  const by = new Map(items.map((i) => [i.code, i]));
  const motorized = Object.entries(((by.get("WT")?.pricing as { byShadesPerMotor?: Record<string, number> })?.byShadesPerMotor ?? {})).map(([k, v]) => ({ shadesPerMotor: Number(k), price: Number(v) })).sort((a, b) => a.shadesPerMotor - b.shadesPerMotor);
  const blinds = (((by.get("MB")?.pricing as { byWidthTier?: { maxWidthInches: number; price: number }[] })?.byWidthTier ?? [])).map((t) => ({ maxWidthInches: Number(t.maxWidthInches), price: Number(t.price) }));
  const num = (c: string) => (by.get(c)?.sell_price != null ? Number(by.get(c)!.sell_price) : null);
  const card: WtCard = { motorized, blinds, fixedPanelPrice: num("FPS"), installFee: num("INSTALL"), taxPct: num("TAX"), discountPct: num("DISCOUNT") };
  return { card, complete: motorized.length > 0 && blinds.length > 0 && card.fixedPanelPrice != null && card.installFee != null };
}

/**
 * Load EVERY sub-trade in the contractor's category (not just the ones they cover),
 * each tagged covered/not + its current rate card. The Settings page is now the one
 * place to switch a service on for bidding AND price it — no separate picker.
 */
export async function getPricingModel(): Promise<{ category: string | null; cards: TradeCard[] }> {
  const { supabase, workspaceId } = await requireWorkspace();

  const { data: wt } = await supabase.from("workspace_trades").select("trade_id").eq("workspace_id", workspaceId);
  const coveredIds = new Set((wt ?? []).map((r) => r.trade_id as string));

  // The contractor's category, inferred from any trade they already cover.
  let category: string | null = null;
  if (coveredIds.size) {
    const { data: cov } = await supabase.from("trades").select("category").in("id", [...coveredIds]).limit(1);
    category = (cov?.[0]?.category as string) ?? null;
  }
  if (!category) return { category: null, cards: [] };

  const { data: trades } = await supabase.from("trades").select("id, slug, label, category").eq("category", category).eq("active", true).order("label");
  const { data: items } = await supabase.from("pricing_items").select("trade_id, code, sell_price, pricing").eq("workspace_id", workspaceId).eq("active", true);
  const itemsByTrade = new Map<string, Item[]>();
  for (const it of (items ?? []) as Item[]) {
    if (!itemsByTrade.has(it.trade_id)) itemsByTrade.set(it.trade_id, []);
    itemsByTrade.get(it.trade_id)!.push(it);
  }

  const cards = (trades ?? [])
    .map((t) => {
      const its = itemsByTrade.get(t.id) ?? [];
      const base = { tradeId: t.id as string, slug: t.slug as string, label: t.label as string, category: (t.category as string) ?? "", covered: coveredIds.has(t.id as string) };
      if (t.category === "flooring") {
        const { card } = buildFlooring(its);
        return { ...base, flooring: card, complete: card.systems.length > 0 };
      }
      if (t.category === "window-treatments") {
        const { card, complete } = buildWt(its);
        return { ...base, wt: card, complete };
      }
      return { ...base, complete: false };
    })
    // Covered services first, then the rest of the catalog alphabetically.
    .sort((a, b) => Number(b.covered) - Number(a.covered) || a.label.localeCompare(b.label));

  return { category, cards };
}

/** Switch a sub-trade ON/OFF for bidding (workspace_trades). New coverage inherits
 *  the contractor's existing service area. Writes via service role (workspace_trades
 *  is operator-managed under RLS). */
export async function setTradeCoverage(tradeId: string, open: boolean) {
  const { workspaceId } = await requireWorkspace();
  const db = engineDb();

  if (open) {
    const { data: rows } = await db.from("workspace_trades").select("center_zip, center_lat, center_lng, radius_mi").eq("workspace_id", workspaceId).limit(1);
    const geo = rows?.[0];
    const { error } = await db.from("workspace_trades").upsert(
      { workspace_id: workspaceId, trade_id: tradeId, center_zip: geo?.center_zip ?? null, center_lat: geo?.center_lat ?? null, center_lng: geo?.center_lng ?? null, radius_mi: geo?.radius_mi ?? 100 },
      { onConflict: "workspace_id,trade_id" },
    );
    if (error) throw new Error(`open trade: ${error.message}`);
  } else {
    const { error } = await db.from("workspace_trades").delete().eq("workspace_id", workspaceId).eq("trade_id", tradeId);
    if (error) throw new Error(`close trade: ${error.message}`);
  }

  revalidatePath("/app/settings/pricing");
  return { ok: true };
}

type Row = { workspace_id: string; trade_id: string; code: string; label: string; unit: string; sell_price: number | null; pricing: Record<string, unknown> };

/** Save one sub-trade's rate card back to pricing_items. */
export async function savePricingCard(tradeId: string, category: string, card: FlooringCard | WtCard) {
  const { supabase, workspaceId } = await requireWorkspace();

  // Defend against editing a trade the workspace doesn't cover.
  const { data: cov } = await supabase.from("workspace_trades").select("id").eq("workspace_id", workspaceId).eq("trade_id", tradeId).single();
  if (!cov) throw new Error("You don't cover this trade.");

  const rows: Row[] = [];
  const push = (code: string, label: string, unit: string, sell_price: number | null, pricing: Record<string, unknown> = {}) =>
    rows.push({ workspace_id: workspaceId, trade_id: tradeId, code, label, unit, sell_price, pricing });

  if (category === "flooring") {
    const c = card as FlooringCard;
    const systems = c.systems.filter((s) => s.name && s.perSqft != null);
    push("SYS", "Floor systems ($/SF)", "per-sqft", null, { bySystem: systems });
    if (c.prepPerSqft != null) push("PREP", "Substrate Prep", "per-sqft", c.prepPerSqft);
    if (c.baseTrimPerLf != null) push("BASE", "Base / Trim", "per-lf", c.baseTrimPerLf);
    if (c.mobilizationFee != null) push("MOB", "Mobilization Fee", "flat", c.mobilizationFee);
    if (c.taxPct != null) push("TAX", "Sales Tax Rate", "percent", c.taxPct);
    if (c.discountPct != null) push("DISCOUNT", "Default Proposal Discount", "percent", c.discountPct);
  } else if (category === "window-treatments") {
    const c = card as WtCard;
    const byShadesPerMotor: Record<string, number> = {};
    for (const m of c.motorized) if (m.price != null) byShadesPerMotor[String(m.shadesPerMotor)] = m.price;
    const byWidthTier = [...c.blinds].sort((a, b) => a.maxWidthInches - b.maxWidthInches);
    push("WT", "Motorized Roller Shade", "per-motor-set", null, { byShadesPerMotor });
    push("MB", "Manual Aluminum Blind", "per-blind", null, { byWidthTier });
    if (c.fixedPanelPrice != null) push("FPS", "Fixed Roller Shade", "per-shade", c.fixedPanelPrice);
    if (c.installFee != null) push("INSTALL", "Installation Fee", "flat", c.installFee);
    if (c.taxPct != null) push("TAX", "Sales Tax Rate", "percent", c.taxPct);
    if (c.discountPct != null) push("DISCOUNT", "Default Proposal Discount", "percent", c.discountPct);
  } else {
    throw new Error(`No pricing editor for category '${category}'.`);
  }

  const { error } = await supabase.from("pricing_items").upsert(rows, { onConflict: "workspace_id,trade_id,code" });
  if (error) throw new Error(`save pricing: ${error.message}`);

  revalidatePath("/app/settings/pricing");
  return { ok: true };
}
