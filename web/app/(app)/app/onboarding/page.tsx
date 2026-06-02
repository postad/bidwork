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
  confirmPricingDna,
  saveOnboardingSettings,
  type ConfirmDna,
} from "./actions";

type Step = 1 | 2 | 3;

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const field = "w-full rounded-lg border border-bw-border px-3 py-2 text-[14px] outline-none focus:border-bw-green focus:ring-2 focus:ring-bw-green-tint";

  // ---------- Step 1: upload ----------
  const [files, setFiles] = useState<File[]>([]);
  async function onUpload() {
    if (!files.length) return;
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
      await startPricingExtraction(uploads.map((u) => u.path));
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
        if (s === "ready" && !dna) {
          setDna({
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
          });
        }
        if (s === "error") setError((p.error as string) ?? "Extraction failed");
      } catch {
        /* keep polling */
      }
    };
    tick();
    const iv = setInterval(() => {
      void tick();
    }, 3000);
    return () => {
      active = false;
      polling.current = false;
      clearInterval(iv);
    };
  }, [step, dna]);

  async function onConfirmDna() {
    if (!dna) return;
    setBusy(true);
    setError(null);
    try {
      await confirmPricingDna(dna);
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
          <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-3">Window Treatments · base pricing</div>
          <h1 className="text-[1.8rem] font-extrabold tracking-tight mb-2">Show us how you bid.</h1>
          <p className="text-[15px] text-bw-body mb-6 max-w-[56ch]">Drop in 2–3 recent proposals. We&apos;ll read them and recover your products, prices, exclusions, and terms — you confirm everything next.</p>
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
            <Button onClick={onUpload} disabled={busy || !files.length}>{busy ? "Working…" : "Upload & read my bids"}</Button>
            {status && <span className="text-[13px] text-bw-body">{status}</span>}
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h1 className="text-[1.8rem] font-extrabold tracking-tight mb-2">Here&apos;s your pricing DNA.</h1>
          <p className="text-[15px] text-bw-body mb-6 max-w-[56ch]">What we learned from your own bids. Confirm what&apos;s right, fix what&apos;s not. Every number is a <span className="font-medium text-bw-text">charged price</span> — we never ask cost or margin.</p>

          {dnaStatus !== "ready" || !dna ? (
            <Card className="p-8 text-center">
              <div className="inline-flex items-center gap-3 text-[14px] font-semibold">
                <span className="w-2 h-2 rounded-full bg-bw-green animate-pulse" />
                {dnaStatus === "error" ? "Extraction failed — go back and try again." : "Reading your proposals…"}
              </div>
              {dnaStatus !== "error" && <p className="text-[13px] text-bw-muted mt-2">This takes a minute. The page updates automatically.</p>}
            </Card>
          ) : (
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
          )}
        </div>
      )}

      {step === 3 && (
        <div>
          <h1 className="text-[1.8rem] font-extrabold tracking-tight mb-2">A few things your bids don&apos;t say.</h1>
          <p className="text-[15px] text-bw-body mb-6 max-w-[56ch]">Quick, non-sensitive details that make your auto-generated bids sharper.</p>
          <div className="space-y-4">
            <Card className="p-6">
              <label className="block font-semibold mb-1">When the spec doesn&apos;t name a product, default to…</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
                {["Solar 5%", "Solar 3%", "Roller", "Ask me"].map((p) => (
                  <button key={p} type="button" onClick={() => setDefaultProduct(p)} className={`border rounded-xl px-3 py-2.5 text-[13px] font-medium text-center ${defaultProduct === p ? "border-bw-green bg-bw-green-tint text-bw-text" : "border-bw-border text-bw-body"}`}>{p}</button>
                ))}
              </div>
            </Card>
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
                {["Residential / single-family", "Drive-thru / QSR only", "Drapery / soft goods", "Jobs under 10 windows"].map((v) => (
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
