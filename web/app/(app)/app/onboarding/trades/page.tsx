"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getTradeCatalog, selectSubTrades } from "../actions";

type Cat = { category: string; label: string; trades: { slug: string; label: string }[] };

export default function PickTradesPage() {
  const router = useRouter();
  const [cats, setCats] = useState<Cat[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [zip, setZip] = useState("");
  const [radius, setRadius] = useState("100");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getTradeCatalog()
      .then((c) => {
        if (!active) return;
        setCats(c);
        if (c.length === 1) setCategory(c[0].category);
      })
      .catch((e) => active && setError((e as Error).message));
    return () => {
      active = false;
    };
  }, []);

  const active = cats.find((c) => c.category === category);
  function toggle(slug: string) {
    setPicked((p) => (p.includes(slug) ? p.filter((x) => x !== slug) : [...p, slug]));
  }

  async function onContinue() {
    if (!picked.length) return;
    setBusy(true);
    setError(null);
    try {
      await selectSubTrades(picked, zip || null, radius ? Number(radius) : 100);
      router.push("/app/onboarding");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-bw-border px-3 py-2 text-[14px] outline-none focus:border-bw-green focus:ring-2 focus:ring-bw-green-tint";
  const chip = (on: boolean) => `border rounded-xl px-3.5 py-2.5 text-[13px] font-medium text-center cursor-pointer ${on ? "border-bw-green bg-bw-green-tint text-bw-text" : "border-bw-border text-bw-body hover:border-bw-green"}`;

  return (
    <div className="max-w-[760px] mx-auto">
      <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-3">Step 0 · your trades</div>
      <h1 className="text-[1.8rem] font-extrabold tracking-tight mb-2">What do you bid?</h1>
      <p className="text-[15px] text-bw-body mb-6 max-w-[56ch]">Pick your category, then the sub-trades you actually do. We&apos;ll only surface projects that match — and train your pricing for these next.</p>

      {error && <p className="text-[13px] text-bw-red mb-4">{error}</p>}

      {/* Category */}
      <Card className="p-6 mb-4">
        <label className="block font-semibold mb-3">Category</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {cats.map((c) => (
            <button
              key={c.category}
              type="button"
              onClick={() => {
                setCategory(c.category);
                setPicked([]);
              }}
              className={chip(category === c.category)}
            >
              {c.label}
            </button>
          ))}
          {cats.length === 0 && <p className="text-[13px] text-bw-muted">Loading…</p>}
        </div>
      </Card>

      {/* Sub-trades */}
      {active && (
        <Card className="p-6 mb-4">
          <label className="block font-semibold mb-1">{active.label} sub-trades</label>
          <p className="text-[13px] text-bw-body mb-3">Select every one you bid.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {active.trades.map((t) => (
              <button key={t.slug} type="button" onClick={() => toggle(t.slug)} className={chip(picked.includes(t.slug))}>
                {t.label}
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Service area */}
      {active && (
        <Card className="p-6 mb-5">
          <label className="block font-semibold mb-1">Service area</label>
          <p className="text-[13px] text-bw-body mb-3">Where you take work — projects outside get flagged before you waste time.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-semibold text-bw-body">Base ZIP</label>
              <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="10018" className={field} />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-bw-body">Radius (mi)</label>
              <input value={radius} onChange={(e) => setRadius(e.target.value)} className={field} />
            </div>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-end">
        <Button onClick={onContinue} disabled={busy || !picked.length}>
          {busy ? "Saving…" : `Continue${picked.length ? ` (${picked.length})` : ""}`}
        </Button>
      </div>
    </div>
  );
}
