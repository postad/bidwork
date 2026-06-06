"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { sayHi } from "./actions";

export type NetContact = {
  id: string;
  name: string;
  role: string;
  company: string | null;
  email: string;
  foundIn: string | null;
  project: string | null;
  inNetwork: boolean;
  status: string | null;
};

type Seg = "all" | "suggested" | "network";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

function roleKey(role: string): "gc" | "architect" | "owner" | "designer" | "engineer" | "other" {
  const r = role.toLowerCase();
  if (r.includes("gc") || r.includes("general") || r.includes("contractor")) return "gc";
  if (r.includes("arch")) return "architect";
  if (r.includes("own")) return "owner";
  if (r.includes("design")) return "designer";
  if (r.includes("eng")) return "engineer";
  return "other";
}
const ROLE_META: Record<string, { label: string; tone: "blue" | "purple" | "amber" | "green" | "neutral" }> = {
  gc: { label: "General contractor", tone: "blue" },
  architect: { label: "Architect", tone: "purple" },
  owner: { label: "Owner", tone: "amber" },
  designer: { label: "Designer", tone: "green" },
  engineer: { label: "Engineer", tone: "neutral" },
  other: { label: "Contact", tone: "neutral" },
};

function statusPill(status: string | null) {
  switch (status) {
    case "replied":
      return <Tag tone="green">Replied</Tag>;
    case "read":
      return <Tag tone="blue">Read</Tag>;
    case "delivered":
      return <Tag tone="neutral">Delivered</Tag>;
    default:
      return <Tag tone="amber">Sending shortly</Tag>;
  }
}

function draft(first: string, role: string, trade: string, company: string, project: string | null) {
  const proj = project ?? "your project";
  const open = `Hi ${first},\n\nI'm reaching out from ${company} — we're a commercial ${trade} contractor.\n\n`;
  const k = roleKey(role);
  const mid =
    k === "gc"
      ? `I saw your team on the ${proj} documents and wanted to say hi. We'd love to be a go-to resource whenever ${trade} is in scope.\n\n`
      : k === "architect"
      ? `We came across your ${trade} specs on ${proj} and wanted to say hi. We're glad to be a resource for product details, lead times, or quick budget numbers — on this or future projects.\n\n`
      : k === "owner"
      ? `We noticed your team on ${proj} and wanted to introduce ourselves directly. We'd love to be at your service for ${trade} whenever a project calls for it.\n\n`
      : k === "designer"
      ? `We saw your work referenced on ${proj} and wanted to say hi. We'd love to support your specs with options, samples, and realistic budget numbers whenever it helps.\n\n`
      : `We noticed your involvement on ${proj} and wanted to say hi.\n\n`;
  return open + mid + `No need to reply — just wanted to be on your radar. If ${trade} ever comes up, we'd love to help.\n\nBest,\n${company}`;
}

