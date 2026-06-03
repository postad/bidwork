import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Tag } from "@/components/ui/tag";
import { DispatchPanel, type TradeGroup, type ContractorRow } from "./DispatchPanel";
import { DocsPanel } from "./DocsPanel";
import { acknowledgeGaps } from "./actions";

type TradeScore = {
  slug: string;
  label: string;
  relevance: "bid" | "no_bid";
  confidence: number;
  reasoning?: string;
};

type Gap = { kind?: string; severity: "critical" | "warning"; message: string; acknowledged?: boolean };

const pct = (c: number) => `${Math.round((c ?? 0) * 100)}%`;
const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "??";

// Haversine miles — used only when both ends have coordinates.
function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(s));
}

export default async function ReviewDispatchPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/app");

  const { data: req } = await supabase
    .from("bid_requests")
    .select("id, title, status, center_zip, center_lat, center_lng, radius_mi, trade_scores, doc_gaps, created_at")
    .eq("id", params.id)
    .single();
  if (!req) notFound();

  const { data: docs } = await supabase
    .from("documents")
    .select("filename, bytes, page_count")
    .eq("bid_request_id", req.id);

  const scores = (Array.isArray(req.trade_scores) ? req.trade_scores : []) as TradeScore[];
  const gaps = (Array.isArray(req.doc_gaps) ? req.doc_gaps : []) as Gap[];
  const bidScores = scores.filter((s) => s.relevance === "bid").sort((a, b) => b.confidence - a.confidence);
  const noBidScores = scores.filter((s) => s.relevance !== "bid");
  const criticalGaps = gaps.filter((g) => g.severity === "critical");
  const warningGaps = gaps.filter((g) => g.severity === "warning");
  const blockingGaps = criticalGaps.filter((g) => !g.acknowledged);

  // Resolve bid trade slugs → ids/labels, then their in-coverage contractors + any priced bids.
  const bidSlugs = bidScores.map((s) => s.slug);
  const [{ data: trades }, { data: bids }, { data: contacts }] = await Promise.all([
    bidSlugs.length
      ? supabase.from("trades").select("id, slug, label").in("slug", bidSlugs)
      : Promise.resolve({ data: [] as { id: string; slug: string; label: string }[] }),
    supabase.from("bids").select("id, trade_id, workspace_id, total, status, kind").eq("bid_request_id", req.id),
    supabase
      .from("contacts")
      .select("name, role, company, email, found_in")
      .eq("source_bid_request_id", req.id),
  ]);

  const tradeBySlug = new Map((trades ?? []).map((t) => [t.slug, t]));
  const tradeIds = (trades ?? []).map((t) => t.id);
  const { data: coverage } = tradeIds.length
    ? await supabase
        .from("workspace_trades")
        .select("trade_id, radius_mi, center_lat, center_lng, workspace_id, workspaces(name)")
        .in("trade_id", tradeIds)
    : { data: [] as any[] };

  const reqCenter =
    req.center_lat != null && req.center_lng != null ? { lat: req.center_lat, lng: req.center_lng } : null;

  const groups: TradeGroup[] = bidScores.map((s) => {
    const trade = tradeBySlug.get(s.slug);
    const cov = (coverage ?? []).filter((c: any) => c.trade_id === trade?.id);
    const contractors: ContractorRow[] = cov
      .map((c: any): ContractorRow | null => {
        const name = c.workspaces?.name ?? "Unknown";
        const bid = (bids ?? []).find((b) => b.workspace_id === c.workspace_id && b.trade_id === trade?.id);
        let distanceLabel = "in coverage";
        if (reqCenter && c.center_lat != null && c.center_lng != null) {
          const mi = milesBetween(reqCenter, { lat: c.center_lat, lng: c.center_lng });
          if (mi > (req.radius_mi ?? c.radius_mi ?? 100)) return null; // out of range
          distanceLabel = `${Math.round(mi)} mi`;
        }
        return {
          workspaceId: c.workspace_id,
          name,
          initials: initials(name),
          distanceLabel,
          bidId: bid?.id ?? null,
          total: bid?.total != null ? Number(bid.total) : null,
          status: bid?.status ?? null,
          kind: bid?.kind ?? null,
        };
      })
      .filter((x): x is ContractorRow => x !== null);
    return { slug: s.slug, label: trade?.label ?? s.label, contractors };
  });

  const withEmail = (contacts ?? []).filter((c) => c.email);
  const fileCount = docs?.length ?? 0;
  const totalMb = (docs ?? []).reduce((a, d) => a + (Number(d.bytes) || 0), 0) / 1048576;
  const totalPages = (docs ?? []).reduce((a, d) => a + (d.page_count || 0), 0);

  const statusTone = req.status === "needs_review" ? "amber" : req.status === "dispatched" ? "blue" : "neutral";

  return (
    <div className="pb-28">
      <Link href="/app/admin" className="inline-flex items-center gap-1.5 text-[13px] text-bw-body hover:text-bw-text mb-5">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
        Bid requests
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <div className="text-[12px] font-semibold tracking-[0.12em] uppercase text-bw-green mb-2">Review &amp; dispatch</div>
          <h1 className="text-[1.9rem] font-extrabold tracking-tight">{req.title}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-bw-body mt-2">
            <span className="font-mono">
              {fileCount} file{fileCount === 1 ? "" : "s"}
              {totalPages > 0 ? ` · ${totalPages} pp` : ""}
              {totalMb > 0 ? ` · ${totalMb.toFixed(1)} MB` : ""}
            </span>
            <span>{req.radius_mi} mi from {req.center_zip ?? "—"}</span>
          </div>
        </div>
        {blockingGaps.length > 0 ? (
          <Tag tone="red">{blockingGaps.length} critical gap{blockingGaps.length === 1 ? "" : "s"} block dispatch</Tag>
        ) : (
          <Tag tone={statusTone}>{req.status}</Tag>
        )}
      </div>

      {/* 1 · Trade relevance */}
      <section className="mb-9">
        <div className="flex items-baseline gap-2 mb-1">
          <h2 className="text-[1.2rem] font-extrabold tracking-tight">Trade relevance</h2>
          <span className="text-[13px] text-bw-muted">— scored against all {scores.length} trades</span>
        </div>
        <p className="text-[13px] text-bw-body mb-4">
          One read scored every trade. Bid trades extract and price; off-scope trades drop out automatically.
        </p>

        {scores.length === 0 ? (
          <div className="bg-white rounded-2xl border border-bw-border p-6 text-[13px] text-bw-body">
            Scan still running — trade scores will appear when it finishes.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {bidScores.map((s) => (
              <div key={s.slug} className="bg-white rounded-2xl border-l-4 border-bw-green border border-bw-border p-4">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="font-semibold">{tradeBySlug.get(s.slug)?.label ?? s.label}</div>
                  <Tag tone="green">BID · {pct(s.confidence)}</Tag>
                </div>
                {s.reasoning && <p className="text-[12.5px] text-bw-body">{s.reasoning}</p>}
              </div>
            ))}
            {noBidScores.map((s) => (
              <div key={s.slug} className="bg-white rounded-2xl border-l-4 border-bw-border border border-bw-border p-4 opacity-80">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="font-semibold text-bw-body">{s.label}</div>
                  <Tag tone="neutral">NO-BID</Tag>
                </div>
                {s.reasoning && <p className="text-[12.5px] text-bw-body">{s.reasoning}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Documents + re-score loop */}
      <DocsPanel
        bidRequestId={req.id}
        docs={(docs ?? []).map((d) => ({ filename: d.filename, bytes: d.bytes, pageCount: d.page_count }))}
        processing={req.status === "processing"}
      />

      {/* 2 · Document gaps */}
      <section className="mb-9">
        <div className="flex items-baseline gap-2 mb-1">
          <h2 className="text-[1.2rem] font-extrabold tracking-tight">Document gaps</h2>
          <span className="text-[13px] text-bw-muted">— completeness of the package</span>
        </div>
        <p className="text-[13px] text-bw-body mb-4">
          A <span className="font-medium text-bw-text">critical</span> gap blocks dispatch; warnings dispatch with a caveat.
        </p>

        {gaps.length === 0 ? (
          <div className="bg-white rounded-2xl border border-bw-border border-l-4 border-l-bw-green p-4 text-[13px] text-bw-body">
            No gaps detected{scores.length === 0 ? " yet" : ""}. {scores.length > 0 ? "Nothing blocks dispatch." : ""}
          </div>
        ) : (
          <div className="space-y-3">
            {[...criticalGaps, ...warningGaps].map((g, i) => {
              const critical = g.severity === "critical";
              const acknowledged = critical && g.acknowledged;
              const tone = acknowledged ? "green" : critical ? "red" : "amber";
              return (
                <div
                  key={i}
                  className={`bg-white rounded-2xl border p-4 border-l-4 ${acknowledged ? "border-bw-border border-l-bw-green" : critical ? "border-bw-red/40 border-l-bw-red" : "border-bw-border border-l-bw-amber"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <Tag tone={tone}>{acknowledged ? "ACKNOWLEDGED" : critical ? "CRITICAL" : "WARNING"}</Tag>
                      <div className="min-w-0">
                        <div className="font-semibold text-[14px]">{g.message}</div>
                        {g.kind && <div className="text-[11px] text-bw-muted font-mono mt-1">{g.kind}</div>}
                      </div>
                    </div>
                    {!critical && (
                      <span className="text-[12px] font-medium text-bw-body bg-bw-surface border border-bw-border rounded-full px-3 py-1.5 flex-shrink-0">
                        Will caveat
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {blockingGaps.length > 0 && (
              <form action={async () => { "use server"; await acknowledgeGaps(req.id); }} className="flex items-center justify-between gap-3 bg-bw-red-tint/40 border border-bw-red/30 rounded-2xl px-4 py-3">
                <p className="text-[12.5px] text-bw-body">
                  The resolution loop (upload the missing doc → re-score) lands in Stage 3. To dispatch now, acknowledge that you&apos;re pricing off the available evidence — the contractor confirms at review.
                </p>
                <button className="flex-shrink-0 inline-flex items-center gap-2 bg-bw-text text-white font-semibold text-[13px] px-4 py-2 rounded-full transition hover:bg-bw-green">
                  Acknowledge &amp; enable dispatch
                </button>
              </form>
            )}
          </div>
        )}
      </section>

      {/* 3 · Dispatch fan-out */}
      <section className="mb-9">
        <div className="flex items-baseline gap-2 mb-1">
          <h2 className="text-[1.2rem] font-extrabold tracking-tight">Dispatch</h2>
          <span className="text-[13px] text-bw-muted">— one priced proposal per matched contractor in range</span>
        </div>
        <p className="text-[13px] text-bw-body mb-4">
          Each contractor gets a draft priced from their own Pricing DNA. Nothing sends until they approve it.
        </p>
        <DispatchPanel
          bidRequestId={req.id}
          groups={groups}
          hasCriticalGap={blockingGaps.length > 0}
          warningCount={warningGaps.length}
        />
      </section>

      {/* 4 · Contacts found */}
      <section className="mb-4">
        <div className="flex items-baseline gap-2 mb-1">
          <h2 className="text-[1.2rem] font-extrabold tracking-tight">Contacts found</h2>
          <span className="text-[13px] text-bw-muted">— extracted from this package</span>
        </div>
        <p className="text-[13px] text-bw-body mb-4">
          The same read pulled out the project team. They flow into in-area contractors&apos; Network as warm say-hi
          suggestions — a contact only counts if it has an email.
        </p>
        {withEmail.length === 0 ? (
          <div className="bg-white rounded-2xl border border-bw-border p-6 text-[13px] text-bw-body">
            No contacts with an email captured {scores.length === 0 ? "yet" : "from this package"}.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-bw-border overflow-hidden">
            <div className="px-5 py-3 border-b border-bw-border bg-bw-surface/50 text-[12px] font-semibold text-bw-muted uppercase tracking-wider">
              {withEmail.length} with email
            </div>
            <div className="divide-y divide-bw-border">
              {withEmail.map((c, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <div className="w-9 h-9 rounded-xl bg-bw-blue-tint text-bw-blue flex items-center justify-center font-bold text-[12px] flex-shrink-0">
                    {initials(c.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-[14px] truncate">{c.name}</span>
                      <span className="hidden sm:inline text-[12px] text-bw-muted truncate">
                        {[c.role, c.company].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <div className="text-[12px] text-bw-body truncate mt-0.5">{c.email}</div>
                  </div>
                  {c.found_in && (
                    <span className="hidden md:block text-[11px] text-bw-muted font-mono text-right">{c.found_in}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
