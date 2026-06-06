"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { savePricingCard, setTradeCoverage, type TradeCard, type FlooringCard, type WtCard } from "./actions";

const numCls = "w-28 font-mono text-right border border-bw-border rounded-lg px-2 py-1.5 text-[14px] outline-none focus:border-bw-green";
const txtCls = "w-full rounded-lg border border-bw-border px-3 py-2 text-[14px] outline-none focus:border-bw-green focus:ring-2 focus:ring-bw-green-tint";

function flooringComplete(c: FlooringCard) {
  return c.systems.filter((s) => s.perSqft != null && s.perSqft > 0).length > 0;
}
function wtComplete(c: WtCard) {
  return c.products.filter((p) => p.perShade != null && p.perShade > 0).length > 0;
}

/** Small hover tooltip — plain-language help for non-technical contractors. */
function Info({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex align-middle ml-1">
      <span className="w-[15px] h-[15px] rounded-full bg-bw-border text-bw-body text-[10px] font-bold flex items-center justify-center cursor-help select-none">?</span>
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-60 rounded-lg bg-bw-text text-white text-[12px] leading-snug px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-lg text-left font-normal normal-case tracking-normal">
        {text}
      </span>
    </span>
  );
}

function Toggle({ on, onClick, busy }: { on: boolean; onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={busy}
      onClick={onClick}
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${on ? "bg-bw-green" : "bg-bw-border"} ${busy ? "opacity-60" : ""}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

export function PricingEditor({ category, cards }: { category: string | null; cards: TradeCard[] }) {
  const router = useRouter();
  const [models, setModels] = useState<TradeCard[]>(cards);
  const [busy, setBusy] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function patch(tradeId: string, fn: (t: TradeCard) => TradeCard) {
    setModels((ms) => ms.map((m) => (m.tradeId === tradeId ? fn(m) : m)));
  }

  async function onToggle(t: TradeCard) {
    const next = !t.covered;
    setToggling(t.tradeId);
    setError(null);
    patch(t.tradeId, (m) => ({ ...m, covered: next }));
    try {
      await setTradeCoverage(t.tradeId, next);
      router.refresh();
    } catch (e) {
      patch(t.tradeId, (m) => ({ ...m, covered: !next })); // revert
      setError((e as Error).message);
    } finally {
      setToggling(null);
    }
  }

  async function onSave(t: TradeCard) {
    setBusy(t.tradeId);
    setError(null);
    setSaved(null);
    try {
      // Default each rate's name to the trade label so an unnamed primary rate isn't dropped.
      const payload =
        t.flooring
          ? ({ ...t.flooring, systems: t.flooring.systems.map((s) => ({ ...s, name: s.name?.trim() || t.label })) } as FlooringCard)
          : (t.wt as WtCard);
      await savePricingCard(t.tradeId, t.category, payload);
      setSaved(t.tradeId);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const complete = (t: TradeCard) => (t.flooring ? flooringComplete(t.flooring) : t.wt ? wtComplete(t.wt) : false);

  return (
    <div className="max-w-[860px] mx-auto">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h1 className="text-[1.8rem] font-extrabold tracking-tight">Your services &amp; pricing</h1>
        <a href="/app/settings" className="text-[13px] font-semibold text-bw-body hover:text-bw-text">← Settings</a>
      </div>
      <p className="text-[14px] text-bw-body mb-6">
        Switch on the services you bid and set your price. <span className="text-bw-text font-medium">Only the ones turned on get bid.</span> Every number is a charged price — never cost or margin.
      </p>

      {error && <p className="text-[13px] text-bw-red mb-4">{error}</p>}

      {!category && (
        <Card className="p-6 text-[14px] text-bw-body">
          No category yet. <a href="/app/onboarding/trades" className="text-bw-green font-semibold">Pick what you bid →</a>
        </Card>
      )}

      <div className="space-y-4">
        {models.map((t) => (
          <Card key={t.tradeId} className={`p-6 ${t.covered ? "" : "bg-bw-surface/40"}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Toggle on={t.covered} busy={toggling === t.tradeId} onClick={() => onToggle(t)} />
                <div>
                  <div className={`font-extrabold text-[16px] ${t.covered ? "" : "text-bw-body"}`}>{t.label}</div>
                  <div className="text-[12px] text-bw-muted">{t.covered ? (complete(t) ? "On — bidding this" : "On — needs a price") : "Off — not bidding"}</div>
                </div>
              </div>
              {t.covered &&
                (complete(t) ? (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-bw-green-tint text-bw-green">PRICES BIDS</span>
                ) : (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-bw-amber-tint text-bw-amber">NEEDS A PRICE</span>
                ))}
            </div>

            {t.covered && (
              <div className="mt-5 pt-5 border-t border-bw-border">
                {t.flooring && <FlooringForm label={t.label} card={t.flooring} onChange={(c) => patch(t.tradeId, (m) => ({ ...m, flooring: c }))} />}
                {t.wt && <WtForm card={t.wt} onChange={(c) => patch(t.tradeId, (m) => ({ ...m, wt: c }))} />}

                <div className="flex items-center justify-end gap-3 mt-5">
                  {saved === t.tradeId && <span className="text-[13px] text-bw-green mr-auto">Saved.</span>}
                  {(t.flooring || t.wt) && (
                    <Button onClick={() => onSave(t)} disabled={busy === t.tradeId}>{busy === t.tradeId ? "Saving…" : "Save price"}</Button>
                  )}
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function Num({ label, suffix, value, onChange, tip }: { label: string; suffix: string; value: number | null; onChange: (v: number | null) => void; tip: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[14px] inline-flex items-center">{label}<Info text={tip} /></span>
      <div className="flex items-center gap-1">
        {suffix !== "%" && <span className="text-bw-muted">$</span>}
        <input type="number" step="0.01" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} className="w-24 font-mono text-right border border-bw-border rounded-lg px-2 py-1.5 text-[14px] outline-none focus:border-bw-green" />
        <span className="text-bw-muted text-[12px]">{suffix}</span>
      </div>
    </div>
  );
}

function FlooringForm({ label, card, onChange }: { label: string; card: FlooringCard; onChange: (c: FlooringCard) => void }) {
  const [showAddons, setShowAddons] = useState(
    card.prepPerSqft != null || card.baseTrimPerLf != null || card.mobilizationFee != null || card.discountPct != null || card.taxPct != null,
  );
  const primary = card.systems[0] ?? { name: "", perSqft: 0 };
  const variants = card.systems.slice(1);

  const setPrimaryPrice = (v: number | null) => {
    const perSqft = v ?? 0;
    const systems = card.systems.length ? card.systems.map((s, i) => (i === 0 ? { ...s, perSqft } : s)) : [{ name: "", perSqft }];
    onChange({ ...card, systems });
  };
  const setVariant = (idx: number, k: "name" | "perSqft", v: string) => {
    const at = idx + 1;
    onChange({ ...card, systems: card.systems.map((s, j) => (j === at ? { ...s, [k]: k === "perSqft" ? (v === "" ? 0 : Number(v)) : v } : s)) });
  };
  const addVariant = () => onChange({ ...card, systems: [...(card.systems.length ? card.systems : [{ name: "", perSqft: 0 }]), { name: "", perSqft: 0 }] });
  const removeVariant = (idx: number) => onChange({ ...card, systems: card.systems.filter((_, j) => j !== idx + 1) });

  return (
    <div className="space-y-5">
      {/* Primary rate — the simple case: one price per SF */}
      <div>
        <label className="text-[14px] font-semibold inline-flex items-center">
          Your price per square foot
          <Info text={`What you charge per finished square foot for ${label.toLowerCase()} — all-in, labor + material. This is the main number used to price a job.`} />
        </label>
        <div className="flex items-center gap-1.5 mt-2">
          <span className="text-bw-muted text-[15px]">$</span>
          <input type="number" step="0.01" placeholder="0.00" value={primary.perSqft || ""} onChange={(e) => setPrimaryPrice(e.target.value === "" ? null : Number(e.target.value))} className="w-32 font-mono text-right border border-bw-border rounded-lg px-3 py-2 text-[15px] outline-none focus:border-bw-green" />
          <span className="text-bw-muted text-[13px]">/ sq ft</span>
        </div>
      </div>

      {/* Optional named variants — only for contractors who price multiple systems */}
      {variants.length > 0 && (
        <div className="space-y-2">
          <div className="text-[12px] font-semibold text-bw-muted inline-flex items-center">OTHER PRICED OPTIONS<Info text="If you charge different rates for different systems (e.g. standard vs. heavy-duty), add them here with a short name so the engine can match the right one." /></div>
          {variants.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className={txtCls + " flex-1"} placeholder="Name this option (e.g. broadcast quartz)" value={v.name} onChange={(e) => setVariant(i, "name", e.target.value)} />
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-bw-muted">$</span>
                <input type="number" step="0.01" className={numCls} value={v.perSqft || ""} onChange={(e) => setVariant(i, "perSqft", e.target.value)} />
                <span className="text-bw-muted text-[12px]">/SF</span>
              </div>
              <button type="button" onClick={() => removeVariant(i)} className="w-9 h-9 rounded-lg border border-bw-border text-bw-muted hover:text-bw-text hover:bg-bw-surface flex items-center justify-center flex-shrink-0" aria-label="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={addVariant} className="text-[13px] text-bw-green font-semibold">+ I charge a different rate for another system</button>

      {/* Optional add-ons, collapsed by default */}
      <div className="border-t border-bw-border pt-4">
        {!showAddons ? (
          <button type="button" onClick={() => setShowAddons(true)} className="text-[13px] text-bw-green font-semibold">+ Add optional extras (prep, base, mobilization, discount, tax)</button>
        ) : (
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
            <Num label="Substrate prep" suffix="/SF" value={card.prepPerSqft} onChange={(v) => onChange({ ...card, prepPerSqft: v })} tip="Extra per-SF charge to prep the slab (grinding, moisture, leveling) when the spec calls for it. Leave blank if it's already included in your per-SF price." />
            <Num label="Base / trim" suffix="/LF" value={card.baseTrimPerLf} onChange={(v) => onChange({ ...card, baseTrimPerLf: v })} tip="Per linear foot for wall base, cove base, or transition strips — only if you bill those separately." />
            <Num label="Mobilization fee" suffix="flat" value={card.mobilizationFee} onChange={(v) => onChange({ ...card, mobilizationFee: v })} tip="A one-time flat setup/mobilization charge per job, if you have one. Leave blank or 0 if you don't charge it." />
            <Num label="Default discount" suffix="%" value={card.discountPct} onChange={(v) => onChange({ ...card, discountPct: v })} tip="A standard discount you usually apply, as a percent. Leave blank for none." />
            <Num label="Sales tax" suffix="%" value={card.taxPct} onChange={(v) => onChange({ ...card, taxPct: v })} tip="Your sales-tax rate as a percent. Leave blank if you quote tax-excluded (most commercial subs do)." />
          </div>
        )}
      </div>

      <p className="text-[12px] text-bw-muted">Just the per-SF price is enough to start bidding — everything else is optional.</p>
    </div>
  );
}

function WtForm({ card, onChange }: { card: WtCard; onChange: (c: WtCard) => void }) {
  const [showAddons, setShowAddons] = useState(card.mobilizationFee != null || card.discountPct != null || card.taxPct != null);
  const setProduct = (i: number, k: "name" | "perShade" | "size", v: string) =>
    onChange({
      ...card,
      products: card.products.map((p, j) => (j === i ? { ...p, [k]: k === "perShade" ? (v === "" ? 0 : Number(v)) : k === "size" ? (v || null) : v } : p)),
    });
  const addProduct = () => onChange({ ...card, products: [...card.products, { name: "", perShade: 0, size: null }] });
  const removeProduct = (i: number) => onChange({ ...card, products: card.products.filter((_, j) => j !== i) });

  return (
    <div className="space-y-5">
      <div>
        <label className="text-[14px] font-semibold inline-flex items-center">
          Your shade products — price each
          <Info text="Each shade/blind product you install and the charged price per unit (all-in). Name by operation + fabric (e.g. 'Motorized solar roller shade'); the size is the window size that price is for — the engine matches by product and notes the size on the bid." />
        </label>
        <div className="space-y-2 mt-2">
          {card.products.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className={txtCls + " flex-1"} placeholder="Product name (e.g. Motorized solar roller shade)" value={p.name} onChange={(e) => setProduct(i, "name", e.target.value)} />
              <input className="w-32 rounded-lg border border-bw-border px-2 py-2 text-[12px] text-bw-body outline-none focus:border-bw-green flex-shrink-0" placeholder={'60"W x 96"H'} value={p.size ?? ""} onChange={(e) => setProduct(i, "size", e.target.value)} />
              <div className="flex items-center gap-1 flex-shrink-0"><span className="text-bw-muted">$</span>
                <input type="number" step="0.01" className={numCls} value={p.perShade || ""} onChange={(e) => setProduct(i, "perShade", e.target.value)} />
                <span className="text-bw-muted text-[12px]">each</span>
              </div>
              <button type="button" onClick={() => removeProduct(i)} className="w-9 h-9 rounded-lg border border-bw-border text-bw-muted hover:text-bw-text hover:bg-bw-surface flex items-center justify-center flex-shrink-0" aria-label="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
          {card.products.length === 0 && <p className="text-[13px] text-bw-muted">No products yet — add the shade types you install.</p>}
        </div>
        <button type="button" onClick={addProduct} className="text-[13px] text-bw-green font-semibold mt-2">+ Add a shade product</button>
      </div>

      <div className="border-t border-bw-border pt-4">
        {!showAddons ? (
          <button type="button" onClick={() => setShowAddons(true)} className="text-[13px] text-bw-green font-semibold">+ Add optional extras (mobilization, discount, tax)</button>
        ) : (
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
            <Num label="Mobilization fee" suffix="flat" value={card.mobilizationFee} onChange={(v) => onChange({ ...card, mobilizationFee: v })} tip="A one-time flat setup/mobilization charge per job, if you have one. Leave blank or 0 if you don't charge it." />
            <Num label="Default discount" suffix="%" value={card.discountPct} onChange={(v) => onChange({ ...card, discountPct: v })} tip="A standard discount you usually apply, as a percent. Leave blank for none." />
            <Num label="Sales tax" suffix="%" value={card.taxPct} onChange={(v) => onChange({ ...card, taxPct: v })} tip="Your sales-tax rate as a percent. Leave blank if you quote tax-excluded (most commercial subs do)." />
          </div>
        )}
      </div>

      <p className="text-[12px] text-bw-muted">Name each product by operation + fabric so the engine matches it to the spec; the per-shade price is what gets bid.</p>
    </div>
  );
}
