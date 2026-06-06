import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MODELS, addUsage, emptyUsage, structuredCall, type Usage } from "./anthropic";
import type { MemoryEntry } from "./price-match";
import { sumGlobalCharges, parseGlobalCharges, type GlobalCharge } from "./charges";

/**
 * Window-treatments pricing — PER PRODUCT, by SIZE TIER. WT shares the flooring
 * PATTERN (named-product rate card + AI semantic match + deterministic arithmetic +
 * unpriced flag), but a shade is priced per UNIT and the unit price depends on size:
 *
 *  - The workspace defines S/M/L size buckets ONCE (the W×H cutoff of each).
 *  - Each product carries up to 3 prices (small / STANDARD / large); only Standard
 *    is required and is the DEFAULT used whenever a bid gives no size (the usual case).
 *  - A bid shade with a size → the smallest bucket it fits (W AND H ≤ cutoff); bigger
 *    than Large → flagged "needs your price". The match (operation/fabric) is by NAME;
 *    the size tier is deterministic.
 *
 * Price always tracks the documented scope; uncertain things (no count, extra windows)
 * are price-neutral GC clarifications, not guesses.
 */

export type SizeTier = "small" | "standard" | "large";

export interface WtProduct {
  name: string;
  prices: { small: number | null; standard: number; large: number | null };
}

export interface WtSizeBuckets {
  small: { maxW: number | null; maxH: number | null };
  standard: { maxW: number | null; maxH: number | null };
  large: { maxW: number | null; maxH: number | null };
}

export interface WtPricingDNA {
  salesTaxRate: number;
  globalCharges: GlobalCharge[]; // per-quote charges (Installation, …): flat $ or % of the products subtotal
  defaultDiscountPct: number;
  products: WtProduct[];
  buckets: WtSizeBuckets | null; // null → everything prices at Standard
}

/** A priceable scheduled shade (qty KNOWN). width/height drive the size tier when present. */
export interface WtScopeItem {
  product: string;
  qty: number;
  location?: string;
  widthInches?: number | null;
  heightInches?: number | null;
}

export interface WtScope {
  items: WtScopeItem[];
  clarifications: string[]; // GC-facing notes (excluded/uncounted shades, assumptions) — never affect price
}

export interface PricedLine {
  code: string;
  label: string;
  qty: number;
  unitRate: number;
  amount: number;
  attrs?: Record<string, unknown>;
}

