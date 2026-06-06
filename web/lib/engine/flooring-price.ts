import type { AreaMatch } from "./price-match";
import { sumGlobalCharges, type GlobalCharge } from "./charges";

/**
 * Deterministic flooring pricing — material-agnostic. The engine never lets the
 * model do arithmetic: given a structured FlooringScope + the tenant's trained
 * FlooringPricingDNA + the AI's system matches, compute line items and totals
 * exactly. Order mirrors a proposal: products → discount (% of products) →
 * + global charges → subtotal → tax → total — same shape as WT pricing.
 */

export interface FlooringPricingDNA {
  salesTaxRate: number;
  globalCharges: GlobalCharge[]; // flat $ or % of products (mobilization, delivery, …) — same model as WT
  defaultDiscountPct: number;
  rates: {
    systems: { name: string; perSqft: number }[]; // contractor's catalog: e.g. [{name:"Self-leveling epoxy", perSqft: 9.5}]
    prepPerSqft: number | null;
    baseTrimPerLf: number | null;
  };
}

export interface FlooringScope {
  areas: { system: string; sqft: number; location?: string }[];
  baseTrimLf: number;
  prep: { type: string; sqft: number } | null;
}

export interface PricedLine {
  code: string;
  label: string;
  qty: number;
  unitRate: number;
  amount: number;
  attrs?: Record<string, unknown>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Deterministic compute over an ALREADY-MATCHED scope. `matches[i]` is the AI match
 * for `scope.areas[i]` (see price-match.ts): a real rate from the contractor's list,
 * or null = out-of-envelope → an unpriced, flagged line (amount 0, excluded from the
 * total, surfaced for the contractor to price). The model picked the system; this
 * function only multiplies — no fabricated prices, no fuzzy fallback.
 */
export function priceFlooringScope(scope: FlooringScope, dna: FlooringPricingDNA, matches: AreaMatch[], discountPct = dna.defaultDiscountPct) {
  const lines: PricedLine[] = [];

  scope.areas.forEach((a, i) => {
    const m = matches[i];
    if (!m || m.rate == null) {
      // Out-of-envelope: no listed system applies. Flag it, don't guess a number.
      lines.push({
        code: "SYS",
        label: `${a.system}${a.location ? ` — ${a.location}` : ""} — needs your price`,
        qty: a.sqft,
        unitRate: 0,
        amount: 0,
        attrs: { unpriced: true, reason: m?.reason ?? "No matching system in your price list.", system: a.system, location: a.location, sqft: a.sqft },
      });
      return;
    }
    lines.push({
      code: "SYS",
      label: `${m.matchedSystem}${a.location ? ` — ${a.location}` : ""}`,
      qty: a.sqft,
      unitRate: m.rate,
      amount: r2(a.sqft * m.rate),
      attrs: { system: m.matchedSystem, reportedSystem: a.system, source: m.source, confidence: m.confidence, location: a.location, sqft: a.sqft },
    });
  });

  if (scope.prep && dna.rates.prepPerSqft != null && scope.prep.sqft > 0) {
    lines.push({
      code: "PREP",
      label: `Substrate prep — ${scope.prep.type}`,
      qty: scope.prep.sqft,
      unitRate: dna.rates.prepPerSqft,
      amount: r2(scope.prep.sqft * dna.rates.prepPerSqft),
      attrs: { type: scope.prep.type },
    });
  }

  if (scope.baseTrimLf > 0 && dna.rates.baseTrimPerLf != null) {
    lines.push({
      code: "BASE",
      label: "Base / trim / transitions",
      qty: scope.baseTrimLf,
      unitRate: dna.rates.baseTrimPerLf,
      amount: r2(scope.baseTrimLf * dna.rates.baseTrimPerLf),
    });
  }

  const productsSubtotal = r2(lines.reduce((a, l) => a + l.amount, 0));
  const discount = -Math.round(productsSubtotal * discountPct); // proposal rounds discount to whole dollars
  const afterDiscount = r2(productsSubtotal + discount);
  const charges = sumGlobalCharges(dna.globalCharges, productsSubtotal); // flat $ or % of products
  const subtotal = r2(afterDiscount + charges);
  const tax = r2(subtotal * dna.salesTaxRate);
  const total = r2(subtotal + tax);

  return { lines, productsSubtotal, discountPct, discount, installFee: charges, subtotal, tax, total };
}
