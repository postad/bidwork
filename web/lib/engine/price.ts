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

/** Per-item out-of-envelope verdicts from the WT guard (wt-match.ts). Optional — when
 *  omitted (or every item in-envelope), pricing is byte-identical to before. */
export interface WtEnvelopeArg {
  motorized: { inEnvelope: boolean; reason: string }[];
  blinds: { inEnvelope: boolean; reason: string }[];
}

export function priceScope(scope: Scope, dna: PricingDNA, env?: WtEnvelopeArg, discountPct = dna.defaultDiscountPct) {
  const lines: PricedLine[] = [];

  scope.motorizedSets.forEach((s, i) => {
    if (env?.motorized[i]?.inEnvelope === false) {
      // Abnormal (e.g. unusual ganging/size) → unpriced, flagged for the contractor.
      lines.push({ code: "WT", label: `Motorized roller — ${s.shadesPerMotor} on 1 motor${s.location ? ` (${s.location})` : ""} — needs your price`, qty: 1, unitRate: 0, amount: 0, attrs: { unpriced: true, reason: env.motorized[i].reason, shadesPerMotor: s.shadesPerMotor, location: s.location } });
      return;
    }
    const rate = dna.rates.WT.byShadesPerMotor[String(s.shadesPerMotor)];
    if (rate == null) return;
    lines.push({
      code: "WT",
      label: `Motorized roller — ${s.shadesPerMotor} on 1 motor${s.location ? ` (${s.location})` : ""}`,
      qty: 1,
      unitRate: rate,
      amount: rate,
      attrs: { shadesPerMotor: s.shadesPerMotor, location: s.location },
    });
  });
  scope.blinds.forEach((b, i) => {
    if (env?.blinds[i]?.inEnvelope === false) {
      // Oversized / abnormal blind (e.g. 20 ft) → unpriced, flagged — never tier-mispriced.
      lines.push({ code: "MB", label: `Manual blind${b.widthInches ? ` (${b.widthInches}" W)` : ""} — needs your price`, qty: 1, unitRate: 0, amount: 0, attrs: { unpriced: true, reason: env.blinds[i].reason, widthInches: b.widthInches, location: b.location } });
      return;
    }
    const tier = dna.rates.MB.byWidthTier.find((t) => (b.widthInches ?? 0) <= t.maxWidthInches) ?? dna.rates.MB.byWidthTier.at(-1)!;
    lines.push({
      code: "MB",
      label: `Manual aluminum blind${b.widthInches ? ` (${b.widthInches}" W)` : ""}`,
      qty: 1,
      unitRate: tier.price,
      amount: tier.price,
      attrs: { widthInches: b.widthInches, location: b.location },
    });
  });
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
