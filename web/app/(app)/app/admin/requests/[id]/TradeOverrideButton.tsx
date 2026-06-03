"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setTradeRelevance } from "./actions";

/** Operator confirm/override of a trade's bid↔no_bid relevance. */
export function TradeOverrideButton({ bidRequestId, tradeSlug, current }: { bidRequestId: string; tradeSlug: string; current: "bid" | "no_bid" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = current === "bid" ? "no_bid" : "bid";

  async function flip() {
    setBusy(true);
    setError(null);
    try {
      await setTradeRelevance(bidRequestId, tradeSlug, target);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <button
      onClick={flip}
      disabled={busy}
      className="text-[11.5px] font-semibold text-bw-body hover:text-bw-text underline-offset-2 hover:underline disabled:opacity-50"
      title={current === "bid" ? "Override: this isn't biddable scope" : "Override: bid this trade anyway"}
    >
      {busy ? "Saving…" : current === "bid" ? "Mark no-bid" : "Bid this trade →"}
      {error && <span className="block text-bw-red font-normal">{error}</span>}
    </button>
  );
}
