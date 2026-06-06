import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MODELS, addUsage, emptyUsage, structuredCall, type Usage } from "./anthropic";
import type { MemoryEntry } from "./price-match";

/**
 * Window-treatments pricing — PER PRODUCT (per shade), not per SF. WT shares the
 * flooring PATTERN (a named-product rate card + an AI semantic match + deterministic
 * arithmetic + an unpriced flag), but its unit is the shade, so the compute is
 * qty × price-per-shade rather than area × $/SF.
 *
 * Product philosophy (the contractor competes on PRICE):
 *  - Price tracks the AUTHORITATIVE documented scope (shade schedule counts) — never
 *    inflated by anything uncertain, so the bid stays competitive.
 *  - Everything uncertain becomes a GC-facing CLARIFICATION note (excluded extra
 *    windows, missing counts, standard-size assumptions) — professional, and the
 *    basis for a later change order. Notes never change the price.
 *  - The ONLY thing that blocks a send is a product the contractor has NO rate for
 *    (an internal "needs your price"), which is their call — never shown to the GC.
 */

export interface WtProduct {
  name: string;
  perShade: number;
}

export interface WtPricingDNA {
  salesTaxRate: number;
  mobilizationFee: number;
  defaultDiscountPct: number;
  products: WtProduct[]; // the contractor's shade-product catalog: [{name:"Motorized solar roller shade", perShade: 685}]
}

/** A priceable scheduled shade (qty is KNOWN). */
export interface WtScopeItem {
  product: string; // descriptive shade product name (resolved from the schedule tag)
  qty: number;
  location?: string;
}

