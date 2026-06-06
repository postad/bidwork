"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { dispatchBids } from "./actions";

export type ProposalSection = {
  tradeLabel: string;
  total: number | null;
  status: string | null;
  kind: string | null; // 'priced' | 'site_visit'
};

/** One proposal = one sub (workspace) for this request, with a section per YES trade.
 *  Lazy grouping over the per-trade `bids` rows — the proposal total is their sum. */
export type SubGroup = {
  workspaceId: string;
  name: string;
  initials: string;
  distanceLabel: string;
  sections: ProposalSection[];
  proposalTotal: number; // sum of section totals (priced sections only)
  draftBidIds: string[]; // draft bids in this proposal → dispatched together
  dispatchedCount: number; // sections already ready/sent
};

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const PALETTE = ["bg-bw-green text-white", "bg-bw-blue-tint text-bw-blue", "bg-bw-purple-tint text-bw-purple"];

export function DispatchPanel({
  bidRequestId,
  subs,
  hasCriticalGap,
  warningCount,
}: {
  bidRequestId: string;
  subs: SubGroup[];
  hasCriticalGap: boolean;
  warningCount: number;
}) {
  const router = useRouter();

  const dispatchable = useMemo(() => subs.filter((s) => s.draftBidIds.length > 0), [subs]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(dispatchable.map((s) => s.workspaceId)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dispatchedSubs = useMemo(() => subs.filter((s) => s.draftBidIds.length === 0 && s.dispatchedCount > 0).length, [subs]);

  const selectedSubs = dispatchable.filter((s) => selected.has(s.workspaceId));
  const selectedTotal = selectedSubs.reduce((a, s) => a + s.proposalTotal, 0);
  const nothingToDispatch = dispatchable.length === 0;
  const canDispatch = !hasCriticalGap && selectedSubs.length > 0 && !busy;

  function toggle(workspaceId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
  }

  async function onDispatch() {
    setBusy(true);
    setError(null);
    try {
      await dispatchBids(bidRequestId, selectedSubs.flatMap((s) => s.draftBidIds));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {subs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-bw-border p-6 text-[13px] text-bw-body">
          No subcontractor covers a bid trade in range — nothing to dispatch.
        </div>
      ) : (
        subs.map((s, idx) => {
          const isDraft = s.draftBidIds.length > 0;
          const checked = selected.has(s.workspaceId);
          return (
            <label
              key={s.workspaceId}
              className={`block bg-white rounded-2xl border overflow-hidden mb-4 ${checked && isDraft ? "border-bw-green" : "border-bw-border"} ${isDraft ? "cursor-pointer" : "cursor-default"}`}
            >
              <div className="flex items-center gap-3 px-5 py-3.5 border-b border-bw-border bg-bw-surface/50">
                <input
                  type="checkbox"
                  className="accent-bw-green w-4 h-4 disabled:opacity-40"
                  checked={checked && isDraft}
                  disabled={!isDraft}
                  onChange={() => isDraft && toggle(s.workspaceId)}
                />
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-[12px] flex-shrink-0 ${PALETTE[idx % PALETTE.length]}`}>{s.initials}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{s.name}</div>
                  <div className="text-[12px] text-bw-muted truncate">
                    {s.distanceLabel} · {s.sections.length} section{s.sections.length === 1 ? "" : "s"}
                    {!isDraft && s.dispatchedCount > 0 ? " · dispatched" : ""}
                  </div>
                </div>
                {s.proposalTotal > 0 && <span className="text-[15px] font-mono font-bold flex-shrink-0">{usd(s.proposalTotal)}</span>}
              </div>
              <div className="divide-y divide-bw-border">
                {s.sections.map((sec, i) => {
                  const siteVisit = sec.kind === "site_visit";
                  return (
                    <div key={i} className="flex items-center justify-between gap-3 px-5 py-2.5 pl-[4.25rem]">
                      <span className="text-[13px] text-bw-body truncate">{sec.tradeLabel}</span>
                      {siteVisit ? (
                        <span className="text-[12px] font-semibold text-bw-amber flex-shrink-0">Site visit · quote on measure</span>
                      ) : sec.total != null ? (
                        <span className="text-[13px] font-mono flex-shrink-0">{usd(sec.total)}</span>
                      ) : (
                        <span className="text-[12px] text-bw-muted flex-shrink-0">pending pricing</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </label>
          );
        })
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
              dispatchedSubs > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-bw-green-deep font-medium">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M20 6L9 17l-5-5" /></svg>
                  {dispatchedSubs} proposal{dispatchedSubs === 1 ? "" : "s"} dispatched — now in the contractor&apos;s dashboard to review &amp; send.
                </span>
              ) : (
                <span className="text-bw-muted">Priced drafts appear here once extraction finishes — then select subs to dispatch.</span>
              )
            ) : (
              <span>
                <span className="font-semibold text-bw-text">{selectedSubs.length}</span> proposal{selectedSubs.length === 1 ? "" : "s"} selected
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
              {busy ? "Dispatching…" : `Dispatch ${selectedSubs.length || ""} proposal${selectedSubs.length === 1 ? "" : "s"}`.trim()}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          )}
        </div>
      </div>
    </>
  );
}
