"use client";

import { useEffect, useMemo, useState } from "react";
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

export type ProposalSection = {
  bidId: string;
  tradeLabel: string;
  kind: string; // 'priced' | 'site_visit'
  discountPct: number;
  discountLabel: string | null;
  deliveryInstall: number;
  taxRate: number;
  notesToGc: string | null;
  lines: BidLine[];
};

export type ProposalData = {
  groupId: string; // representative bid id (the URL)
  status: string; // group: draft | ready | sent
  projectName: string | null;
  gcName: string | null;
  gcEmail: string | null;
  bidDue: string | null;
  sentAt: string | null;
  company: { name: string; replyTo: string | null; website: string | null; address: string | null };
  boilerplate: { paymentTerms: string | null; warranty: string | null; validityDays: number | null; exclusions: string[]; disclaimer: string | null };
  sections: ProposalSection[];
};

const DEFAULT_EXCLUSIONS = [
  "Work outside the documented scope",
  "Structural blocking, backing, and substrate repair",
  "Permits, filing, and controlled inspections",
];

const r2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

function sectionTotals(s: ProposalSection) {
  const products = r2(s.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0));
  const discount = -Math.round(products * s.discountPct);
  const subtotal = r2(products + discount + s.deliveryInstall);
  const tax = r2(subtotal * s.taxRate);
  const total = r2(subtotal + tax);
  return { products, discount, subtotal, tax, total };
}

function groupByLocation(lines: BidLine[]) {
  const groups: { location: string; items: BidLine[] }[] = [];
  for (const l of lines) {
    const loc = l.location ?? "General";
    let g = groups.find((x) => x.location === loc);
    if (!g) { g = { location: loc, items: [] }; groups.push(g); }
    g.items.push(l);
  }
  return groups;
}

