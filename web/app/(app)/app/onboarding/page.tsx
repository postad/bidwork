"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GlobalChargesEditor } from "@/components/GlobalChargesEditor";
import {
  createOnboardingUploads,
  startPricingExtraction,
  getPendingDna,
  getOnboardingContext,
  confirmWtPricingDna,
  confirmFlooringPricingDna,
  skipOnboarding,
  type ConfirmWtDna,
  type ConfirmFlooringDna,
} from "./actions";

type Step = 1 | 2;
type Tier = "small" | "standard" | "large";

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Which category this contractor is training (drives the wizard copy + step 2 shape).
  const [category, setCategory] = useState<string | null>(null);
  const [categoryLabel, setCategoryLabel] = useState<string>("");
  const [subTrades, setSubTrades] = useState<{ slug: string; label: string }[]>([]);
  const isFlooring = category === "flooring";

  useEffect(() => {
    let active = true;
    getOnboardingContext()
      .then((ctx) => {
        if (!active) return;
        setCategory(ctx.category ?? "window-treatments");
        setCategoryLabel(ctx.categoryLabel ?? "Window Treatments");
        setSubTrades(ctx.subTrades);
      })
      .catch(() => {
        if (active) setCategory("window-treatments");
      });
    return () => {
      active = false;
    };
  }, []);

  // ---------- Step 1: upload ----------
  const [files, setFiles] = useState<File[]>([]);
  async function onUpload() {
    if (!files.length || !category) return;
    setBusy(true);
    setError(null);
    try {
      setStatus("Preparing upload…");
      const { uploads } = await createOnboardingUploads(undefined, files.map((f) => ({ name: f.name })));
      for (let i = 0; i < files.length; i++) {
        setStatus(`Uploading ${i + 1}/${files.length}…`);
        const { error } = await supabase.storage.from("bid-docs").uploadToSignedUrl(uploads[i].path, uploads[i].token, files[i]);
        if (error) throw error;
      }
      setStatus("Reading your proposals…");
      await startPricingExtraction(uploads.map((u) => u.path), category);
      setStep(2);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  // No past proposals → seed a starter card and go straight to Settings to fill prices.
  async function onSkip() {
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      await skipOnboarding(category);
      router.push("/app/settings/pricing");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  // ---------- Step 2: poll + confirm DNA ----------
  const [dnaStatus, setDnaStatus] = useState<"extracting" | "ready" | "error" | null>(null);
  const [dna, setDna] = useState<ConfirmWtDna | null>(null);
  const [floorDna, setFloorDna] = useState<ConfirmFlooringDna | null>(null);
  const polling = useRef(false);

  useEffect(() => {
    if (step !== 2 || polling.current) return;
    polling.current = true;
    let active = true;
    const tick = async () => {
      try {
        const p = await getPendingDna();
        if (!active || !p) return;
        const s = p.status as "extracting" | "ready" | "error";
        setDnaStatus(s);
        if (s === "ready") {
          if (isFlooring) {
            setFloorDna((prev) =>
              prev ?? {
                systems: ((p.systems as { name: string; perSqft: number }[]) ?? []).map((x) => ({ name: x.name, perSqft: x.perSqft })),
                prepPerSqft: (p.prepPerSqft as number) ?? null,
                baseTrimPerLf: (p.baseTrimPerLf as number) ?? null,
                globalCharges: ((p.globalCharges as { label: string; amount: number; kind?: "flat" | "percent" }[]) ?? []).map((c) => ({ label: c.label, amount: c.amount, kind: c.kind === "percent" ? ("percent" as const) : ("flat" as const) })),
                discountPct: (p.discountPct as number) ?? null,
                taxPct: (p.taxPct as number) ?? null,
                paymentTerms: (p.paymentTerms as string) ?? null,
                warranty: (p.warranty as string) ?? null,
                validityDays: (p.validityDays as number) ?? null,
                exclusions: (p.exclusions as string[]) ?? [],
              },
            );
          } else {
            const num = (k: string) => (p[k] as number) ?? null;
            setDna((prev) =>
              prev ?? {
                products: ((p.products as { name: string; priceStandard: number; priceSmall: number | null; priceLarge: number | null }[]) ?? []).map((x) => ({
                  name: x.name,
                  prices: { small: x.priceSmall ?? null, standard: x.priceStandard, large: x.priceLarge ?? null },
                })),
                buckets: {
                  small: { maxW: num("smallMaxW"), maxH: num("smallMaxH") },
                  standard: { maxW: num("standardMaxW"), maxH: num("standardMaxH") },
                  large: { maxW: num("largeMaxW"), maxH: num("largeMaxH") },
                },
                globalCharges: ((p.globalCharges as { label: string; amount: number; kind?: "flat" | "percent" }[]) ?? []).map((c) => ({ label: c.label, amount: c.amount, kind: c.kind === "percent" ? ("percent" as const) : ("flat" as const) })),
                discountPct: num("discountPct"),
                taxPct: num("taxPct"),
                paymentTerms: (p.paymentTerms as string) ?? null,
                warranty: (p.warranty as string) ?? null,
                validityDays: num("validityDays"),
                exclusions: (p.exclusions as string[]) ?? [],
              },
            );
          }
        }
        if (s === "error") setError((p.error as string) ?? "Extraction failed");
      } catch {
        /* keep polling */
      }
    };
    tick();
    const iv = setInterval(() => void tick(), 3000);
    return () => {
      active = false;
      polling.current = false;
      clearInterval(iv);
    };
  }, [step, isFlooring]);

  async function onConfirmDna() {
    setBusy(true);
    setError(null);
    try {
      if (isFlooring) {
        if (!floorDna) return;
        await confirmFlooringPricingDna(floorDna);
      } else {
        if (!dna) return;
        await confirmWtPricingDna(dna);
      }
      // Confirm = finish — the inert ops step is gone; go straight to the dashboard.
      router.push("/app");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function setProdPrice(i: number, tier: Tier, v: string) {
    const n = v === "" ? null : Number(v);
    setDna((d) => (d ? { ...d, products: d.products.map((p, j) => (j === i ? { ...p, prices: { ...p.prices, [tier]: tier === "standard" ? (n ?? 0) : n } } : p)) } : d));
  }
  function setBucket(tier: Tier, dim: "maxW" | "maxH", v: string) {
    const n = v === "" ? null : Number(v);
    setDna((d) => (d ? { ...d, buckets: { ...d.buckets, [tier]: { ...d.buckets[tier], [dim]: n } } } : d));
  }
  function setSys(i: number, perSqft: number) {
    setFloorDna((d) => (d ? { ...d, systems: d.systems.map((s, j) => (j === i ? { ...s, perSqft } : s)) } : d));
  }

  return (
    <div className="max-w-[760px] mx-auto">
      {/* step rail */}
      <div className="flex items-center gap-2 mb-8 text-[12px] font-medium">
        {([[1, "Show us your bids"], [2, "Confirm what we read"]] as const).map(([n, label], i) => (
          <div key={n} className="flex items-center gap-2 flex-1">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold ${step >= n ? "bg-bw-green text-white" : "bg-bw-border text-bw-body"}`}>{n}</span>
            <span className={step >= n ? "text-bw-text" : "text-bw-muted"}>{label}</span>
            {i < 1 && <span className="flex-1 h-px bg-bw-border" />}
          </div>
        ))}
      </div>

      <div className="flex items-start gap-3 bg-white border border-bw-border rounded-2xl px-5 py-4 mb-7">
        <div className="w-9 h-9 rounded-xl bg-bw-green-tint flex items-center justify-center flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#14A800" strokeWidth="2.2"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
        </div>
        <div>
          <div className="font-semibold text-[14px]">Your pricing is private.</div>
          <p className="text-[13px] text-bw-body leading-snug">Encrypted and yours alone — never shared with GCs, never shown to other contractors. We learn how <span className="font-medium text-bw-text">you</span> price, for <span className="font-medium text-bw-text">you</span>.</p>
        </div>
      </div>

      {error && <p className="text-[13px] text-bw-red mb-4">{error}</p>}

      {step === 1 && (
        <div>
          <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-3">
            {categoryLabel || "Loading…"} · base pricing
            {subTrades.length > 0 && <span className="text-bw-muted normal-case tracking-normal font-normal"> — {subTrades.map((t) => t.label).join(", ")}</span>}
          </div>
          <h1 className="text-[1.8rem] font-extrabold tracking-tight mb-2">Show us how you bid.</h1>
          <p className="text-[15px] text-bw-body mb-6 max-w-[56ch]">Drop in 2–3 recent proposals. We&apos;ll read them and recover your {isFlooring ? "systems, per-SF rates" : "products, prices"}, exclusions, and terms — you confirm everything next.</p>
          <Card className="p-6">
            <input type="file" accept="application/pdf" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="block w-full text-[13px]" />
            {files.length > 0 && (
              <ul className="mt-3 space-y-1 text-[13px] text-bw-body">
                {files.map((f) => (
                  <li key={f.name} className="flex justify-between"><span>{f.name}</span><span className="font-mono text-bw-muted">{(f.size / 1048576).toFixed(1)} MB</span></li>
                ))}
              </ul>
            )}
          </Card>
          <div className="flex items-center gap-3 mt-5">
            <Button onClick={onUpload} disabled={busy || !files.length || !category}>{busy ? "Working…" : "Upload & read my bids"}</Button>
            {status && <span className="text-[13px] text-bw-body">{status}</span>}
          </div>
          <button onClick={onSkip} disabled={busy || !category} className="text-[13px] text-bw-body hover:text-bw-text underline mt-4">
            I don&apos;t have past proposals — skip and set my prices myself
          </button>
        </div>
      )}

      {step === 2 && (
        <div>
          <h1 className="text-[1.8rem] font-extrabold tracking-tight mb-2">Here&apos;s your pricing DNA.</h1>
          <p className="text-[15px] text-bw-body mb-6 max-w-[56ch]">What we learned from your own bids. Confirm what&apos;s right, fix what&apos;s not. Every number is a <span className="font-medium text-bw-text">charged price</span> — we never ask cost or margin.</p>

          {dnaStatus !== "ready" || (isFlooring ? !floorDna : !dna) ? (
            dnaStatus === "error" ? (
              <Card className="p-8 text-center">
                <div className="inline-flex items-center gap-3 text-[14px] font-semibold text-bw-red">
                  <span className="w-2 h-2 rounded-full bg-bw-red" />
                  Extraction failed — go back and try again.
                </div>
              </Card>
            ) : (
              <ReadingProposals flooring={isFlooring} />
            )
          ) : isFlooring && floorDna ? (
            <div className="space-y-4">
              <Card className="p-6">
                <div className="font-semibold mb-3">Floor systems — charged price per square foot</div>
                {floorDna.systems.length === 0 && <p className="text-[13px] text-bw-muted">None found — add your systems in Settings later.</p>}
                <div className="space-y-2">
                  {floorDna.systems.map((s, i) => (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <span className="text-[14px]">{s.name}</span>
                      <div className="flex items-center gap-1"><span className="text-bw-muted">$</span><input type="number" step="0.01" value={s.perSqft} onChange={(e) => setSys(i, Number(e.target.value))} className="w-28 font-mono text-right border border-bw-border rounded-lg px-2 py-1.5 text-[14px]" /><span className="text-bw-muted text-[12px]">/SF</span></div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-6">
                <GlobalChargesEditor charges={floorDna.globalCharges} onChange={(g) => setFloorDna((d) => (d ? { ...d, globalCharges: g } : d))} />
              </Card>

              <div className="grid sm:grid-cols-2 gap-4">
                <Card className="p-6 space-y-3">
                  <DnaNum label="Substrate prep" suffix="/SF" value={floorDna.prepPerSqft} onChange={(v) => setFloorDna((d) => (d ? { ...d, prepPerSqft: v } : d))} />
                  <DnaNum label="Base / trim" suffix="/LF" value={floorDna.baseTrimPerLf} onChange={(v) => setFloorDna((d) => (d ? { ...d, baseTrimPerLf: v } : d))} />
                </Card>
                <Card className="p-6 space-y-3">
                  <DnaNum label="Default discount" suffix="%" value={floorDna.discountPct} onChange={(v) => setFloorDna((d) => (d ? { ...d, discountPct: v } : d))} />
                  <DnaNum label="Sales tax" suffix="%" value={floorDna.taxPct} onChange={(v) => setFloorDna((d) => (d ? { ...d, taxPct: v } : d))} />
                </Card>
              </div>

              {floorDna.exclusions.length > 0 && (
                <Card className="p-6">
                  <div className="font-semibold mb-1">Your standard exclusions</div>
                  <div className="text-[12px] text-bw-muted mb-3">Pulled from your proposals — reused on every generated bid</div>
                  <ul className="text-[13px] text-bw-body space-y-1 list-disc pl-5">
                    {floorDna.exclusions.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                </Card>
              )}

              <div className="flex items-center justify-between pt-2">
                <button onClick={() => setStep(1)} className="text-[14px] font-semibold text-bw-body hover:text-bw-text">Back</button>
                <Button onClick={onConfirmDna} disabled={busy}>{busy ? "Saving…" : "Looks right — continue"}</Button>
              </div>
            </div>
          ) : dna ? (
            <div className="space-y-4">
              {/* Size buckets — set once, shared by every product */}
              <Card className="p-6">
                <div className="font-semibold mb-1">Your size buckets</div>
                <div className="text-[12px] text-bw-muted mb-3">Define Small / Standard / Large once (window W×H). Bids price at <span className="font-medium text-bw-text">Standard</span> unless the documents give a size.</div>
                <div className="space-y-2">
                  {(["small", "standard", "large"] as const).map((tier) => (
                    <div key={tier} className="flex items-center gap-2 text-[13px]">
                      <span className="w-32 capitalize">{tier}{tier === "standard" && <span className="text-bw-muted text-[11px]"> · default</span>}</span>
                      <span className="text-bw-muted text-[12px]">up to</span>
                      <input type="number" value={dna.buckets[tier].maxW ?? ""} onChange={(e) => setBucket(tier, "maxW", e.target.value)} placeholder="W" className="w-16 font-mono text-right border border-bw-border rounded-lg px-2 py-1.5" />
                      <span className="text-bw-muted text-[12px]">&quot;W ×</span>
                      <input type="number" value={dna.buckets[tier].maxH ?? ""} onChange={(e) => setBucket(tier, "maxH", e.target.value)} placeholder="H" className="w-16 font-mono text-right border border-bw-border rounded-lg px-2 py-1.5" />
                      <span className="text-bw-muted text-[12px]">&quot;H</span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Products — one row each, three tier prices */}
              <Card className="p-6">
                <div className="font-semibold mb-1">Shade products — price each, by size</div>
                <div className="text-[12px] text-bw-muted mb-3">Only <span className="font-medium text-bw-text">Standard</span> is required; Small / Large are optional.</div>
                {dna.products.length === 0 && <p className="text-[13px] text-bw-muted">None found — add your products in Settings later.</p>}
                {dna.products.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[11px] text-bw-muted font-semibold">
                      <span className="flex-1">Product</span><span className="w-[68px] text-right">Small</span><span className="w-[68px] text-right">Standard</span><span className="w-[68px] text-right">Large</span>
                    </div>
                    {dna.products.map((p, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[14px] flex-1">{p.name}</span>
                        <input type="number" step="0.01" value={p.prices.small ?? ""} onChange={(e) => setProdPrice(i, "small", e.target.value)} placeholder="—" className="w-[68px] font-mono text-right border border-bw-border rounded-lg px-2 py-1.5 text-[13px]" />
                        <input type="number" step="0.01" value={p.prices.standard || ""} onChange={(e) => setProdPrice(i, "standard", e.target.value)} className="w-[68px] font-mono text-right border border-bw-border rounded-lg px-2 py-1.5 text-[13px]" />
                        <input type="number" step="0.01" value={p.prices.large ?? ""} onChange={(e) => setProdPrice(i, "large", e.target.value)} placeholder="—" className="w-[68px] font-mono text-right border border-bw-border rounded-lg px-2 py-1.5 text-[13px]" />
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="p-6">
                <GlobalChargesEditor charges={dna.globalCharges} onChange={(g) => setDna((d) => (d ? { ...d, globalCharges: g } : d))} />
              </Card>

              <div className="grid sm:grid-cols-2 gap-4">
                <Card className="p-6 space-y-3">
                  <DnaNum label="Default discount" suffix="%" value={dna.discountPct} onChange={(v) => setDna((d) => (d ? { ...d, discountPct: v } : d))} />
                  <DnaNum label="Sales tax" suffix="%" value={dna.taxPct} onChange={(v) => setDna((d) => (d ? { ...d, taxPct: v } : d))} />
                </Card>
              </div>

              {/* Boilerplate review */}
              <Card className="p-6 space-y-3">
                <div className="font-semibold">Your terms</div>
                <TxtRow label="Payment terms" value={dna.paymentTerms} onChange={(v) => setDna((d) => (d ? { ...d, paymentTerms: v } : d))} />
                <TxtRow label="Warranty" value={dna.warranty} onChange={(v) => setDna((d) => (d ? { ...d, warranty: v } : d))} />
                <DnaNum label="Quote valid" suffix="days" value={dna.validityDays} onChange={(v) => setDna((d) => (d ? { ...d, validityDays: v } : d))} />
              </Card>

              {dna.exclusions.length > 0 && (
                <Card className="p-6">
                  <div className="font-semibold mb-1">Your standard exclusions</div>
                  <div className="text-[12px] text-bw-muted mb-3">Pulled from your proposals — reused on every generated bid</div>
                  <ul className="text-[13px] text-bw-body space-y-1 list-disc pl-5">
                    {dna.exclusions.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                </Card>
              )}

              <p className="text-[12px] text-bw-muted pt-1">You can add or change products, charges, and sizes anytime in <span className="font-medium text-bw-text">Settings → pricing</span>.</p>
              <div className="flex items-center justify-between pt-2">
                <button onClick={() => setStep(1)} className="text-[14px] font-semibold text-bw-body hover:text-bw-text">Back</button>
                <Button onClick={onConfirmDna} disabled={busy}>{busy ? "Saving…" : "Save & finish"}</Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Active "reading" state shown while the pricing-DNA extraction runs (~a minute on
 *  Opus). A document mock with a sweeping scan line + shimmer text + rotating step
 *  captions, so the wait reads as work-in-progress rather than a frozen screen. */
function ReadingProposals({ flooring }: { flooring: boolean }) {
  const steps = flooring
    ? ["Opening your proposals…", "Finding your floor systems…", "Reading your per-SF rates…", "Spotting prep, base & trim…", "Recovering terms & exclusions…"]
    : ["Opening your proposals…", "Finding your shade products…", "Reading your per-shade prices…", "Spotting mobilization & terms…", "Recovering exclusions…"];
  const [i, setI] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setI((p) => (p + 1) % steps.length), 2200);
    return () => clearInterval(iv);
  }, [steps.length]);

  return (
    <Card className="p-8">
      <div className="flex flex-col items-center">
        <div className="relative w-[180px] h-[120px] rounded-lg border border-bw-border bg-white overflow-hidden shadow-sm">
          <div className="absolute inset-0 p-3.5 space-y-2.5">
            {[90, 70, 82, 58, 76, 48].map((w, k) => (
              <div key={k} className="h-2 rounded bg-bw-border bw-line" style={{ width: `${w}%`, animationDelay: `${k * 0.15}s` }} />
            ))}
          </div>
          <div className="bw-scanbar absolute left-0 right-0 h-10" />
        </div>
        <div className="mt-5 inline-flex items-center gap-2.5 text-[14px] font-semibold">
          <span className="w-2 h-2 rounded-full bg-bw-green animate-pulse" />
          <span key={i} className="bw-fade inline-block">{steps[i]}</span>
        </div>
        <p className="text-[13px] text-bw-muted mt-2">This takes a minute. The page updates automatically.</p>
      </div>
      <style>{`
        @keyframes bwScan { 0% { transform: translateY(-40px); } 100% { transform: translateY(120px); } }
        @keyframes bwShimmer { 0%, 100% { opacity: .45; } 50% { opacity: .95; } }
        @keyframes bwFade { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
        .bw-scanbar { top: 0; background: linear-gradient(180deg, transparent, rgba(20,168,0,0.16), rgba(20,168,0,0.30), transparent); animation: bwScan 1.9s ease-in-out infinite; }
        .bw-line { animation: bwShimmer 1.6s ease-in-out infinite; }
        .bw-fade { animation: bwFade .4s ease; }
      `}</style>
    </Card>
  );
}

function DnaNum({ label, suffix, value, onChange }: { label: string; suffix: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[14px]">{label}</span>
      <div className="flex items-center gap-1">
        {suffix !== "%" && suffix !== "days" && <span className="text-bw-muted">$</span>}
        <input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} className="w-24 font-mono text-right border border-bw-border rounded-lg px-2 py-1.5 text-[14px]" />
        <span className="text-bw-muted text-[12px]">{suffix}</span>
      </div>
    </div>
  );
}

function TxtRow({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[14px] flex-shrink-0">{label}</span>
      <input value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="flex-1 max-w-[60%] rounded-lg border border-bw-border px-2 py-1.5 text-[13px] outline-none focus:border-bw-green" />
    </div>
  );
}
