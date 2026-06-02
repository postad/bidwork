/**
 * Deterministic pricing — the engine NEVER lets the model do arithmetic. Given a
 * structured scope + the tenant's Pricing DNA, compute line items and totals
 * exactly. Order of operations mirrors the proposal:
 *   products → discount (% of products) → + install → = subtotal → + tax → total
 * Validated to the penny against Estimate #14473 ($17,003.01) — see spike/FINDINGS.md.
 */

export interface PricingDNA {
  salesTaxRate: number;
  installFee: number;
  defaultDiscountPct: number;
  rates: {
    WT: { byShadesPerMotor: Record<string, number> };
    MB: { byWidthTier: { maxWidthInches: number; price: number }[] };
    FPS: { flat: number };
  };
}

export interface Scope {
  motorizedSets: { shadesPerMotor: number; location?: string }[]; // WT
  blinds: { widthInches: number | null; location?: string }[]; // MB
  fixedPanels: number; // FPS
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

export function priceScope(scope: Scope, dna: PricingDNA, discountPct = dna.defaultDiscountPct) {
  const lines: PricedLine[] = [];

  for (const s of scope.motorizedSets) {
    const rate = dna.rates.WT.byShadesPerMotor[String(s.shadesPerMotor)];
    if (rate == null) continue;
    lines.push({
      code: "WT",
      label: `Motorized roller — ${s.shadesPerMotor} on 1 motor${s.location ? ` (${s.location})` : ""}`,
      qty: 1,
      unitRate: rate,
      amount: rate,
      attrs: { shadesPerMotor: s.shadesPerMotor, location: s.location },
    });
  }
  for (const b of scope.blinds) {
    const tier = dna.rates.MB.byWidthTier.find((t) => (b.widthInches ?? 0) <= t.maxWidthInches) ?? dna.rates.MB.byWidthTier.at(-1)!;
    lines.push({
      code: "MB",
      label: `Manual aluminum blind${b.widthInches ? ` (${b.widthInches}" W)` : ""}`,
      qty: 1,
      unitRate: tier.price,
      amount: tier.price,
      attrs: { widthInches: b.widthInches, location: b.location },
    });
  }
  if (scope.fixedPanels > 0) {
    lines.push({ code: "FPS", label: "Fixed panel shade", qty: scope.fixedPanels, unitRate: dna.rates.FPS.flat, amount: r2(scope.fixedPanels * dna.rates.FPS.flat) });
  }

  const productsSubtotal = r2(lines.reduce((a, l) => a + l.amount, 0));
  const discount = -Math.round(productsSubtotal * discountPct); // proposal rounds discount to whole dollars
  const afterDiscount = r2(productsSubtotal + discount);
  const subtotal = r2(afterDiscount + dna.installFee); // matches the "Parts Subtotal" line
  const tax = r2(subtotal * dna.salesTaxRate);
  const total = r2(subtotal + tax);

  return { lines, productsSubtotal, discountPct, discount, installFee: dna.installFee, subtotal, tax, total };
}
