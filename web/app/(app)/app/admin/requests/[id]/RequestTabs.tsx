"use client";

import { useState, type ReactNode } from "react";

/** Two-tab split for the operator's request page: DISPATCH (the only thing they act
 *  on) vs. DETAILS (relevance, documents, gaps, contacts — reference). */
export function RequestTabs({ dispatch, details, dispatchCount }: { dispatch: ReactNode; details: ReactNode; dispatchCount: number }) {
  const [tab, setTab] = useState<"dispatch" | "details">("dispatch");
  const cls = (active: boolean) => `px-4 py-2 text-[14px] font-semibold rounded-full transition ${active ? "bg-bw-green text-white" : "text-bw-body hover:bg-bw-surface"}`;
  return (
    <>
      <div className="flex items-center gap-2 mb-6 border-b border-bw-border pb-3">
        <button onClick={() => setTab("dispatch")} className={cls(tab === "dispatch")}>Dispatch{dispatchCount ? ` · ${dispatchCount}` : ""}</button>
        <button onClick={() => setTab("details")} className={cls(tab === "details")}>Details</button>
      </div>
      {tab === "dispatch" ? dispatch : details}
    </>
  );
}
