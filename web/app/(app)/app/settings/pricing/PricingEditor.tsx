"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { savePricingCard, type TradeCard, type FlooringCard, type WtCard } from "./actions";

const field = "w-full rounded-lg border border-bw-border px-3 py-2 text-[14px] outline-none focus:border-bw-green focus:ring-2 focus:ring-bw-green-tint";
const numCls = "w-28 font-mono text-right border border-bw-border rounded-lg px-2 py-1.5 text-[14px] outline-none focus:border-bw-green";

function flooringComplete(c: FlooringCard) {
  return c.systems.filter((s) => s.name && s.perSqft != null).length > 0;
}
function wtComplete(c: WtCard) {
  return c.motorized.length > 0 && c.blinds.length > 0 && c.fixedPanelPrice != null && c.installFee != null;
}

export function PricingEditor({ cards }: { cards: TradeCard[] }) {
  const router = useRouter();
  const [models, setModels] = useState<TradeCard[]>(cards);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function patch(tradeId: string, fn: (t: TradeCard) => TradeCard) {
    setModels((ms) => ms.map((m) => (m.tradeId === tradeId ? fn(m) : m)));
  }

  async function onSave(t: TradeCard) {
    setBusy(t.tradeId);
    setError(null);
    setSaved(null);
    try {
      await savePricingCard(t.tradeId, t.category, (t.flooring ?? t.wt) as FlooringCard | WtCard);
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
    <div className="max-w-[840px] mx-auto">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h1 className="text-[1.8rem] font-extrabold tracking-tight">Pricing model</h1>
        <a href="/app/settings" className="text-[13px] font-semibold text-bw-body hover:text-bw-text">← Settings</a>
      </div>
      <p className="text-[14px] text-bw-body mb-6">
        Your trained rate card, per sub-trade. Edit any number — the next generated bid uses it.{" "}
        <a href="/app/onboarding/trades" className="text-bw-green font-semibold">Add or change the trades you bid →</a>
      </p>

      {error && <p className="text-[13px] text-bw-red mb-4">{error}</p>}

      {models.length === 0 && (
        <Card className="p-6 text-[14px] text-bw-body">
          No sub-trades selected yet. <a href="/app/onboarding/trades" className="text-bw-green font-semibold">Pick the trades you bid →</a>
        </Card>
      )}

      <div className="space-y-6">
        {models.map((t) => (
          <Card key={t.tradeId} className="p-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <div className="font-extrabold text-[16px]">{t.label}</div>
                <div className="text-[12px] text-bw-muted">{t.category}</div>
              </div>
              {complete(t) ? (
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-bw-green-tint text-bw-green">PRICES BIDS</span>
              ) : (
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-bw-amber-tint text-bw-amber" title="Incomplete rate card — this trade is skipped when pricing a bid.">WON&apos;T PRICE — INCOMPLETE</span>
              )}
            </div>

            {t.flooring && <FlooringForm card={t.flooring} onChange={(c) => patch(t.tradeId, (m) => ({ ...m, flooring: c }))} />}
            {t.wt && <WtForm card={t.wt} onChange={(c) => patch(t.tradeId, (m) => ({ ...m, wt: c }))} />}
            {!t.flooring && !t.wt && <p className="text-[13px] text-bw-muted">No pricing editor for this category yet.</p>}

            <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-bw-border">
              {saved === t.tradeId && <span className="text-[13px] text-bw-green mr-auto">Saved.</span>}
              {(t.flooring || t.wt) && (
                <Button onClick={() => onSave(t)} disabled={busy === t.tradeId}>{busy === t.tradeId ? "Saving…" : "Save rate card"}</Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Num({ label, suffix, value, onChange }: { label: string; suffix: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[14px]">{label}</span>
      <div className="flex items-center gap-1">
        {suffix !== "%" && <span className="text-bw-muted">$</span>}
        <input type="number" step="0.01" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} className="w-24 font-mono text-right border border-bw-border rounded-lg px-2 py-1.5 text-[14px] outline-none focus:border-bw-green" />
        <span className="text-bw-muted text-[12px]">{suffix}</span>
      </div>
    </div>
  );
}

function FlooringForm({ card, onChange }: { card: FlooringCard; onChange: (c: FlooringCard) => void }) {
  const setSys = (i: number, k: "name" | "perSqft", v: string) =>
    onChange({ ...card, systems: card.systems.map((s, j) => (j === i ? { ...s, [k]: k === "perSqft" ? (v === "" ? 0 : Number(v)) : v } : s)) });
  const addSys = () => onChange({ ...card, systems: [...card.systems, { name: "", perSqft: 0 }] });
  const removeSys = (i: number) => onChange({ ...card, systems: card.systems.filter((_, j) => j !== i) });

  return (
    <div className="space-y-5">
      <div>
        <div className="text-[13px] font-semibold mb-2">Floor systems — charged price per square foot</div>
        <div className="space-y-2">
          {card.systems.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className={field + " flex-1"} placeholder="e.g. Polished concrete L3" value={s.name} onChange={(e) => setSys(i, "name", e.target.value)} />
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-bw-muted">$</span>
                <input type="number" step="0.01" className={numCls} value={s.perSqft} onChange={(e) => setSys(i, "perSqft", e.target.value)} />
                <span className="text-bw-muted text-[12px]">/SF</span>
              </div>
              <button type="button" onClick={() => removeSys(i)} className="w-9 h-9 rounded-lg border border-bw-border text-bw-muted hover:text-bw-text hover:bg-bw-surface flex items-center justify-center flex-shrink-0" aria-label="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
          {card.systems.length === 0 && <p className="text-[13px] text-bw-muted">No systems yet — add at least one to price bids for this trade.</p>}
        </div>
        <button type="button" onClick={addSys} className="mt-2.5 text-[13px] text-bw-green font-semibold">+ Add system</button>
      </div>

      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3 border-t border-bw-border pt-4">
        <Num label="Substrate prep" suffix="/SF" value={card.prepPerSqft} onChange={(v) => onChange({ ...card, prepPerSqft: v })} />
        <Num label="Base / trim" suffix="/LF" value={card.baseTrimPerLf} onChange={(v) => onChange({ ...card, baseTrimPerLf: v })} />
        <Num label="Mobilization fee" suffix="flat" value={card.mobilizationFee} onChange={(v) => onChange({ ...card, mobilizationFee: v })} />
        <Num label="Default discount" suffix="%" value={card.discountPct} onChange={(v) => onChange({ ...card, discountPct: v })} />
        <Num label="Sales tax" suffix="%" value={card.taxPct} onChange={(v) => onChange({ ...card, taxPct: v })} />
      </div>
      <p className="text-[12px] text-bw-muted">At least one floor system is required to price bids. Prep, base/trim, and mobilization are optional add-ons.</p>
    </div>
  );
}

function WtForm({ card, onChange }: { card: WtCard; onChange: (c: WtCard) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <div className="text-[13px] font-semibold mb-2">Motorized roller — by ganging</div>
        <div className="space-y-2">
          {card.motorized.map((m, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <span className="text-[14px]">{m.shadesPerMotor} on 1 motor</span>
              <div className="flex items-center gap-1"><span className="text-bw-muted">$</span>
                <input type="number" className={numCls} value={m.price} onChange={(e) => onChange({ ...card, motorized: card.motorized.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)) })} />
                <span className="text-bw-muted text-[12px]">/set</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[13px] font-semibold mb-2">Manual blinds — by width</div>
        <div className="space-y-2">
          {card.blinds.map((b, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <span className="text-[14px]">≤ {b.maxWidthInches}&quot; wide</span>
              <div className="flex items-center gap-1"><span className="text-bw-muted">$</span>
                <input type="number" className={numCls} value={b.price} onChange={(e) => onChange({ ...card, blinds: card.blinds.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)) })} />
                <span className="text-bw-muted text-[12px]">/blind</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3 border-t border-bw-border pt-4">
        <Num label="Fixed panel shade" suffix="/shade" value={card.fixedPanelPrice} onChange={(v) => onChange({ ...card, fixedPanelPrice: v })} />
        <Num label="Install fee" suffix="flat" value={card.installFee} onChange={(v) => onChange({ ...card, installFee: v })} />
        <Num label="Default discount" suffix="%" value={card.discountPct} onChange={(v) => onChange({ ...card, discountPct: v })} />
        <Num label="Sales tax" suffix="%" value={card.taxPct} onChange={(v) => onChange({ ...card, taxPct: v })} />
      </div>
    </div>
  );
}
