import type { SupabaseClient } from "@supabase/supabase-js";
import type { Usage } from "./anthropic";
import type { Gap } from "./gaps";
import { runWtPipeline, type PipelineDoc } from "./wt-pipeline";
import { runFlooringPipeline } from "./flooring-pipeline";
import { loadFlooringPricingDNA } from "./flooring-pricing";
import { priceFlooringScope, type FlooringPricingDNA, type FlooringScope } from "./flooring-price";
import { matchScopeToRates } from "./price-match";
import { loadWtProductDNA, matchShadeProducts, priceWtScope, type WtPricingDNA, type WtScope } from "./wt-price";

/**
 * Vertical registry — one adapter per CATEGORY. extractBid dispatches on a trade's
 * `category`, so every flooring sub-trade (epoxy, carpet, resilient, …) shares the
 * single flooring pipeline, and window-treatments shares the same PATTERN (a named-
 * product rate card + AI semantic match + deterministic arithmetic + unpriced flag),
 * differing only in unit: flooring is area-priced ($/SF), WT is per-product ($/shade).
 * The engine's DB writes stay generic; only these adapters know the per-vertical shapes.
 */

/** The subset of any extraction the generic engine reads (project, relevance, contacts). */
export interface BaseExtraction {
  bid: boolean;
  bidConfidence: number;
  bidReasoning: string;
  projectName: string | null;
  contacts: { name: string; role: string; company: string | null; email: string | null; source: string }[];
}

export interface PricedResult {
  lines: { code: string; label: string; qty: number; unitRate: number; amount: number; attrs?: Record<string, unknown> }[];
  productsSubtotal: number;
  discountPct: number;
  discount: number;
  installFee: number;
  subtotal: number;
  tax: number;
  total: number;
  taxRate: number; // → bids.tax_rate
  clarifications?: string; // GC-facing notes (exclusions/assumptions) → bids.notes_to_gc; never affects price
}

export interface VerticalRun {
  extraction: BaseExtraction;
  scope: unknown;
  gaps: Gap[];
  quantifiable: boolean;
  scopeSummary: string; // notes_to_gc on a site-visit bid
  usage?: Usage;
}

export interface VerticalAdapter {
  run(docs: PipelineDoc[], cfg: unknown): Promise<VerticalRun>;
  loadDNA(db: SupabaseClient, workspaceId: string, tradeId: string): Promise<unknown | null>;
  // Async: flooring runs the AI pricing-match before the deterministic compute.
  price(scope: unknown, dna: unknown): Promise<PricedResult>;
  lineUnit(code: string): string;
}

const wtAdapter: VerticalAdapter = {
  async run(docs, cfg) {
    const { extraction, scope, gaps, usage } = await runWtPipeline(docs, cfg as Parameters<typeof runWtPipeline>[1]);
    // Quantifiable when ≥1 shade has a known count (price = count × per-product rate).
    return { extraction, scope, gaps, quantifiable: scope.items.length > 0, scopeSummary: extraction.bidReasoning, usage };
  },
  loadDNA: (db, ws, tid) => loadWtProductDNA(db, ws, tid),
  // Per-product: the AI matches each scheduled shade to the contractor's shade-product
  // rate card; the deterministic compute does qty × price-per-shade. A product the
  // contractor has NO rate for → unpriced + flagged (blocks send, their call). The
  // GC-facing clarifications (excluded/uncounted shades, assumptions) ride notes_to_gc
  // and never change the price. Memory [] until Pillar 3.
  async price(scope, dna) {
    const d = dna as WtPricingDNA;
    const ws = scope as WtScope;
    const { matches } = await matchShadeProducts(ws.items, d.products, []);
    const priced = priceWtScope(ws, d, matches);
    const clarifications = ws.clarifications.length ? ws.clarifications.map((c) => `• ${c}`).join("\n") : undefined;
    return { ...priced, taxRate: d.salesTaxRate, clarifications };
  },
  lineUnit: () => "shade",
};

const flooringAdapter: VerticalAdapter = {
  async run(docs, cfg) {
    const { extraction, scope, gaps, usage } = await runFlooringPipeline(docs, cfg as Parameters<typeof runFlooringPipeline>[1]);
    return { extraction, scope, gaps, quantifiable: scope.areas.length > 0, scopeSummary: extraction.bidReasoning, usage };
  },
  loadDNA: (db, ws, tid) => loadFlooringPricingDNA(db, ws, tid),
  async price(scope, dna) {
    const d = dna as FlooringPricingDNA;
    const fs = scope as FlooringScope;
    // AI decides which listed system applies to each area (or flags it unpriced);
    // the deterministic compute then multiplies. Memory is [] until Pillar 3.
    const { matches } = await matchScopeToRates(fs.areas, d.rates.systems, []);
    return { ...priceFlooringScope(fs, d, matches), taxRate: d.salesTaxRate };
  },
  lineUnit: (code) => (code === "BASE" ? "lf" : "sqft"), // SYS + PREP are per-sqft
};

export const VERTICALS: Record<string, VerticalAdapter> = {
  "window-treatments": wtAdapter,
  flooring: flooringAdapter,
};
