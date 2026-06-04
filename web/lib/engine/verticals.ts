import type { SupabaseClient } from "@supabase/supabase-js";
import type { Usage } from "./anthropic";
import type { Gap } from "./gaps";
import { runWtPipeline, type PipelineDoc } from "./wt-pipeline";
import { loadWtPricingDNA } from "./pricing";
import { priceScope, type PricingDNA, type Scope } from "./price";
import { runFlooringPipeline } from "./flooring-pipeline";
import { loadFlooringPricingDNA } from "./flooring-pricing";
import { priceFlooringScope, type FlooringPricingDNA, type FlooringScope } from "./flooring-price";

/**
 * Vertical registry — one adapter per CATEGORY. extractBid dispatches on a trade's
 * `category`, so every flooring sub-trade (epoxy, carpet, resilient, …) shares the
 * single flooring pipeline, and window-treatments keeps its own. The engine's DB
 * writes stay generic; only these adapters know the per-vertical shapes.
 *
 * The WT adapter wraps the existing, validated functions verbatim — WT output must
 * be byte-identical after this refactor.
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
  price(scope: unknown, dna: unknown): PricedResult;
  lineUnit(code: string): string;
}

const wtAdapter: VerticalAdapter = {
  async run(docs, cfg) {
    const { extraction, scope, gaps, counts, usage } = await runWtPipeline(docs, cfg as Parameters<typeof runWtPipeline>[1]);
    const quantifiable = scope.motorizedSets.length > 0 || scope.blinds.length > 0 || scope.fixedPanels > 0;
    void counts;
    return { extraction, scope, gaps, quantifiable, scopeSummary: extraction.bidReasoning, usage };
  },
  loadDNA: (db, ws, tid) => loadWtPricingDNA(db, ws, tid),
  price(scope, dna) {
    const d = dna as PricingDNA;
    return { ...priceScope(scope as Scope, d), taxRate: d.salesTaxRate };
  },
  lineUnit: (code) => (code === "FPS" ? "shade" : code === "MB" ? "blind" : "motor-set"),
};

const flooringAdapter: VerticalAdapter = {
  async run(docs, cfg) {
    const { extraction, scope, gaps, usage } = await runFlooringPipeline(docs, cfg as Parameters<typeof runFlooringPipeline>[1]);
    return { extraction, scope, gaps, quantifiable: scope.areas.length > 0, scopeSummary: extraction.bidReasoning, usage };
  },
  loadDNA: (db, ws, tid) => loadFlooringPricingDNA(db, ws, tid),
  price(scope, dna) {
    const d = dna as FlooringPricingDNA;
    return { ...priceFlooringScope(scope as FlooringScope, d), taxRate: d.salesTaxRate };
  },
  lineUnit: (code) => (code === "BASE" ? "lf" : "sqft"), // SYS + PREP are per-sqft
};

export const VERTICALS: Record<string, VerticalAdapter> = {
  "window-treatments": wtAdapter,
  flooring: flooringAdapter,
};