export interface ShadeMatch {
  matchedProduct: string | null; // rate-card product NAME (operation/fabric); null = unpriced
  source: "rate_card" | "memory" | "unpriced";
  confidence: number;
  reason: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const TIER_LABEL: Record<SizeTier, string> = { small: "Small", standard: "Standard", large: "Large" };

/** Deterministic size-tier selection. No size (the usual case) → Standard. */
function pickTier(w: number | null | undefined, h: number | null | undefined, buckets: WtSizeBuckets | null): { tier: SizeTier; oversized: boolean } {
  if (w == null || h == null || !buckets) return { tier: "standard", oversized: false };
  const fits = (b: { maxW: number | null; maxH: number | null }) => b.maxW != null && b.maxH != null && w <= b.maxW && h <= b.maxH;
  if (fits(buckets.small)) return { tier: "small", oversized: false };
  if (fits(buckets.standard) || buckets.standard.maxW == null) return { tier: "standard", oversized: false };
  if (fits(buckets.large)) return { tier: "large", oversized: false };
  return { tier: "large", oversized: true }; // bigger than Large → flag, don't guess
}

// ── AI product-match (semantic; by operation/fabric — size is handled separately) ──

const ShadeMatchResult = z.object({
  matches: z.array(
    z.object({
      itemIndex: z.number().int(),
      matchedProduct: z.string().nullable().describe("EXACT price-list product name that applies (copied verbatim), or null if none reasonably fits"),
      source: z.enum(["rate_card", "memory", "unpriced"]),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
    }),
  ),
});
type ShadeMatchResult = z.infer<typeof ShadeMatchResult>;

const MATCH_SYSTEM =
  `You match a window-treatment project's scheduled shades to a contractor's OWN shade-product price list. For each shade item, decide which price-list PRODUCT applies, by trade judgment. Match on OPERATION (manual vs motorized) AND fabric/light character (solar vs room-darkening/blackout vs dual vs multi-band). Size is handled separately — match the product, not the size.\n\n` +
  `RULES:\n` +
  `- A MOTORIZED shade maps only to a motorized product; a ROOM-DARKENING shade does not map to a SOLAR product (different fabric = different product).\n` +
  `- Return the EXACT price-list product name (copied verbatim), or null. NEVER invent a price.\n` +
  `- If NO listed product reasonably applies, set matchedProduct=null and source="unpriced" — a flagged item is safe; do not force a wrong match.\n` +
  `- If a past learned correction (memory) fits better, use it and set source="memory".\n` +
  `- One entry per item, by itemIndex, each with a confidence (0..1) and a one-line reason.`;

/** AI selects which rate-card product applies to each scheduled shade (by name) — the
 *  size tier + price are resolved deterministically downstream. Degrades to all-unpriced
 *  on API/schema failure so the bid is still created + gated. */
export async function matchShadeProducts(
  items: { product: string; qty: number; location?: string }[],
  products: { name: string }[],
  memory: MemoryEntry[] = [],
): Promise<{ matches: ShadeMatch[]; usage: Usage }> {
  if (!items.length) return { matches: [], usage: emptyUsage() };
  if (!products.length) {
    return { matches: items.map(() => ({ matchedProduct: null, source: "unpriced" as const, confidence: 1, reason: "No products in your price list yet." })), usage: emptyUsage() };
  }

  const listText = products.map((p) => `- "${p.name}"`).join("\n");
  const memText = memory.length ? `\nPast learned corrections (memory):\n${memory.map((m) => `- ${m.situation}${m.matchedSystem ? ` → "${m.matchedSystem}"` : ""}${m.note ? ` (${m.note})` : ""}`).join("\n")}\n` : "";
  const itemText = items.map((it, i) => `[${i}] ${it.location ? `${it.location}: ` : ""}product="${it.product}", ${it.qty} unit(s)`).join("\n");

  let data: ShadeMatchResult;
  let usage: Usage = emptyUsage();
  try {
    const res = await structuredCall({
      model: MODELS.scan,
      system: MATCH_SYSTEM,
      content: [{ type: "text", text: `Contractor's shade products (the ONLY products you may match to):\n${listText}\n${memText}\nProject shades to match:\n${itemText}\n\nReturn one decision per item.` }],
      toolName: "report_matches",
      toolDescription: "For each scheduled shade, which price-list product applies (by name) or unpriced.",
      schema: ShadeMatchResult,
      maxTokens: 2000,
    });
    data = res.data;
    usage = addUsage(emptyUsage(), res.message);
  } catch (e) {
    console.error("wt product-match failed — degrading to unpriced (bid still created)", { error: (e as Error)?.message, items: items.length, products: products.length });
    return { matches: items.map(() => ({ matchedProduct: null, source: "unpriced" as const, confidence: 0, reason: "Pricing match unavailable — please set this line's price." })), usage: emptyUsage() };
  }

  const known = new Set(products.map((p) => norm(p.name)));
  const byIndex = new Map(data.matches.map((m) => [m.itemIndex, m]));
  const matches: ShadeMatch[] = items.map((_, i) => {
    const m = byIndex.get(i);
    if (!m || !m.matchedProduct) return { matchedProduct: null, source: "unpriced", confidence: m?.confidence ?? 0.5, reason: m?.reason ?? "No matching product." };
    if (!known.has(norm(m.matchedProduct))) return { matchedProduct: null, source: "unpriced", confidence: m.confidence, reason: `Matched "${m.matchedProduct}" but it's not in your price list — needs your price.` };
    return { matchedProduct: m.matchedProduct, source: m.source === "memory" ? "memory" : "rate_card", confidence: m.confidence, reason: m.reason };
  });
  return { matches, usage };
}

// ── Deterministic compute over an already-matched scope (no AI arithmetic) ──

export function priceWtScope(scope: WtScope, dna: WtPricingDNA, matches: ShadeMatch[], discountPct = dna.defaultDiscountPct) {
  const byName = new Map(dna.products.map((p) => [norm(p.name), p]));
  const lines: PricedLine[] = [];

  scope.items.forEach((it, i) => {
    const m = matches[i];
    const prod = m?.matchedProduct ? byName.get(norm(m.matchedProduct)) : undefined;
    const unpriced = (reason: string) =>
      lines.push({ code: "WT", label: `${it.product}${it.location ? ` — ${it.location}` : ""} — needs your price`, qty: it.qty, unitRate: 0, amount: 0, attrs: { unpriced: true, reason, product: it.product, location: it.location } });

    if (!prod) {
      // Contractor has NO rate for this product → unpriced + flagged (blocks send, their call).
      unpriced(m?.reason ?? "No matching product in your price list.");
      return;
    }
    const { tier, oversized } = pickTier(it.widthInches, it.heightInches, dna.buckets);
    if (oversized) {
      unpriced("Larger than your Large size tier — set a price for this oversized shade.");
      return;
    }
    const rate = prod.prices[tier] ?? prod.prices.standard;
    if (rate == null) {
      unpriced(`No ${TIER_LABEL[tier]} price set for ${prod.name}.`);
      return;
    }
    const sized = it.widthInches != null && it.heightInches != null ? ` ${it.widthInches}"×${it.heightInches}"` : "";
    lines.push({
      code: "WT",
      label: `${prod.name} — ${TIER_LABEL[tier]}${sized}${it.location ? ` — ${it.location}` : ""}`,
      qty: it.qty,
      unitRate: rate,
      amount: r2(it.qty * rate),
      attrs: { product: prod.name, tier, reportedProduct: it.product, source: m?.source, confidence: m?.confidence, location: it.location },
    });
  });

  const productsSubtotal = r2(lines.reduce((a, l) => a + l.amount, 0));
  const discount = -Math.round(productsSubtotal * discountPct);
  const afterDiscount = r2(productsSubtotal + discount);
  // Installation + any other charges: flat $ added as-is, or % of the products subtotal.
  const charges = sumGlobalCharges(dna.globalCharges, productsSubtotal);
  const subtotal = r2(afterDiscount + charges);
  const tax = r2(subtotal * dna.salesTaxRate);
  const total = r2(subtotal + tax);

  return { lines, productsSubtotal, discountPct, discount, installFee: charges, subtotal, tax, total };
}

/**
 * Build a WtPricingDNA from a workspace's pricing_items rows for a window-treatments
 * trade. Codes mirror flooring (so the editor + onboarding generalize):
 *   SYS   → pricing.bySystem: [{name, prices:{small,standard,large}}]  (per-tier $/unit)
 *   SIZES → pricing: {small,standard,large}: {maxW,maxH}  (workspace S/M/L cutoffs)
 *   MOB → sell_price (flat)   TAX / DISCOUNT → sell_price as percent (÷100)
 * Returns null if no product has at least a Standard price.
 */
export async function loadWtProductDNA(db: SupabaseClient, workspaceId: string, tradeId: string): Promise<WtPricingDNA | null> {
  const { data: items, error } = await db
    .from("pricing_items")
    .select("code, sell_price, pricing")
    .eq("workspace_id", workspaceId)
    .eq("trade_id", tradeId)
    .eq("active", true);
  if (error) throw new Error(`load pricing_items: ${error.message}`);

  const byCode = new Map((items ?? []).map((i) => [i.code, i]));
  const sys = byCode.get("SYS")?.pricing as { bySystem?: { name: string; prices?: { small?: number | null; standard?: number | null; large?: number | null } }[] } | undefined;
  const sizes = byCode.get("SIZES")?.pricing as WtSizeBuckets | undefined;
  const chargeRow = byCode.get("CHARGES")?.pricing as { items?: { label: string; amount: number; kind?: "flat" | "percent" }[] } | undefined;
  const mob = byCode.get("MOB")?.sell_price;
  const tax = byCode.get("TAX")?.sell_price;
  const discount = byCode.get("DISCOUNT")?.sell_price;

  const products = (sys?.bySystem ?? [])
    .filter((p) => p && p.name && p.prices?.standard != null)
    .map((p) => ({
      name: p.name,
      prices: { small: p.prices!.small ?? null, standard: Number(p.prices!.standard), large: p.prices!.large ?? null },
    }));
  if (!products.length) return null;

  // Global charges (Installation, etc.); fall back to a legacy MOB row as one "Mobilization" charge.
  const globalCharges = parseGlobalCharges(chargeRow?.items, mob != null ? Number(mob) : null);

  return {
    salesTaxRate: tax != null ? Number(tax) / 100 : 0,
    globalCharges,
    defaultDiscountPct: discount != null ? Number(discount) / 100 : 0,
    products,
    buckets: sizes ?? null,
  };
}
