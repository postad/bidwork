"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveBidEdits, approveAndSend, type LineInput } from "./actions";

export type BidLine = {
  id: string;
  location: string | null;
  typeCode: string | null;
  description: string | null;
  qty: number;
  unit: string | null;
  unitPrice: number;
  attrs: Record<string, unknown>;
};

export type BidData = {
  id: string;
  kind: string; // 'priced' | 'site_visit'
  status: string;
  projectName: string | null;
  gcName: string | null;
  gcEmail: string | null;
  bidDue: string | null;
  discountPct: number;
  discountLabel: string | null;
  deliveryInstall: number;
  taxRate: number;
  notesToGc: string | null;
  sentAt: string | null;
  company: { name: string; replyTo: string | null; website: string | null; address: string | null };
  boilerplate: { paymentTerms: string | null; warranty: string | null; validityDays: number | null; exclusions: string[]; disclaimer: string | null };
  lines: BidLine[];
};

const DEFAULT_EXCLUSIONS = [
  "Electrical rough-in / line voltage for motorized units (by others)",
  "Structural blocking and backing",
  "Permits, filing, and controlled inspections",
];

const r2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

function computeTotals(lines: BidLine[], discountPct: number, install: number, taxRate: number) {
  const products = r2(lines.reduce((a, l) => a + l.qty * l.unitPrice, 0));
  const discount = -Math.round(products * discountPct);
  const subtotal = r2(products + discount + install);
  const tax = r2(subtotal * taxRate);
  const total = r2(subtotal + tax);
  return { products, discount, subtotal, tax, total };
}

