"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  createOnboardingUploads,
  startPricingExtraction,
  getPendingDna,
  getOnboardingContext,
  confirmPricingDna,
  confirmFlooringPricingDna,
  saveOnboardingSettings,
  type ConfirmDna,
  type ConfirmFlooringDna,
} from "./actions";

type Step = 1 | 2 | 3;

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

  const field = "w-full rounded-lg border border-bw-border px-3 py-2 text-[14px] outline-none focus:border-bw-green focus:ring-2 focus:ring-bw-green-tint";

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

  // ---------- Step 2: poll + confirm DNA ----------
  const [dnaStatus, setDnaStatus] = useState<"extracting" | "ready" | "error" | null>(null);
  const [dna, setDna] = useState<ConfirmDna | null>(null);
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
                mobilizationFee: (p.mobilizationFee as number) ?? null,
                discountPct: (p.discountPct as number) ?? null,
                taxPct: (p.taxPct as number) ?? null,
                paymentTerms: (p.paymentTerms as string) ?? null,
                warranty: (p.warranty as string) ?? null,
                validityDays: (p.validityDays as number) ?? null,
                exclusions: (p.exclusions as string[]) ?? [],
              },
            );
          } else {
            setDna((prev) =>
              prev ?? {
                motorizedByGanging: (p.motorizedByGanging as ConfirmDna["motorizedByGanging"]) ?? [],
                blindsByWidth: (p.blindsByWidth as ConfirmDna["blindsByWidth"]) ?? [],
                fixedPanelPrice: (p.fixedPanelPrice as number) ?? null,
                installFee: (p.installFee as number) ?? null,
                discountPct: (p.discountPct as number) ?? null,
                taxPct: (p.taxPct as number) ?? null,
                paymentTerms: (p.paymentTerms as string) ?? null,
                warranty: (p.warranty as string) ?? null,
                validityDays: (p.validityDays as number) ?? null,
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
        await confirmPricingDna(dna);
      }
      setStep(3);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function setMotor(i: number, price: number) {
    setDna((d) => (d ? { ...d, motorizedByGanging: d.motorizedByGanging.map((m, j) => (j === i ? { ...m, price } : m)) } : d));
  }
  function setBlind(i: number, price: number) {
    setDna((d) => (d ? { ...d, blindsByWidth: d.blindsByWidth.map((b, j) => (j === i ? { ...b, price } : b)) } : d));
  }
  function setSys(i: number, perSqft: number) {
    setFloorDna((d) => (d ? { ...d, systems: d.systems.map((s, j) => (j === i ? { ...s, perSqft } : s)) } : d));
  }

  // ---------- Step 3: gap-fill ----------
  const [defaultProduct, setDefaultProduct] = useState("Solar 5%");
  const [minCharge, setMinCharge] = useState("2500");
  const [leadTime, setLeadTime] = useState("6-8 weeks");
  const [serviceArea, setServiceArea] = useState("");
  const [noBid, setNoBid] = useState<string[]>([]);
  function toggleNoBid(v: string) {
    setNoBid((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  }
  async function onFinish() {
    setBusy(true);
    setError(null);
    try {
      await saveOnboardingSettings({
        defaultProduct,
        minCharge: minCharge ? Number(minCharge) : null,
        leadTime: leadTime || null,
        serviceArea: serviceArea || null,
        noBid,
      });
      router.push("/app");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const noBidOptions = isFlooring
    ? ["Residential / single-family", "Jobs under 1,000 SF", "Occupied / phased work", "Out-of-hours / night work only"]
    : ["Residential / single-family", "Drive-thru / QSR only", "Drapery / soft goods", "Jobs under 10 windows"];

  return (
    <div className="max-w-[760px] mx-auto">
      {/* step rail */}
      <div className="flex items-center gap-2 mb-8 text-[12px] font-medium">
        {([[1, "Show us your bids"], [2, "Confirm what we read"], [3, "A few last things"]] as const).map(([n, label], i) => (
          <div key={n} className="flex items-center gap-2 flex-1">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold ${step >= n ? "bg-bw-green text-white" : "bg-bw-border text-bw-body"}`}>{n}</span>
            <span className={step >= n ? "text-bw-text" : "text-bw-muted"}>{label}</span>
            {i < 2 && <span className="flex-1 h-px bg-bw-border" />}
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

              <div className="grid sm:grid-cols-2 gap-4">
                <Card className="p-6 space-y-3">
                  <DnaNum label="Substrate prep" suffix="/SF" value={floorDna.prepPerSqft} onChange={(v) => setFloorDna((d) => (d ? { ...d, prepPerSqft: v } : d))} />
                  <DnaNum label="Base / trim" suffix="/LF" value={floorDna.baseTrimPerLf} onChange={(v) => setFloorDna((d) => (d ? { ...d, baseTrimPerLf: v } : d))} />
                  <DnaNum label="Mobilization fee" suffix="flat" value={floorDna.mobilizationFee} onChange={(v) => setFloorDna((d) => (d ? { ...d, mobilizationFee: v } : d))} />
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
              <Card className="p-6">
                <div className="font-semibold mb-3">Motorized roller — charged price by ganging</div>
                {dna.motorizedByGanging.length === 0 && <p className="text-[13px] text-bw-muted">None found — add rates in Settings later.</p>}
                <div className="space-y-2">
                  {dna.motorizedByGanging.map((m, i) => (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <span className="text-[14px]">{m.shadesPerMotor} on 1 motor</span>
                      <div className="flex items-center gap-1"><span className="text-bw-muted">$</span><input type="number" value={m.price} onChange={(e) => setMotor(i, Number(e.target.value))} className="w-28 font-mono text-right border border-bw-border rounded-lg px-2 py-1.5 text-[14px]" /><span className="text-bw-muted text-[12px]">/set</span></div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-6">
                <div className="font-semibold mb-3">Manual blinds — charged price by width</div>
                <div className="space-y-2">
                  {dna.blindsByWidth.map((b, i) => (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <span className="text-[14px]">≤ {b.maxWidthInches}&quot; wide</span>
                      <div className="flex items-center gap-1"><span className="text-bw-muted">$</span><input type="number" value={b.price} onChange={(e) => setBlind(i, Number(e.target.value))} className="w-28 font-mono text-right border border-bw-border rounded-lg px-2 py-1.5 text-[14px]" /><span className="text-bw-muted text-[12px]">/blind</span></div>
                    </div>
                  ))}
                </div>
              </Card>

              <div className="grid sm:grid-cols-2 gap-4">
                <Card className="p-6 space-y-3">
                  <DnaNum label="Fixed panel shade" suffix="/shade" value={dna.fixedPanelPrice} onChange={(v) => setDna((d) => (d ? { ...d, fixedPanelPrice: v } : d))} />
                  <DnaNum label="Install fee" suffix="flat" value={dna.installFee} onChange={(v) => setDna((d) => (d ? { ...d, installFee: v } : d))} />
                </Card>
                <Card className="p-6 space-y-3">
                  <DnaNum label="Default discount" suffix="%" value={dna.discountPct} onChange={(v) => setDna((d) => (d ? { ...d, discountPct: v } : d))} />
                  <DnaNum label="Sales tax" suffix="%" value={dna.taxPct} onChange={(v) => setDna((d) => (d ? { ...d, taxPct: v } : d))} />
                </Card>
              </div>

              {dna.exclusions.length > 0 && (
                <Card className="p-6">
                  <div className="font-semibold mb-1">Your standard exclusions</div>
                  <div className="text-[12px] text-bw-muted mb-3">Pulled from your proposals — reused on every generated bid</div>
                  <ul className="text-[13px] text-bw-body space-y-1 list-disc pl-5">
                    {dna.exclusions.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                </Card>
              )}

              <div className="flex items-center justify-between pt-2">
                <button onClick={() => setStep(1)} className="text-[14px] font-semibold text-bw-body hover:text-bw-text">Back</button>
                <Button onClick={onConfirmDna} disabled={busy}>{busy ? "Saving…" : "Looks right — continue"}</Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {step === 3 && (
        <div>
          <h1 className="text-[1.8rem] font-extrabold tracking-tight mb-2">A few things your bids don&apos;t say.</h1>
          <p className="text-[15px] text-bw-body mb-6 max-w-[56ch]">Quick, non-sensitive details that make your auto-generated bids sharper.</p>
          <div className="space-y-4">
            {!isFlooring && (
              <Card className="p-6">
                <label className="block font-semibold mb-1">When the spec doesn&apos;t name a product, default to…</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
                  {["Solar 5%", "Solar 3%", "Roller", "Ask me"].map((p) => (
                    <button key={p} type="button" onClick={() => setDefaultProduct(p)} className={`border rounded-xl px-3 py-2.5 text-[13px] font-medium text-center ${defaultProduct === p ? "border-bw-green bg-bw-green-tint text-bw-text" : "border-bw-border text-bw-body"}`}>{p}</button>
                  ))}
                </div>
              </Card>
            )}
            <div className="grid sm:grid-cols-2 gap-4">
              <Card className="p-6">
                <label className="block font-semibold mb-1">Minimum job charge</label>
                <p className="text-[13px] text-bw-body mb-3">We won&apos;t generate a bid below this.</p>
                <div className="flex items-center gap-1.5"><span className="text-bw-muted">$</span><input value={minCharge} onChange={(e) => setMinCharge(e.target.value)} className={field} /></div>
              </Card>
              <Card className="p-6">
                <label className="block font-semibold mb-1">Typical lead time</label>
                <p className="text-[13px] text-bw-body mb-3">Stated on the proposal.</p>
                <input value={leadTime} onChange={(e) => setLeadTime(e.target.value)} className={field} />
              </Card>
            </div>
            <Card className="p-6">
              <label className="block font-semibold mb-1">Where do you take work?</label>
              <p className="text-[13px] text-bw-body mb-3">Projects outside this get flagged as no-bid before you waste time.</p>
              <input value={serviceArea} onChange={(e) => setServiceArea(e.target.value)} placeholder="NYC five boroughs, Westchester, Northern NJ" className={field} />
            </Card>
            <Card className="p-6">
              <label className="block font-semibold mb-1">Anything you don&apos;t bid?</label>
              <div className="grid sm:grid-cols-2 gap-2 text-[13px] mt-3">
                {noBidOptions.map((v) => (
                  <label key={v} className="flex items-center gap-2.5"><input type="checkbox" checked={noBid.includes(v)} onChange={() => toggleNoBid(v)} className="accent-bw-green w-4 h-4" /> {v}</label>
                ))}
              </div>
            </Card>
            <div className="flex items-center justify-between pt-2">
              <button onClick={() => setStep(2)} className="text-[14px] font-semibold text-bw-body hover:text-bw-text">Back</button>
              <Button onClick={onFinish} disabled={busy}>{busy ? "Saving…" : "Save my base model"}</Button>
            </div>
          </div>
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
    : ["Opening your proposals…", "Finding your products…", "Reading motor & ganging rates…", "Spotting blind width tiers…", "Recovering terms & exclusions…"];
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
        {suffix !== "%" && <span className="text-bw-muted">$</span>}
        <input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} className="w-24 font-mono text-right border border-bw-border rounded-lg px-2 py-1.5 text-[14px]" />
        <span className="text-bw-muted text-[12px]">{suffix}</span>
      </div>
    </div>
  );
}
