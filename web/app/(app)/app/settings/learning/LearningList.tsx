"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { removeLearnedProduct } from "./actions";

export type LearnedItem = {
  tradeId: string;
  tradeLabel: string;
  name: string;
  price: number;
  unit: string; // "/SF" | "each"
  learnedFrom: string | null;
  learnedAt: string | null;
};

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 });

export function LearningList({ items }: { items: LearnedItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onRemove(it: LearnedItem) {
    const key = `${it.tradeId}:${it.name}`;
    setBusy(key);
    setError(null);
    try {
      await removeLearnedProduct(it.tradeId, it.name);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!items.length) {
    return (
      <Card className="p-8 text-center">
        <div className="text-[15px] font-semibold mb-1">Nothing learned yet</div>
        <p className="text-[13px] text-bw-body">When you price a flagged &quot;needs your price&quot; line on a bid, BidWork adds that product here and reuses it next time.</p>
      </Card>
    );
  }

  return (
    <>
      {error && <p className="text-[13px] text-bw-red mb-3">{error}</p>}
      <Card className="overflow-hidden">
        <div className="divide-y divide-bw-border">
          {items.map((it) => {
            const key = `${it.tradeId}:${it.name}`;
            return (
              <div key={key} className="flex items-center gap-3 px-5 py-3.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[14px] truncate">{it.name}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-bw-green-tint text-bw-green flex-shrink-0">LEARNED</span>
                  </div>
                  <div className="text-[12px] text-bw-muted truncate">
                    {it.tradeLabel}
                    {it.learnedFrom ? ` · from ${it.learnedFrom}` : ""}
                  </div>
                </div>
                <span className="text-[13px] font-mono flex-shrink-0">{usd(it.price)}<span className="text-bw-muted text-[11px]"> {it.unit}</span></span>
                <button
                  onClick={() => onRemove(it)}
                  disabled={busy === key}
                  className="text-[12px] font-semibold text-bw-body hover:text-bw-red border border-bw-border rounded-full px-3 py-1.5 disabled:opacity-50 flex-shrink-0"
                >
                  {busy === key ? "Removing…" : "Remove"}
                </button>
              </div>
            );
          })}
        </div>
      </Card>
      <p className="text-[12px] text-bw-muted mt-3">Removing a product takes it out of your pricing too — the engine stops auto-pricing it.</p>
    </>
  );
}