export interface WtScope {
  items: WtScopeItem[]; // counted shades → priceable
  clarifications: string[]; // GC-facing notes (excluded/uncounted shades, assumptions) — do NOT affect price
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
  rate: number | null; // resolved per-shade price, or null = unpriced
  matchedProduct: string | null;
  source: "rate_card" | "memory" | "unpriced";
  confidence: number;
  reason: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

// ── AI product-match (the semantic step; mirrors price-match.ts but for shades) ──

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
  `You match a window-treatment project's scheduled shades to a contractor's OWN shade-product price list. For each shade item (a product type + a quantity for a location), decide which price-list product applies, using trade judgment.\n\n` +
  `Match on BOTH operation AND fabric/light character:\n` +
  `- A MOTORIZED shade maps only to a motorized product; it does NOT map to a manual-only product (the motor is a large cost).\n` +
  `- A ROOM-DARKENING / BLACKOUT shade does NOT map to a SOLAR-screen product, and vice-versa (different fabric = different price).\n` +
  `- A DUAL / double shade (two bands on one bracket) maps to a dual product, not a single-band one.\n` +
  `- Reasonable wording differences are fine: "motor operated solar roller shade" ↔ a listed "Motorized solar shade".\n\n` +
  `RULES:\n` +
  `- Return the EXACT price-list product name (copied verbatim) that applies, or null.\n` +
  `- NEVER invent or output a price/number — you only choose a name. The rate is taken from the list downstream.\n` +
  `- If NO listed product reasonably applies (e.g. the contractor lists no motorized option and this shade is motorized), set matchedProduct=null and source="unpriced". A flagged unpriced item is correct and safe — do NOT force a wrong match.\n` +
  `- If a past learned correction (memory) fits better than any list entry, use it and set source="memory".\n` +
  `- Give every decision a confidence (0..1) and a one-line reason. Return one entry per item, by itemIndex.`;

/**
 * AI pricing-match for shades — selects which rate-card product applies to each
 * scheduled shade (or flags it unpriced); this function then resolves the chosen
 * NAME back to the contractor's real per-shade rate, so no price is fabricated.
 */
export async function matchShadeProducts(
  items: { product: string; qty: number; location?: string }[],
  products: { name: string; perShade: number }[],
  memory: MemoryEntry[] = [],
): Promise<{ matches: ShadeMatch[]; usage: Usage }> {
  if (!items.length) return { matches: [], usage: emptyUsage() };
  if (!products.length) {
    return {
      matches: items.map(() => ({ rate: null, matchedProduct: null, source: "unpriced" as const, confidence: 1, reason: "No products in your price list yet." })),
      usage: emptyUsage(),
    };
  }

  const listText = products.map((p) => `- "${p.name}" ($${p.perShade}/shade)`).join("\n");
  const memText = memory.length ? `\nPast learned corrections (memory):\n${memory.map((m) => `- ${m.situation}${m.matchedSystem ? ` → "${m.matchedSystem}"` : ""}${m.note ? ` (${m.note})` : ""}`).join("\n")}\n` : "";
  const itemText = items.map((it, i) => `[${i}] ${it.location ? `${it.location}: ` : ""}product="${it.product}", ${it.qty} shade(s)`).join("\n");

  let data: ShadeMatchResult;
  let usage: Usage = emptyUsage();
  try {
    const res = await structuredCall({
      model: MODELS.scan, // semantic matching — same reasoning tier as the relevance scan
      system: MATCH_SYSTEM,
      content: [
        {
          type: "text",
          text: `Contractor's shade-product price list (the ONLY products you may match to):\n${listText}\n${memText}\nProject shades to match:\n${itemText}\n\nReturn one decision per item.`,
        },
      ],
      toolName: "report_matches",
      toolDescription: "For each scheduled shade, which price-list product applies (by name) or unpriced.",
      schema: ShadeMatchResult,
      maxTokens: 2000,
    });
    data = res.data;
    usage = addUsage(emptyUsage(), res.message);
  } catch (e) {
    console.error("wt product-match failed — degrading to unpriced (bid still created)", { error: (e as Error)?.message, items: items.length, products: products.length });
    return {
      matches: items.map(() => ({ rate: null as number | null, matchedProduct: null, source: "unpriced" as const, confidence: 0, reason: "Pricing match unavailable — please set this line's price." })),
      usage: emptyUsage(),
    };
  }

  const byName = new Map(products.map((p) => [norm(p.name), p.perShade]));
  const byIndex = new Map(data.matches.map((m) => [m.itemIndex, m]));

  const matches: ShadeMatch[] = items.map((_, i) => {
    const m = byIndex.get(i);
    if (!m || !m.matchedProduct) return { rate: null, matchedProduct: null, source: "unpriced", confidence: m?.confidence ?? 0.5, reason: m?.reason ?? "No matching product." };
    const rate = byName.get(norm(m.matchedProduct));
    if (rate == null) return { rate: null, matchedProduct: null, source: "unpriced", confidence: m.confidence, reason: `Matched "${m.matchedProduct}" but it's not in your price list — needs your price.` };
    return { rate, matchedProduct: m.matchedProduct, source: m.source === "memory" ? "memory" : "rate_card", confidence: m.confidence, reason: m.reason };
  });

  return { matches, usage };
}

// ── Deterministic compute over an already-matched scope (no AI arithmetic) ──

export function priceWtScope(scope: WtScope, dna: WtPricingDNA, matches: ShadeMatch[], discountPct = dna.defaultDiscountPct) {
  const lines: PricedLine[] = [];

  scope.items.forEach((it, i) => {
    const m = matches[i];
    if (!m || m.rate == null) {
      // Contractor has NO rate for this product → unpriced + flagged. This is the only
      // case that blocks a send (their call) — it is NOT a GC-facing clarification.
      lines.push({
        code: "WT",
        label: `${it.product}${it.location ? ` — ${it.location}` : ""} — needs your price`,
        qty: it.qty,
        unitRate: 0,
        amount: 0,
        attrs: { unpriced: true, reason: m?.reason ?? "No matching product in your price list.", product: it.product, location: it.location },
      });
      return;
    }
    lines.push({
      code: "WT",
      label: `${m.matchedProduct}${it.location ? ` — ${it.location}` : ""}`,
      qty: it.qty,
      unitRate: m.rate,
      amount: r2(it.qty * m.rate),
      attrs: { product: m.matchedProduct, reportedProduct: it.product, source: m.source, confidence: m.confidence, location: it.location },
    });
  });

  const productsSubtotal = r2(lines.reduce((a, l) => a + l.amount, 0));
  const discount = -Math.round(productsSubtotal * discountPct); // proposal rounds discount to whole dollars
  const afterDiscount = r2(productsSubtotal + discount);
  const subtotal = r2(afterDiscount + dna.mobilizationFee);
  const tax = r2(subtotal * dna.salesTaxRate);
  const total = r2(subtotal + tax);

  return { lines, productsSubtotal, discountPct, discount, installFee: dna.mobilizationFee, subtotal, tax, total };
}

/**
 * Build a WtPricingDNA from a workspace's pricing_items rows for a window-treatments
 * trade. Same codes/shape as flooring (so the editor + onboarding generalize), except
 * SYS.bySystem entries carry `perShade` instead of `perSqft`:
 *   SYS → pricing.bySystem: [{name, perShade}]   (the contractor's shade-product catalog)
 *   MOB → sell_price (flat mobilization)   TAX / DISCOUNT → sell_price as a percent (÷100)
 * Returns null if there is no priceable product (the caller skips that contractor).
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
  const sys = byCode.get("SYS")?.pricing as { bySystem?: { name: string; perShade: number }[] } | undefined;
  const mob = byCode.get("MOB")?.sell_price;
  const tax = byCode.get("TAX")?.sell_price;
  const discount = byCode.get("DISCOUNT")?.sell_price;

  const products = (sys?.bySystem ?? []).filter((p) => p && p.name && p.perShade != null);
  if (!products.length) return null;

  return {
    salesTaxRate: tax != null ? Number(tax) / 100 : 0,
    mobilizationFee: mob != null ? Number(mob) : 0,
    defaultDiscountPct: discount != null ? Number(discount) / 100 : 0,
    products: products.map((p) => ({ name: p.name, perShade: Number(p.perShade) })),
  };
}
