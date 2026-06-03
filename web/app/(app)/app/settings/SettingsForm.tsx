"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { saveSettings } from "./actions";

type BrandingForm = { companyName: string; website: string; address: string; description: string; replyToEmail: string };
type BoilerplateForm = { paymentTerms: string; warranty: string; validityDays: number | null; exclusions: string[]; disclaimer: string };

const field = "w-full rounded-lg border border-bw-border px-3 py-2.5 text-[14px] outline-none focus:border-bw-green focus:ring-2 focus:ring-bw-green-tint";

export function SettingsForm({ branding: b0, boilerplate: bp0 }: { branding: BrandingForm; boilerplate: BoilerplateForm }) {
  const router = useRouter();
  const [b, setB] = useState<BrandingForm>(b0);
  const [bp, setBp] = useState<BoilerplateForm>({ ...bp0, exclusions: bp0.exclusions.length ? bp0.exclusions : [""] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function setExcl(i: number, v: string) {
    setBp((p) => ({ ...p, exclusions: p.exclusions.map((x, j) => (j === i ? v : x)) }));
  }
  function addExcl() {
    setBp((p) => ({ ...p, exclusions: [...p.exclusions, ""] }));
  }
  function removeExcl(i: number) {
    setBp((p) => ({ ...p, exclusions: p.exclusions.filter((_, j) => j !== i) }));
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await saveSettings(
        { companyName: b.companyName, website: b.website || null, address: b.address || null, description: b.description || null, replyToEmail: b.replyToEmail || null },
        { paymentTerms: bp.paymentTerms || null, warranty: bp.warranty || null, validityDays: bp.validityDays, exclusions: bp.exclusions, disclaimer: bp.disclaimer || null },
      );
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[840px] mx-auto">
      <h1 className="text-[1.8rem] font-extrabold tracking-tight mb-1">Settings</h1>
      <p className="text-[14px] text-bw-body mb-8">This information brands every bid we generate for you.</p>

      <div className="space-y-6">
        {/* branding */}
        <Card className="p-6">
          <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-4">Company branding</div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[13px] font-medium mb-1.5">Company name</label>
              <input className={field} value={b.companyName} onChange={(e) => setB({ ...b, companyName: e.target.value })} />
            </div>
            <div>
              <label className="block text-[13px] font-medium mb-1.5">Website</label>
              <input className={field} value={b.website} onChange={(e) => setB({ ...b, website: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[13px] font-medium mb-1.5">Address</label>
              <input className={field} value={b.address} onChange={(e) => setB({ ...b, address: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[13px] font-medium mb-1.5">One-line description</label>
              <input className={field} value={b.description} onChange={(e) => setB({ ...b, description: e.target.value })} />
            </div>
          </div>
        </Card>

        {/* sending identity */}
        <Card className="p-6">
          <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-1">Sending identity</div>
          <p className="text-[13px] text-bw-body mb-4">How bids leave the platform. Replies route back to you — we never see them.</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[14px] font-medium">Reply-to address</div>
              <div className="text-[12px] text-bw-muted">GC replies land here</div>
            </div>
            <input className="w-72 rounded-lg border border-bw-border px-3 py-2 text-[14px] outline-none focus:border-bw-green focus:ring-2 focus:ring-bw-green-tint" value={b.replyToEmail} onChange={(e) => setB({ ...b, replyToEmail: e.target.value })} />
          </div>
        </Card>

        {/* boilerplate */}
        <Card className="p-6">
          <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-1">Proposal boilerplate</div>
          <p className="text-[13px] text-bw-body mb-5">The standing text on every bid we generate. <a href="/app/onboarding" className="text-bw-green font-semibold">Edit full pricing model →</a></p>

          <div className="grid sm:grid-cols-3 gap-4 mb-6">
            <div>
              <label className="block text-[13px] font-medium mb-1.5">Payment terms</label>
              <input className={field} value={bp.paymentTerms} onChange={(e) => setBp({ ...bp, paymentTerms: e.target.value })} />
            </div>
            <div>
              <label className="block text-[13px] font-medium mb-1.5">Warranty</label>
              <input className={field} value={bp.warranty} onChange={(e) => setBp({ ...bp, warranty: e.target.value })} />
            </div>
            <div>
              <label className="block text-[13px] font-medium mb-1.5">Quote valid (days)</label>
              <input type="number" className={field} value={bp.validityDays ?? ""} onChange={(e) => setBp({ ...bp, validityDays: e.target.value === "" ? null : Number(e.target.value) })} />
            </div>
          </div>

          <div className="border-t border-bw-border pt-5 mb-6">
            <label className="block text-[13px] font-medium mb-1.5">Standard exclusions</label>
            <p className="text-[12px] text-bw-muted mb-3">Listed on every proposal so scope is clear.</p>
            <div className="space-y-2">
              {bp.exclusions.map((x, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className="flex-1 rounded-lg border border-bw-border px-3 py-2 text-[14px] outline-none focus:border-bw-green focus:ring-2 focus:ring-bw-green-tint" value={x} placeholder="New exclusion…" onChange={(e) => setExcl(i, e.target.value)} />
                  <button type="button" onClick={() => removeExcl(i)} className="w-9 h-9 rounded-lg border border-bw-border text-bw-muted hover:text-bw-text hover:bg-bw-surface flex items-center justify-center flex-shrink-0" aria-label="Remove">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addExcl} className="mt-3 text-[13px] text-bw-green font-semibold">+ Add exclusion</button>
          </div>

          <div className="border-t border-bw-border pt-5">
            <label className="block text-[13px] font-medium mb-1.5">Disclaimer &amp; standard notes</label>
            <p className="text-[12px] text-bw-muted mb-3">Appended to the bottom of every proposal.</p>
            <textarea rows={4} className="w-full rounded-lg border border-bw-border px-3 py-2.5 text-[14px] leading-relaxed resize-y outline-none focus:border-bw-green focus:ring-2 focus:ring-bw-green-tint" value={bp.disclaimer} onChange={(e) => setBp({ ...bp, disclaimer: e.target.value })} />
          </div>
        </Card>

        <div className="flex items-center justify-end gap-3 pt-2">
          {error && <span className="text-[13px] text-bw-red mr-auto">{error}</span>}
          {saved && <span className="text-[13px] text-bw-green mr-auto">Saved.</span>}
          <Button onClick={onSave} disabled={busy}>{busy ? "Saving…" : "Save settings"}</Button>
        </div>
      </div>
    </div>
  );
}
