"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Tag } from "@/components/ui/tag";
import { dispatchBids } from "./actions";

export type ContractorRow = {
  workspaceId: string;
  name: string;
  initials: string;
  distanceLabel: string;
  bidId: string | null;
  total: number | null;
  status: string | null;
  note?: string;
};

export type TradeGroup = {
  slug: string;
  label: string;
  contractors: ContractorRow[];
};

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const PALETTE = ["bg-bw-green text-white", "bg-bw-blue-tint text-bw-blue", "bg-bw-purple-tint text-bw-purple"];

export function DispatchPanel({
  bidRequestId,
  groups,
  hasCriticalGap,
  warningCount,
}: {
  bidRequestId: string;
  groups: TradeGroup[];
  hasCriticalGap: boolean;
  warningCount: number;
}) {
  const router = useRouter();

  // A row is dispatchable iff it has a draft bid (priced, not yet sent out).
  const draftRows = useMemo(
    () => groups.flatMap((g) => g.contractors).filter((c) => c.bidId && c.status === "draft"),
    [groups],
  );

  const [selected, setSelected] = useState<Set<string>>(() => new Set(draftRows.map((c) => c.bidId!)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Contractors whose bid has already been dispatched (ready/approved/sent).
  const dispatchedCount = useMemo(
    () => groups.flatMap((g) => g.contractors).filter((c) => c.bidId && c.status && c.status !== "draft").length,
    [groups],
  );

  const selectedRows = draftRows.filter((c) => selected.has(c.bidId!));
  const selectedTotal = selectedRows.reduce((a, c) => a + (c.total ?? 0), 0);
  const nothingToDispatch = draftRows.length === 0;
  const canDispatch = !hasCriticalGap && selectedRows.length > 0 && !busy;

  function toggle(bidId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(bidId)) next.delete(bidId);
      else next.add(bidId);
      return next;
    });
  }

  async function onDispatch() {
    setBusy(true);
    setError(null);
    try {
      await dispatchBids(bidRequestId, selectedRows.map((c) => c.bidId!));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {groups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-bw-border p-6 text-[13px] text-bw-body">
          No trades scored as bid — nothing to dispatch.
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.slug} className="bg-white rounded-2xl border border-bw-border overflow-hidden mb-4">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-b border-bw-border bg-bw-surface/50">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{g.label}</span>
                <Tag tone="green">BID</Tag>
              </div>
              <span className="text-[12px] text-bw-muted">
                {g.contractors.length} contractor{g.contractors.length === 1 ? "" : "s"} in coverage
              </span>
            </div>
            <div className="divide-y divide-bw-border">
              {g.contractors.length === 0 ? (
                <div className="px-5 py-4 text-[13px] text-bw-muted">No contractors cover this trade in range.</div>
              ) : (
                g.contractors.map((c, i) => {
                  const priced = c.total != null;
                  const isDraft = c.bidId != null && c.status === "draft";
                  const checked = c.bidId != null && selected.has(c.bidId);
                  return (
                    <label
                      key={c.workspaceId}
                      className={`flex items-center gap-3 px-5 py-3 ${isDraft ? "cursor-pointer" : "cursor-default text-bw-body"}`}
                    >
                      <input
                        type="checkbox"
                        className="accent-bw-green w-4 h-4 disabled:opacity-40"
                        checked={checked}
                        disabled={!isDraft}
                        onChange={() => c.bidId && toggle(c.bidId)}
                      />
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-[12px] flex-shrink-0 ${PALETTE[i % PALETTE.length]}`}>
                        {c.initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-[14px] truncate">{c.name}</div>
                        <div className={`text-[12px] truncate ${c.note ? "text-bw-amber" : "text-bw-muted"}`}>
                          {c.distanceLabel}
                          {c.note ? ` · ${c.note}` : c.status === "ready" || c.status === "sent" ? ` · ${c.status}` : ""}
                        </div>
                      </div>
                      {priced ? (
                        <span className="text-[13px] font-mono font-semibold">{usd(c.total!)}</span>
                      ) : (
                        <span className="text-[12px] text-bw-muted">pending pricing</span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>
        ))
      )}

      {/* Sticky dispatch bar */}
      <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-bw-border">
        <div className="max-w-[1100px] mx-auto px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px] text-bw-body flex items-center gap-2 min-w-0">
            {error ? (
              <span className="text-bw-red font-medium">{error}</span>
            ) : hasCriticalGap ? (
              <span>
                <span className="font-semibold text-bw-red">Resolve the critical gap</span> to dispatch.
              </span>
            ) : nothingToDispatch ? (
              dispatchedCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-bw-green-deep font-medium">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M20 6L9 17l-5-5" /></svg>
                  {dispatchedCount} proposal{dispatchedCount === 1 ? "" : "s"} dispatched — now in the contractor&apos;s dashboard to review &amp; send.
                </span>
              ) : (
                <span className="text-bw-muted">Priced drafts appear here once extraction finishes — then select contractors to dispatch.</span>
              )
            ) : (
              <span>
                <span className="font-semibold text-bw-text">{selectedRows.length}</span> selected
                {selectedTotal > 0 ? <span className="font-mono"> · {usd(selectedTotal)}</span> : null}
                {warningCount > 0 ? <span className="text-bw-muted"> · {warningCount} warning{warningCount === 1 ? "" : "s"} dispatch as caveats</span> : null}
              </span>
            )}
          </div>
          {!nothingToDispatch && (
            <button
              onClick={onDispatch}
              disabled={!canDispatch}
              className="inline-flex items-center gap-2 bg-bw-green text-white font-semibold text-[14px] px-6 py-2.5 rounded-full transition hover:bg-bw-green-hover disabled:bg-[#C9D1C7] disabled:cursor-not-allowed"
            >
              {busy ? "Dispatching…" : `Dispatch ${selectedRows.length || ""} proposal${selectedRows.length === 1 ? "" : "s"}`.trim()}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          )}
        </div>
      </div>
    </>
  );
}
