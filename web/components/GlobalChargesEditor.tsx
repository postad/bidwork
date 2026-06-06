"use client";

export type GlobalCharge = { label: string; amount: number; kind: "flat" | "percent" };

/** Shared editor for a contractor's flat/% global charges (Installation, Delivery, …).
 *  Used in onboarding confirm + Settings pricing, for every vertical. */
export function GlobalChargesEditor({ charges, onChange }: { charges: GlobalCharge[]; onChange: (c: GlobalCharge[]) => void }) {
  const add = () => onChange([...charges, { label: "", amount: 0, kind: "percent" }]);
  const set = (i: number, patch: Partial<GlobalCharge>) => onChange(charges.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const remove = (i: number) => onChange(charges.filter((_, j) => j !== i));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="font-semibold text-[14px]">Global charges</div>
        <button type="button" onClick={add} className="text-[13px] text-bw-green font-semibold">+ Add global charge</button>
      </div>
      <div className="text-[12px] text-bw-muted mb-3">Flat $ or % of products, added to every quote — e.g. Installation, Delivery, Minimum.</div>
      <div className="space-y-2">
        {charges.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <input value={c.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Installation" className="flex-1 rounded-lg border border-bw-border px-2 py-1.5 text-[13px] outline-none focus:border-bw-green" />
            <button type="button" onClick={() => set(i, { kind: c.kind === "percent" ? "flat" : "percent" })} title="Switch $ / %" className="w-9 h-9 rounded-lg border border-bw-border font-semibold text-bw-body hover:bg-bw-surface flex-shrink-0">{c.kind === "percent" ? "%" : "$"}</button>
            <input type="number" step="0.01" value={c.amount || ""} onChange={(e) => set(i, { amount: Number(e.target.value) })} className="w-24 font-mono text-right border border-bw-border rounded-lg px-2 py-1.5 text-[13px]" />
            <button type="button" onClick={() => remove(i)} className="w-9 h-9 rounded-lg border border-bw-border text-bw-muted hover:text-bw-text hover:bg-bw-surface flex items-center justify-center flex-shrink-0" aria-label="Remove">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        ))}
        {charges.length === 0 && <p className="text-[13px] text-bw-muted">None — add Installation or other flat/% fees if you charge them.</p>}
      </div>
    </div>
  );
}
