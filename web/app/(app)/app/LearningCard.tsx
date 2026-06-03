"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { applyPricingEdit } from "./actions";

export type LearningItem = {
  editId: string;
  project: string | null;
  label: string;
  oldPrice: number;
  newPrice: number;
};

const usd0 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function LearningCard({ items }: { items: LearningItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!items.length) return null;

  async function apply(editId: string) {
    setBusy(editId);
    setError(null);
    try {
      await applyPricingEdit(editId);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-6 mt-6">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green">Pricing learning</div>
        <span className="text-[12px] text-bw-muted">{items.length} from your edits</span>
      </div>
      <p className="text-[13px] text-bw-body mb-4">When you changed a price while reviewing a bid, it can teach your rate card so future bids price themselves correctly. Your edits are private to you.</p>
      <div className="divide-y divide-bw-border">
        {items.map((it) => (
          <div key={it.editId} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="text-[14px] font-medium">{it.label}</div>
              <div className="text-[12px] text-bw-muted truncate">
                {it.project ? `on ${it.project} · ` : ""}
                <span className="font-mono">{usd0(it.oldPrice)}</span> → <span className="font-mono text-bw-text">{usd0(it.newPrice)}</span>
              </div>
            </div>
            <button
              onClick={() => apply(it.editId)}
              disabled={busy === it.editId}
              className="inline-flex items-center gap-1.5 bg-white text-bw-text font-semibold text-[12px] px-3.5 py-1.5 rounded-full border border-bw-border hover:bg-bw-green-tint disabled:opacity-50"
            >
              {busy === it.editId ? "Updating…" : "Update my rate card"}
            </button>
          </div>
        ))}
      </div>
      {error && <p className="text-[13px] text-bw-red mt-3">{error}</p>}
    </Card>
  );
}