export function BidReview({ data }: { data: ProposalData }) {
  const router = useRouter();
  const sent = data.status === "sent";

  const [sections, setSections] = useState<ProposalSection[]>(data.sections);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  const multi = sections.length > 1;
  const totals = useMemo(() => sections.map(sectionTotals), [sections]);
  const proposalTotal = useMemo(() => totals.reduce((a, t, i) => a + (sections[i].kind === "site_visit" ? 0 : t.total), 0), [totals, sections]);
  const allSiteVisit = sections.every((s) => s.kind === "site_visit");

  const [subject, setSubject] = useState(
    allSiteVisit ? `${data.projectName ?? "Your project"} — site visit · ${data.company.name}` : `Proposal — ${data.projectName ?? "your project"} · ${data.company.name}`,
  );
  const [body, setBody] = useState(
    allSiteVisit
      ? `Hi ${data.gcName ?? "there"},\n\nWe reviewed the documents for ${data.projectName ?? "this project"} and saw our scope, but the set doesn't include a dimensioned schedule — so rather than guess we'd like a quick field measure and will send an accurate, itemized quote.\n\nWe work right in your area and can turn this around fast — just reply to set up a visit.\n\nBest,\n${data.company.name}`
      : `Hi ${data.gcName ?? "there"},\n\nThank you for the opportunity to bid ${data.projectName ?? "this project"}. Our proposal${multi ? " (all sections below)" : ""} is attached.\n\nHappy to walk through anything or adjust scope — just reply to this email and it comes straight to me.\n\nBest,\n${data.company.name}`,
  );
  const [ccMe, setCcMe] = useState(true);

  const patchSection = (bidId: string, fn: (s: ProposalSection) => ProposalSection) => setSections((prev) => prev.map((s) => (s.bidId === bidId ? fn(s) : s)));
  const setLine = (bidId: string) => (id: string, patch: Partial<BidLine>) => patchSection(bidId, (s) => ({ ...s, lines: s.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const removeLine = (bidId: string) => (id: string) => patchSection(bidId, (s) => ({ ...s, lines: s.lines.filter((l) => l.id !== id) }));
  const removeLocation = (bidId: string) => (loc: string) => patchSection(bidId, (s) => ({ ...s, lines: s.lines.filter((l) => (l.location ?? "General") !== loc) }));

  async function onSave() {
    setBusy(true);
    setError(null);
    try {
      let learned = 0;
      for (const s of sections) {
        const payload: LineInput[] = s.lines.map((l) => ({ id: l.id, location: l.location, description: l.description, qty: l.qty, unitPrice: l.unitPrice }));
        const r = await saveBidEdits(s.bidId, payload, s.discountPct, s.deliveryInstall);
        learned += r?.learned ?? 0;
      }
      setEditing(false);
      setNotice(learned > 0 ? `Saved — added ${learned} product${learned === 1 ? "" : "s"} to your pricing for next time.` : "Saved.");
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
      await approveAndSend(data.groupId, { subject, body, ccMe });
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
        <h1 className="text-[1.7rem] font-extrabold tracking-tight mb-2">{allSiteVisit ? "Visit request sent" : "Proposal sent"}{data.gcName ? ` to ${data.gcName}` : ""}.</h1>
        <p className="text-[14px] text-bw-body mb-8">Your {allSiteVisit ? "site-visit request" : "proposal"} for <span className="font-semibold text-bw-text">{data.projectName}</span> is on its way.</p>
        <div className="bg-white rounded-2xl border border-bw-border p-6 text-left mb-6">
          <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-4">Delivery receipt</div>
          <div className="space-y-3 text-[14px]">
            <Row label="Sent to" value={`${data.gcName ?? ""} · ${data.gcEmail ?? ""}`} />
            <Row label="Reply-to" value={data.company.replyTo ?? "—"} valueClass="text-bw-green" />
            {allSiteVisit ? <Row label="Request" value="Site visit · quote on measure" /> : <Row label="Bid value" value={usd(proposalTotal)} mono />}
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
            <div className="font-semibold truncate">{data.projectName ?? "Proposal"}</div>
            <div className="text-[12px] text-bw-muted truncate">
              {[data.gcName, multi ? `${sections.length} sections` : null, data.bidDue ? `due ${data.bidDue}` : null].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button onClick={() => { setSections(data.sections); setEditing(false); }} disabled={busy} className="bg-white text-bw-body font-semibold text-[13px] px-4 py-2 rounded-full border border-bw-border hover:bg-bw-surface">Cancel</button>
              <button onClick={onSave} disabled={busy} className="bg-bw-text text-white font-semibold text-[13px] px-5 py-2 rounded-full hover:bg-bw-green disabled:opacity-50">{busy ? "Saving…" : "Save changes"}</button>
            </>
          ) : (
            <>
              {!allSiteVisit && (
                <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 bg-white text-bw-text font-semibold text-[13px] px-4 py-2 rounded-full border border-bw-border hover:bg-bw-green-tint">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
                  Edit
                </button>
              )}
              <button onClick={() => setModalOpen(true)} className="inline-flex items-center gap-1.5 bg-bw-green text-white font-semibold text-[13px] px-5 py-2 rounded-full hover:bg-bw-green-hover">
                {allSiteVisit ? "Approve & send request" : "Approve & send"}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="text-[13px] text-bw-red mb-4">{error}</p>}

      <div className="grid lg:grid-cols-3 gap-8 items-start">
        {/* LEFT — the proposal document */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-bw-border shadow-sm overflow-hidden">
          <div className="px-8 pt-8 pb-6 border-b border-bw-border flex items-start justify-between">
            <div>
              <div className="font-black text-[22px] tracking-tight leading-none">{data.company.name}</div>
              <div className="text-[12px] text-bw-muted mt-1.5">{[data.company.address, data.company.website].filter(Boolean).join(" · ") || "Commercial subcontractor"}</div>
            </div>
            <div className="text-right text-[12px] text-bw-muted font-mono">
              <div>PROPOSAL</div>
              <div>{data.groupId.slice(0, 8).toUpperCase()}</div>
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

            {sections.map((s, i) => {
              const t = totals[i];
              const sv = s.kind === "site_visit";
              return (
                <div key={s.bidId}>
                  {multi && <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-3 pt-2 border-t border-bw-border">{s.tradeLabel}</div>}
                  {sv ? (
                    <div>
                      {s.notesToGc && <p className="text-[14px] text-bw-body leading-relaxed mb-3">{s.notesToGc}</p>}
                      <div className="rounded-xl bg-bw-green-tint/50 border border-bw-green-tint-2 px-4 py-3 text-[13px] text-bw-body">
                        <span className="font-semibold text-bw-green-deep">Site visit requested.</span> The set names this scope but has no dimensioned schedule, so we&apos;ll field-measure and send an accurate, itemized quote — rather than guess a number.
                      </div>
                    </div>
                  ) : (
                    <table className="w-full text-[13px]">
                      {!multi && (
                        <caption className="text-left text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-3">Pricing</caption>
                      )}
                      <thead>
                        <tr className="text-[11px] text-bw-muted uppercase tracking-wider border-b border-bw-border">
                          <th className="text-left font-semibold py-2">Location · item</th>
                          <th className="text-center font-semibold py-2 w-16">Qty</th>
                          <th className="text-right font-semibold py-2 w-28">Unit</th>
                          <th className="text-right font-semibold py-2 w-28">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-bw-border">
                        {groupByLocation(s.lines).map((g) => (
                          <GroupRows key={g.location} group={g} editing={editing} onChange={setLine(s.bidId)} onRemove={removeLine(s.bidId)} onRemoveGroup={removeLocation(s.bidId)} />
                        ))}
                      </tbody>
                      <tfoot>
                        <FootRow label="Subtotal" value={usd(t.products)} border />
                        {editing ? (
                          <tr>
                            <td colSpan={3} className="py-1.5 text-right text-bw-body">
                              <span className="inline-flex items-center gap-1.5 justify-end">
                                Discount
                                <input type="number" value={Math.round(s.discountPct * 1000) / 10} onChange={(e) => patchSection(s.bidId, (x) => ({ ...x, discountPct: (Number(e.target.value) || 0) / 100 }))} className="w-16 font-mono text-right border border-bw-green/40 rounded px-1 py-0.5 outline-none focus:border-bw-green" />%
                              </span>
                            </td>
                            <td className="text-right font-mono text-bw-green">−{usd(Math.abs(t.discount))}</td>
                          </tr>
                        ) : (
                          t.discount !== 0 && <FootRow label={`Discount (${Math.round(s.discountPct * 100)}%)`} value={`−${usd(Math.abs(t.discount))}`} green />
                        )}
                        {editing ? (
                          <tr>
                            <td colSpan={3} className="py-1.5 text-right text-bw-body">
                              <span className="inline-flex items-center gap-1.5 justify-end">
                                Delivery &amp; install <span className="text-bw-muted">$</span>
                                <input type="number" value={s.deliveryInstall} onChange={(e) => patchSection(s.bidId, (x) => ({ ...x, deliveryInstall: Number(e.target.value) || 0 }))} className="w-24 font-mono text-right border border-bw-green/40 rounded px-1 py-0.5 outline-none focus:border-bw-green" />
                              </span>
                            </td>
                            <td className="text-right font-mono">{usd(s.deliveryInstall)}</td>
                          </tr>
                        ) : (
                          <FootRow label="Delivery & install" value={usd(s.deliveryInstall)} />
                        )}
                        <FootRow label={`Tax (${(s.taxRate * 100).toFixed(3).replace(/\.?0+$/, "")}%)`} value={usd(t.tax)} />
                        <tr className="border-t border-bw-border">
                          <td colSpan={3} className="py-2.5 text-right font-semibold text-[15px]">{multi ? `${s.tradeLabel} total` : "Total bid"}</td>
                          <td className="text-right font-mono font-bold text-[15px] text-bw-green">{usd(t.total)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              );
            })}

            {multi && !allSiteVisit && (
              <div className="flex items-center justify-between border-t-2 border-bw-text pt-3">
                <span className="font-extrabold text-[16px]">Proposal total</span>
                <span className="font-mono font-extrabold text-[16px] text-bw-green">{usd(proposalTotal)}</span>
              </div>
            )}

            <div>
              <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-2">Exclusions</div>
              <ul className="text-[13px] text-bw-body space-y-1 list-disc pl-5">
                {(data.boilerplate.exclusions.length ? data.boilerplate.exclusions : DEFAULT_EXCLUSIONS).map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </div>

            <div className="grid sm:grid-cols-2 gap-4 text-[13px] pt-2 border-t border-bw-border">
              <div>
                <div className="text-[11px] font-semibold text-bw-muted uppercase tracking-wider mb-1">Terms</div>
                <div className="text-bw-body">{data.boilerplate.paymentTerms ?? "50% deposit, 50% on completion."}{data.boilerplate.validityDays ? ` Valid ${data.boilerplate.validityDays} days.` : ""}</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-bw-muted uppercase tracking-wider mb-1">Warranty</div>
                <div className="text-bw-body">{data.boilerplate.warranty ?? "2 years labor · manufacturer warranty on product"}</div>
              </div>
            </div>

            {data.boilerplate.disclaimer && <p className="text-[11px] text-bw-muted leading-relaxed pt-2 border-t border-bw-border">{data.boilerplate.disclaimer}</p>}
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
            <div className="mt-4 p-3 rounded-xl bg-bw-green-tint/60 text-[12px] text-bw-body leading-snug">When the GC replies, it lands in <span className="font-semibold text-bw-text">your inbox</span> — not ours.</div>
            <button onClick={() => setModalOpen(true)} className="mt-4 w-full inline-flex items-center justify-center gap-2 bg-bw-green text-white font-semibold text-[14px] px-5 py-3 rounded-full hover:bg-bw-green-hover">
              {allSiteVisit ? "Approve & send request" : "Approve & send proposal"}
            </button>
            {!allSiteVisit && <button onClick={() => setEditing(true)} className="mt-2 w-full text-[13px] font-semibold text-bw-body hover:text-bw-text py-2">Edit proposal first</button>}
          </div>

          {allSiteVisit ? (
            <div className="bg-white rounded-2xl border border-bw-border p-6">
              <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-2">No price yet</div>
              <p className="text-[13px] text-bw-body leading-snug">This is a <span className="font-semibold text-bw-text">site-visit request</span>, not a priced proposal. We field-measure first, then send an accurate itemized quote.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-bw-border p-6">
              <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-4">Proposal total</div>
              <div className="space-y-2.5 text-[13px]">
                {sections.map((s, i) => (
                  <div key={s.bidId} className="flex justify-between">
                    <span className="text-bw-body truncate pr-2">{s.tradeLabel}</span>
                    <span className="font-mono flex-shrink-0">{s.kind === "site_visit" ? "site visit" : usd(totals[i].total)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-bw-border pt-2.5"><span className="font-semibold">Total</span><span className="font-mono font-bold text-bw-green">{usd(proposalTotal)}</span></div>
              </div>
              {editing && <p className="text-[11px] text-bw-muted mt-3">Adjust quantities, prices, discount &amp; install above — the total updates live.</p>}
            </div>
          )}
        </div>
      </div>

      {/* save confirmation toast (Pillar-3 learning feedback) */}
      {notice && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] bg-bw-text text-white text-[13px] font-medium px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7CD64F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          {notice}
        </div>
      )}

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
                <span className="text-bw-body">{allSiteVisit ? "Request" : "Proposal total"}</span>
                <span className={`font-bold text-bw-green ${allSiteVisit ? "" : "font-mono"}`}>{allSiteVisit ? "Site visit · quote on measure" : usd(proposalTotal)}</span>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-bw-border flex items-center justify-end gap-2">
              <button onClick={() => setModalOpen(false)} disabled={busy} className="bg-white text-bw-body font-semibold text-[14px] px-4 py-2 rounded-full border border-bw-border hover:bg-bw-surface">Back</button>
              <button onClick={onSend} disabled={busy} className="inline-flex items-center gap-1.5 bg-bw-green text-white font-semibold text-[14px] px-5 py-2 rounded-full hover:bg-bw-green-hover disabled:opacity-50">
                {busy ? "Sending…" : "Send proposal"}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Amber "?" beside a flagged price — tells the sub the system learns from what they
 *  set here (Pillar-3 nudge: pricing the line trains their engine for next time). */
function LearnInfo() {
  return (
    <span className="relative group inline-flex align-middle">
      <span className="w-[15px] h-[15px] rounded-full bg-bw-amber/20 text-bw-amber text-[10px] font-bold flex items-center justify-center cursor-help select-none">?</span>
      <span className="pointer-events-none absolute right-0 bottom-full mb-2 w-60 rounded-lg bg-bw-text text-white text-[12px] leading-snug px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-lg text-left font-normal normal-case tracking-normal">
        Set your price once — BidWork learns it and auto-prices this product on your future bids. The more you fill in, the smarter and faster your bids get.
      </span>
    </span>
  );
}

function GroupRows({ group, editing, onChange, onRemove, onRemoveGroup }: { group: { location: string; items: BidLine[] }; editing: boolean; onChange: (id: string, patch: Partial<BidLine>) => void; onRemove: (id: string) => void; onRemoveGroup: (location: string) => void }) {
  return (
    <>
      <tr>
        <td colSpan={4} className="pt-4 pb-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-bold text-bw-text uppercase tracking-[0.12em]">{group.location}</div>
            {editing && <button type="button" onClick={() => onRemoveGroup(group.location)} className="text-[11px] font-semibold text-bw-red hover:underline">Remove section</button>}
          </div>
        </td>
      </tr>
      {group.items.map((l) => {
        const flagged = (l.attrs as { unpriced?: boolean })?.unpriced;
        return (
          <tr key={l.id}>
            <td className="py-3 align-top">
              {editing ? (
                <div className="flex items-start gap-2">
                  <textarea value={l.description ?? ""} onChange={(e) => onChange(l.id, { description: e.target.value })} rows={2} className="flex-1 text-[13px] border border-bw-green/40 rounded px-1.5 py-1 resize-y outline-none focus:border-bw-green" />
                  <button type="button" onClick={() => onRemove(l.id)} title="Remove line" className="w-7 h-7 flex-shrink-0 rounded border border-bw-border text-bw-muted hover:text-bw-red hover:border-bw-red/50 flex items-center justify-center">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                </div>
              ) : (
                <>
                  <div className="font-medium">{l.description ?? l.typeCode}</div>
                  {l.unit && <div className="text-[12px] text-bw-muted">{l.unit}</div>}
                </>
              )}
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
                <div className="inline-flex items-center justify-end gap-1">
                  <input type="number" value={l.unitPrice || ""} placeholder={flagged ? "your price" : undefined} onChange={(e) => onChange(l.id, { unitPrice: Number(e.target.value) })} className={`w-24 font-mono text-right rounded px-1 py-0.5 outline-none ${flagged ? "border-2 border-bw-amber bg-bw-amber-tint/40 placeholder:text-bw-amber/70 focus:border-bw-amber" : "border border-bw-green/40 focus:border-bw-green"}`} />
                  {flagged && <LearnInfo />}
                </div>
              ) : flagged ? (
                <span className="inline-flex items-center justify-end gap-1 font-medium text-bw-amber">needs your price<LearnInfo /></span>
              ) : (
                <span className="font-mono">{l.unitPrice.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 })}</span>
              )}
            </td>
            <td className="text-right align-top font-mono font-semibold">{(l.qty * l.unitPrice).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 })}</td>
          </tr>
        );
      })}
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