export function NetworkList({ contacts, stats, companyName, categoryLabel, replyTo }: { contacts: NetContact[]; stats: { peopleFound: number; saidHi: number; inNetwork: number; replies: number }; companyName: string; categoryLabel: string | null; replyTo: string | null }) {
  const router = useRouter();
  // The contractor's trade, in lowercase prose for the say-hi copy (e.g. "flooring").
  const trade = (categoryLabel ?? "specialty trade").toLowerCase();
  const [seg, setSeg] = useState<Seg>("all");
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<NetContact | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [ccMe, setCcMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(
    () =>
      contacts.filter((c) => {
        if (seg === "suggested" && c.inNetwork) return false;
        if (seg === "network" && !c.inNetwork) return false;
        if (typeFilter.size && !typeFilter.has(roleKey(c.role))) return false;
        return true;
      }),
    [contacts, seg, typeFilter],
  );

  function openHi(c: NetContact) {
    setActive(c);
    setSubject(`Saying hi — ${companyName}`);
    setBody(draft(c.name.split(/\s+/)[0] ?? c.name, c.role, trade, companyName, c.project));
    setCcMe(true);
    setError(null);
  }

  async function send() {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await sayHi(active.id, { subject, body, ccMe });
      setActive(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function toggleType(k: string) {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  const tiles: [string, number | string, string][] = [
    ["People found", stats.peopleFound, "in your specs"],
    ["Said hi", stats.saidHi, "total"],
    ["In your network", stats.inNetwork, "people"],
    ["Replies", stats.replies, "conversations"],
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-2">
        <div>
          <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-2">{companyName}</div>
          <h1 className="text-[1.9rem] font-extrabold tracking-tight">Your network</h1>
        </div>
        <p className="text-[13px] text-bw-body max-w-[44ch] text-right">Everyone we found in your project documents — GCs, architects, owners. Say hi once and they join your network.</p>
      </div>

      <div className="flex items-start gap-3 bg-white border border-bw-border rounded-2xl px-5 py-3.5 mt-5 mb-7">
        <div className="w-8 h-8 rounded-lg bg-bw-green-tint flex items-center justify-center flex-shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#14A800" strokeWidth="2.2"><path d="M12 6v6l4 2" /><circle cx="12" cy="12" r="9" /></svg>
        </div>
        <p className="text-[13px] text-bw-body leading-snug">This is a <span className="font-semibold text-bw-text">say-hi</span>, not a chase. The moment a hello goes out, that person lands <span className="font-medium text-bw-text">in your network</span> — replies come straight to your inbox, never ours.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {tiles.map(([label, value, sub]) => (
          <Card key={label} className="p-5">
            <div className="text-[13px] text-bw-body mb-2">{label}</div>
            <div className="flex items-baseline gap-2"><span className="text-[28px] font-extrabold tracking-tight">{value}</span><span className="text-[12px] text-bw-muted">{sub}</span></div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="inline-flex items-center gap-1 bg-white border border-bw-border rounded-full p-1 text-[13px] font-medium">
          {(["all", "suggested", "network"] as Seg[]).map((s) => (
            <button key={s} onClick={() => setSeg(s)} className={`rounded-full px-3.5 py-1.5 ${seg === s ? "bg-bw-text text-white" : "text-bw-body"}`}>
              {s === "all" ? "All" : s === "suggested" ? "Suggested" : "In your network"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-bw-muted">Type:</span>
          {(["gc", "architect", "owner", "designer"] as const).map((k) => (
            <button key={k} onClick={() => toggleType(k)} className={`border rounded-full px-3 py-1.5 ${typeFilter.has(k) ? "bg-bw-green-tint border-bw-green text-bw-text" : "border-bw-border text-bw-body"}`}>
              {ROLE_META[k].label.replace("General contractor", "GC")}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        {shown.length === 0 ? (
          <div className="p-10 text-center text-[13px] text-bw-body">
            {contacts.length === 0 ? "No contacts yet — they appear here as the engine reads your bid packages." : "No one in this view."}
          </div>
        ) : (
          <div>
            {shown.map((c) => {
              const meta = ROLE_META[roleKey(c.role)];
              return (
                <div key={c.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4 px-6 py-4 border-b border-bw-border last:border-0 md:items-center hover:bg-bw-surface/50">
                  <div className="md:col-span-4 flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-bw-green-tint text-bw-green-deep flex items-center justify-center font-bold text-[13px] flex-shrink-0">{initials(c.name)}</div>
                    <div className="min-w-0">
                      <div className="font-semibold leading-tight truncate">{c.name}</div>
                      <div className="text-[12px] text-bw-muted truncate">{[c.role, c.company].filter(Boolean).join(" · ")}</div>
                    </div>
                  </div>
                  <div className="md:col-span-2"><Tag tone={meta.tone}>{meta.label}</Tag></div>
                  <div className="md:col-span-4 text-[13px] min-w-0">
                    <div className="text-bw-text truncate">{c.project ?? "Found in a bid package"}</div>
                    {c.foundIn && <div className="text-[12px] text-bw-muted truncate">{c.foundIn}</div>}
                  </div>
                  <div className="md:col-span-2 md:text-right">
                    {c.inNetwork ? (
                      statusPill(c.status)
                    ) : (
                      <button onClick={() => openHi(c)} className="inline-flex items-center justify-center gap-1.5 bg-bw-green text-white font-semibold text-[13px] px-4 py-2 rounded-full hover:bg-bw-green-hover">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M14 9V5a3 3 0 0 0-6 0v4M5 9h14l1 12H4L5 9z" /></svg>
                        Say hi
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* say-hi modal */}
      {active && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 overflow-y-auto py-10 px-4">
          <div className="bg-white rounded-2xl border border-bw-border shadow-xl max-w-[640px] w-full">
            <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-bw-border">
              <div className="min-w-0">
                <div className="font-semibold text-[15px] truncate">Say hi to {active.name}</div>
                <div className="text-[12px] text-bw-muted">Replies come straight to your inbox.</div>
              </div>
              <button onClick={() => setActive(null)} className="text-bw-muted hover:text-bw-text flex-shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-3 text-[13px]">
              <div className="flex items-center gap-3"><span className="w-16 text-bw-muted flex-shrink-0">To</span><span className="font-medium truncate">{active.name} · {active.email}</span></div>
              <div className="flex items-center gap-3"><span className="w-16 text-bw-muted flex-shrink-0">Reply-to</span><span className="font-medium text-bw-green">{replyTo ?? "—"}</span></div>
              <div className="flex items-center gap-3"><span className="w-16 text-bw-muted flex-shrink-0">Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} className="flex-1 border border-bw-border rounded-lg px-3 py-2 text-[14px] outline-none focus:border-bw-green focus:ring-2 focus:ring-bw-green-tint" /></div>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="w-full border border-bw-border rounded-lg px-3 py-3 text-[14px] leading-relaxed resize-y outline-none focus:border-bw-green focus:ring-2 focus:ring-bw-green-tint" />
              <label className="flex items-center gap-2.5 font-medium"><input type="checkbox" checked={ccMe} onChange={(e) => setCcMe(e.target.checked)} className="accent-bw-green w-4 h-4" /> Send me a copy</label>
              {error && <p className="text-bw-red">{error}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-bw-border">
              <button onClick={() => setActive(null)} disabled={busy} className="bg-white text-bw-body font-semibold text-[14px] px-4 py-2 rounded-full border border-bw-border hover:bg-bw-surface">Cancel</button>
              <button onClick={send} disabled={busy} className="inline-flex items-center gap-1.5 bg-bw-green text-white font-semibold text-[14px] px-5 py-2 rounded-full hover:bg-bw-green-hover disabled:opacity-50">
                {busy ? "Sending…" : "Send hi"}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
