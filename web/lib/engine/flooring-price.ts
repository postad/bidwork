/**
 * Deterministic flooring pricing — material-agnostic. The engine never lets the
 * model do arithmetic: given a structured FlooringScope + the tenant's trained
 * FlooringPricingDNA, compute line items and totals exactly. Order mirrors a
 * proposal: products → discount (% of products) → + mobilization → subtotal →
 * tax → total — the same shape as the validated WT pricing (see price.ts).
 */

export interface FlooringPricingDNA {
  salesTaxRate: number;
  mobilizationFee: number;
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
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Match an extracted system name to a rate-card system. Exact-ish (normalized
 *  substring either direction); falls back to the first rate with assumedSystem=true
 *  rather than dropping the line — surfaced in attrs for the contractor to confirm. */
function matchSystem(name: string, systems: FlooringPricingDNA["rates"]["systems"]) {
  const n = norm(name);
  const hit = systems.find((s) => {
    const sn = norm(s.name);
    return sn === n || sn.includes(n) || n.includes(sn);
  });
  if (hit) return { rate: hit.perSqft, matchedName: hit.name, assumed: false };
  if (systems.length) return { rate: systems[0].perSqft, matchedName: systems[0].name, assumed: true };
  return null;
}

export function priceFlooringScope(scope: FlooringScope, dna: FlooringPricingDNA, discountPct = dna.defaultDiscountPct) {
  const lines: PricedLine[] = [];

  for (const a of scope.areas) {
    const m = matchSystem(a.system, dna.rates.systems);
    if (!m) continue; // no rate card systems at all — nothing to price this area against
    const amount = r2(a.sqft * m.rate);
    lines.push({
      code: "SYS",
      label: `${m.matchedName}${a.location ? ` — ${a.location}` : ""}${m.assumed ? ` (system assumed from "${a.system}")` : ""}`,
      qty: a.sqft,
      unitRate: m.rate,
      amount,
      attrs: { system: m.matchedName, reportedSystem: a.system, assumedSystem: m.assumed, location: a.location, sqft: a.sqft },
    });
  }

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
  const subtotal = r2(afterDiscount + dna.mobilizationFee);
  const tax = r2(subtotal * dna.salesTaxRate);
  const total = r2(subtotal + tax);

  return { lines, productsSubtotal, discountPct, discount, installFee: dna.mobilizationFee, subtotal, tax, total };
}