export function BidReview({ data }: { data: BidData }) {
  const router = useRouter();
  const sent = data.status === "sent";
  const sv = data.kind === "site_visit";

  const [lines, setLines] = useState<BidLine[]>(data.lines);
  const [discountPct, setDiscountPct] = useState(data.discountPct);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [subject, setSubject] = useState(
    sv ? `${data.projectName ?? "Your project"} — window treatments · ${data.company.name}` : `Proposal — ${data.projectName ?? "your project"} · ${data.company.name}`,
  );
  const [body, setBody] = useState(
    sv
      ? `Hi ${data.gcName ?? "there"},\n\nWe reviewed the documents for ${data.projectName ?? "this project"} and saw the window-treatment scope. The set calls it out but doesn't include a shade schedule or dimensioned plan, so rather than guess a number we'd like to do a quick field measure and send you an accurate, itemized quote.\n\nWe work right in your area and can turn this around fast — just reply to set up a visit.\n\nBest,\n${data.company.name}`
      : `Hi ${data.gcName ?? "there"},\n\nThank you for the opportunity to bid ${data.projectName ?? "this project"}. Our proposal for the window-treatment scope is attached.\n\nHappy to walk through anything or adjust scope — just reply to this email and it comes straight to me.\n\nBest,\n${data.company.name}`,
  );
  const [ccMe, setCcMe] = useState(true);

  const t = useMemo(() => computeTotals(lines, discountPct, data.deliveryInstall, data.taxRate), [lines, discountPct, data.deliveryInstall, data.taxRate]);

  const grouped = useMemo(() => {
    const groups: { location: string; items: BidLine[] }[] = [];
    for (const l of lines) {
      const loc = l.location ?? "General";
      let g = groups.find((x) => x.location === loc);
      if (!g) {
        g = { location: loc, items: [] };
        groups.push(g);
      }
      g.items.push(l);
    }
    return groups;
  }, [lines]);

  function setLine(id: string, patch: Partial<BidLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    try {
      const payload: LineInput[] = lines.map((l) => ({ id: l.id, location: l.location, description: l.description, qty: l.qty, unitPrice: l.unitPrice }));
      await saveBidEdits(data.id, payload, discountPct);
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSend() {
    setBusy(true);
    setError(null);
    try {
      await approveAndSend(data.id, { subject, body, ccMe });
      setModalOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  // ---- Sent state ----
  if (sent) {
    return (
      <div className="max-w-[620px] mx-auto text-center py-10">
        <div className="w-16 h-16 rounded-full bg-bw-green-tint flex items-center justify-center mx-auto mb-5">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#14A800" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        </div>
        <h1 className="text-[1.7rem] font-extrabold tracking-tight mb-2">{sv ? "Visit request sent" : "Bid sent"}{data.gcName ? ` to ${data.gcName}` : ""}.</h1>
        <p className="text-[14px] text-bw-body mb-8">Your {sv ? "site-visit request" : "proposal"} for <span className="font-semibold text-bw-text">{data.projectName}</span> is on its way.</p>
        <div className="bg-white rounded-2xl border border-bw-border p-6 text-left mb-6">
          <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-4">Delivery receipt</div>
          <div className="space-y-3 text-[14px]">
            <Row label="Sent to" value={`${data.gcName ?? ""} · ${data.gcEmail ?? ""}`} />
            <Row label="Reply-to" value={data.company.replyTo ?? "—"} valueClass="text-bw-green" />
            {sv ? <Row label="Request" value="Site visit · quote on measure" /> : <Row label="Bid value" value={usd(t.total)} mono />}
          </div>
        </div>
        <Link href="/app" className="inline-flex items-center justify-center gap-2 bg-bw-green text-white font-semibold text-[15px] px-7 py-3 rounded-full hover:bg-bw-green-hover">
          Back to your bids
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* sub-bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/app" className="text-bw-muted hover:text-bw-text" title="Back to bids">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
          </Link>
          <div className="min-w-0">
            <div className="font-semibold truncate">{data.projectName ?? "Bid"}</div>
            <div className="text-[12px] text-bw-muted truncate">
              {[data.gcName, data.bidDue ? `due ${data.bidDue}` : null].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button onClick={() => { setLines(data.lines); setDiscountPct(data.discountPct); setEditing(false); }} disabled={busy} className="bg-white text-bw-body font-semibold text-[13px] px-4 py-2 rounded-full border border-bw-border hover:bg-bw-surface">Cancel</button>
              <button onClick={onSave} disabled={busy} className="bg-bw-text text-white font-semibold text-[13px] px-5 py-2 rounded-full hover:bg-bw-green disabled:opacity-50">{busy ? "Saving…" : "Save changes"}</button>
            </>
          ) : (
            <>
              {!sv && (
                <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 bg-white text-bw-text font-semibold text-[13px] px-4 py-2 rounded-full border border-bw-border hover:bg-bw-green-tint">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
                  Edit
                </button>
              )}
              <button onClick={() => setModalOpen(true)} className="inline-flex items-center gap-1.5 bg-bw-green text-white font-semibold text-[13px] px-5 py-2 rounded-full hover:bg-bw-green-hover">
                {sv ? "Approve & send request" : "Approve & send"}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="text-[13px] text-bw-red mb-4">{error}</p>}

      <div className="grid lg:grid-cols-3 gap-8 items-start">
        {/* LEFT — the bid document */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-bw-border shadow-sm overflow-hidden">
          <div className="px-8 pt-8 pb-6 border-b border-bw-border flex items-start justify-between">
            <div>
              <div className="font-black text-[22px] tracking-tight leading-none">{data.company.name}</div>
              <div className="text-[12px] text-bw-muted mt-1.5">
                {[data.company.address, data.company.website].filter(Boolean).join(" · ") || "Commercial Window Treatments"}
              </div>
            </div>
            <div className="text-right text-[12px] text-bw-muted font-mono">
              <div>PROPOSAL</div>
              <div>{data.id.slice(0, 8).toUpperCase()}</div>
            </div>
          </div>

          <div className="px-8 py-6 space-y-7">
            <div className="grid sm:grid-cols-2 gap-4 text-[13px]">
              <div>
                <div className="text-[11px] font-semibold text-bw-muted uppercase tracking-wider mb-1.5">Prepared for</div>
                <div className="font-semibold">{data.gcName ?? "—"}</div>
                <div className="text-bw-body">{data.gcEmail ?? ""}</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-bw-muted uppercase tracking-wider mb-1.5">Project</div>
                <div className="font-semibold">{data.projectName ?? "—"}</div>
                {data.bidDue && <div className="text-bw-body">Bid due: {data.bidDue}</div>}
              </div>
            </div>

            {/* site-visit: what we read + visit request, no pricing table */}
            {sv && (
              <div>
                <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-2">What we read</div>
                {data.notesToGc && <p className="text-[14px] text-bw-body leading-relaxed mb-4">{data.notesToGc}</p>}
                <div className="rounded-xl bg-bw-green-tint/50 border border-bw-green-tint-2 px-4 py-3 text-[13px] text-bw-body">
                  <span className="font-semibold text-bw-green-deep">Site visit requested.</span> The set names the window-treatment scope but has no shade schedule or dimensioned plan, so we&apos;ll field-measure and send an accurate, itemized quote — rather than guess a number.
                </div>
              </div>
            )}

            {/* line items */}
            {!sv && (
            <div>
              <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-3">Pricing</div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] text-bw-muted uppercase tracking-wider border-b border-bw-border">
                    <th className="text-left font-semibold py-2">Location · item</th>
                    <th className="text-center font-semibold py-2 w-16">Qty</th>
                    <th className="text-right font-semibold py-2 w-28">Unit</th>
                    <th className="text-right font-semibold py-2 w-28">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bw-border">
                  {grouped.map((g) => (
                    <GroupRows key={g.location} group={g} editing={editing} onChange={setLine} />
                  ))}
                </tbody>
                <tfoot>
                  <FootRow label="Subtotal" value={usd(t.products)} border />
                  {editing ? (
                    <tr>
                      <td colSpan={3} className="py-1.5 text-right text-bw-body">
                        <span className="inline-flex items-center gap-1.5 justify-end">
                          Discount
                          <input
                            type="number"
                            value={Math.round(discountPct * 1000) / 10}
                            onChange={(e) => setDiscountPct((Number(e.target.value) || 0) / 100)}
                            className="w-16 font-mono text-right border border-bw-green/40 rounded px-1 py-0.5 outline-none focus:border-bw-green"
                          />
                          %
                        </span>
                      </td>
                      <td className="text-right font-mono text-bw-green">−{usd(Math.abs(t.discount))}</td>
                    </tr>
                  ) : (
                    t.discount !== 0 && <FootRow label={`Discount (${Math.round(discountPct * 100)}%)`} value={`−${usd(Math.abs(t.discount))}`} green />
                  )}
                  <FootRow label="Delivery & install" value={usd(data.deliveryInstall)} />
                  <FootRow label={`Tax (${(data.taxRate * 100).toFixed(3).replace(/\.?0+$/, "")}%)`} value={usd(t.tax)} />
                  <tr className="border-t border-bw-border">
                    <td colSpan={3} className="py-2.5 text-right font-semibold text-[15px]">Total bid</td>
                    <td className="text-right font-mono font-bold text-[15px] text-bw-green">{usd(t.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            )}

            <div>
              <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-2">Exclusions</div>
              <ul className="text-[13px] text-bw-body space-y-1 list-disc pl-5">
                {(data.boilerplate.exclusions.length ? data.boilerplate.exclusions : DEFAULT_EXCLUSIONS).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>

            <div className="grid sm:grid-cols-2 gap-4 text-[13px] pt-2 border-t border-bw-border">
              <div>
                <div className="text-[11px] font-semibold text-bw-muted uppercase tracking-wider mb-1">Terms</div>
                <div className="text-bw-body">
                  {data.boilerplate.paymentTerms ?? "50% deposit, 50% on completion."}
                  {data.boilerplate.validityDays ? ` Valid ${data.boilerplate.validityDays} days.` : ""}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-bw-muted uppercase tracking-wider mb-1">Warranty</div>
                <div className="text-bw-body">{data.boilerplate.warranty ?? "2 years labor · manufacturer warranty on product"}</div>
              </div>
            </div>

            {data.boilerplate.disclaimer && (
              <p className="text-[11px] text-bw-muted leading-relaxed pt-2 border-t border-bw-border">{data.boilerplate.disclaimer}</p>
            )}
          </div>
        </div>

        {/* RIGHT — send + totals */}
        <div className="space-y-5 lg:sticky lg:top-6">
          <div className="bg-white rounded-2xl border border-bw-border p-6">
            <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-4">Ready to send</div>
            <div className="space-y-3 text-[13px]">
              <Row label="To" value={data.gcEmail ?? "—"} />
              <Row label="Reply-to" value={data.company.replyTo ?? "—"} valueClass="text-bw-green" />
            </div>
            <div className="mt-4 p-3 rounded-xl bg-bw-green-tint/60 text-[12px] text-bw-body leading-snug">
              When the GC replies, it lands in <span className="font-semibold text-bw-text">your inbox</span> — not ours.
            </div>
            <button onClick={() => setModalOpen(true)} className="mt-4 w-full inline-flex items-center justify-center gap-2 bg-bw-green text-white font-semibold text-[14px] px-5 py-3 rounded-full hover:bg-bw-green-hover">
              {sv ? "Approve & send request" : "Approve & send bid"}
            </button>
            {!sv && <button onClick={() => setEditing(true)} className="mt-2 w-full text-[13px] font-semibold text-bw-body hover:text-bw-text py-2">Edit bid first</button>}
          </div>

          {sv ? (
            <div className="bg-white rounded-2xl border border-bw-border p-6">
              <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-2">No price yet</div>
              <p className="text-[13px] text-bw-body leading-snug">This is a <span className="font-semibold text-bw-text">site-visit request</span>, not a priced bid. We field-measure first, then send an accurate itemized quote — no guessed numbers.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-bw-border p-6">
              <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-4">Bid total</div>
              <div className="space-y-2.5 text-[13px]">
                <div className="flex justify-between"><span className="text-bw-body">Products</span><span className="font-mono">{usd(t.products)}</span></div>
                {t.discount !== 0 && <div className="flex justify-between"><span className="text-bw-body">Discount</span><span className="font-mono text-bw-green">−{usd(Math.abs(t.discount))}</span></div>}
                <div className="flex justify-between"><span className="text-bw-body">Delivery & install</span><span className="font-mono">{usd(data.deliveryInstall)}</span></div>
                <div className="flex justify-between"><span className="text-bw-body">Tax</span><span className="font-mono">{usd(t.tax)}</span></div>
                <div className="flex justify-between border-t border-bw-border pt-2.5"><span className="font-semibold">Total bid</span><span className="font-mono font-bold text-bw-green">{usd(t.total)}</span></div>
              </div>
              {editing && <p className="text-[11px] text-bw-muted mt-3">Confirm ganging tiers &amp; blind widths above — the total updates live.</p>}
            </div>
          )}
        </div>
      </div>

      {/* send modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 overflow-y-auto py-10 px-4">
          <div className="bg-white rounded-2xl border border-bw-border shadow-xl max-w-[640px] w-full">
            <div className="px-6 py-4 border-b border-bw-border flex items-center justify-between">
              <div>
                <div className="font-semibold text-[15px]">Final preview</div>
                <div className="text-[12px] text-bw-muted">This is exactly what {data.gcName ?? "the GC"} receives.</div>
              </div>
              <button onClick={() => setModalOpen(false)} className="text-bw-muted hover:text-bw-text" title="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-3 text-[13px]">
              <div className="flex items-center gap-3"><span className="w-16 text-bw-muted flex-shrink-0">To</span><span className="font-medium">{data.gcEmail}</span></div>
              <div className="flex items-center gap-3"><span className="w-16 text-bw-muted flex-shrink-0">Reply-to</span><span className="font-medium text-bw-green">{data.company.replyTo ?? "—"}</span></div>
              <div className="flex items-center gap-3">
                <span className="w-16 text-bw-muted flex-shrink-0">Subject</span>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} className="flex-1 border border-bw-border rounded-lg px-3 py-2 text-[14px] outline-none focus:border-bw-green focus:ring-2 focus:ring-bw-green-tint" />
              </div>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="w-full border border-bw-border rounded-lg px-3 py-3 text-[14px] leading-relaxed resize-y outline-none focus:border-bw-green focus:ring-2 focus:ring-bw-green-tint" />
              <label className="flex items-center gap-2.5 text-[13px] font-medium"><input type="checkbox" checked={ccMe} onChange={(e) => setCcMe(e.target.checked)} className="accent-bw-green w-4 h-4" /> Send me a copy</label>
              <div className="flex items-center justify-between rounded-xl bg-bw-surface border border-bw-border px-4 py-3">
                <span className="text-bw-body">{sv ? "Request" : "Total bid"}</span>
                <span className={`font-bold text-bw-green ${sv ? "" : "font-mono"}`}>{sv ? "Site visit · quote on measure" : usd(t.total)}</span>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-bw-border flex items-center justify-end gap-2">
              <button onClick={() => setModalOpen(false)} disabled={busy} className="bg-white text-bw-body font-semibold text-[14px] px-4 py-2 rounded-full border border-bw-border hover:bg-bw-surface">Back</button>
              <button onClick={onSend} disabled={busy} className="inline-flex items-center gap-1.5 bg-bw-green text-white font-semibold text-[14px] px-5 py-2 rounded-full hover:bg-bw-green-hover disabled:opacity-50">
                {busy ? "Sending…" : "Send bid"}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupRows({ group, editing, onChange }: { group: { location: string; items: BidLine[] }; editing: boolean; onChange: (id: string, patch: Partial<BidLine>) => void }) {
  return (
    <>
      <tr>
        <td colSpan={4} className="pt-4 pb-1">
          <div className="text-[11px] font-bold text-bw-text uppercase tracking-[0.12em]">{group.location}</div>
        </td>
      </tr>
      {group.items.map((l) => (
        <tr key={l.id}>
          <td className="py-3 align-top">
            <div className="font-medium">{l.description ?? l.typeCode}</div>
            {l.unit && <div className="text-[12px] text-bw-muted">{l.unit}</div>}
          </td>
          <td className="text-center align-top">
            {editing ? (
              <input type="number" value={l.qty} onChange={(e) => onChange(l.id, { qty: Number(e.target.value) })} className="w-14 font-mono text-center border border-bw-green/40 rounded px-1 py-0.5 outline-none focus:border-bw-green" />
            ) : (
              <span className="font-mono">{l.qty}</span>
            )}
          </td>
          <td className="text-right align-top">
            {editing ? (
              <input type="number" value={l.unitPrice} onChange={(e) => onChange(l.id, { unitPrice: Number(e.target.value) })} className="w-24 font-mono text-right border border-bw-green/40 rounded px-1 py-0.5 outline-none focus:border-bw-green" />
            ) : (
              <span className="font-mono">{l.unitPrice.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 })}</span>
            )}
          </td>
          <td className="text-right align-top font-mono font-semibold">
            {(l.qty * l.unitPrice).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 })}
          </td>
        </tr>
      ))}
    </>
  );
}

function FootRow({ label, value, border, green }: { label: string; value: string; border?: boolean; green?: boolean }) {
  return (
    <tr className={border ? "border-t-2 border-bw-border" : ""}>
      <td colSpan={3} className="py-1.5 text-right text-bw-body">{label}</td>
      <td className={`text-right font-mono ${green ? "text-bw-green" : ""}`}>{value}</td>
    </tr>
  );
}

function Row({ label, value, valueClass = "", mono }: { label: string; value: string; valueClass?: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-bw-body flex-shrink-0">{label}</span>
      <span className={`font-medium text-right truncate ${mono ? "font-mono" : ""} ${valueClass}`}>{value}</span>
    </div>
  );
}
