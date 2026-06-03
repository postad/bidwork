import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { StatusPill, Tag } from "@/components/ui/tag";
import { LearningCard, type LearningItem } from "./LearningCard";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, company_name, workspace_id").eq("id", user.id).single();
  if (profile?.role === "admin") redirect("/app/admin");

  const { data: bids } = await supabase
    .from("bids")
    .select("id, project_name, gc_contact_name, bid_due_date, total, status")
    .order("created_at", { ascending: false });
  const list = bids ?? [];

  // Reply-aware status: which bids' outbound email got a reply.
  const { data: bidEmails } = await supabase.from("emails").select("bid_id, status").eq("stream", "bid");
  const repliedBids = new Set((bidEmails ?? []).filter((e) => e.status === "replied").map((e) => e.bid_id));

  const ready = list.filter((b) => b.status === "ready").length;
  const sentBids = list.filter((b) => b.status === "sent");
  const awaitingReply = sentBids.filter((b) => !repliedBids.has(b.id)).length;
  const replied = sentBids.filter((b) => repliedBids.has(b.id)).length;
  const valueSent = sentBids.reduce((a, b) => a + Number(b.total ?? 0), 0);

  const tiles: [string, number | string, string][] = [
    ["Ready to review", ready, "new bids"],
    ["Awaiting reply", awaitingReply, "GCs"],
    ["Replied", replied, "conversations"],
    ["Bid value sent", usd(valueSent), ""],
  ];

  const learning = profile?.workspace_id ? await loadLearning(supabase) : [];

  return (
    <div>
      <h1 className="text-[1.6rem] font-extrabold tracking-tight mb-1">{profile?.company_name ?? "Your bids"}</h1>
      <p className="text-[14px] text-bw-body mb-6">Your bids — new and in progress.</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {tiles.map(([label, value, sub]) => (
          <Card key={label} className="p-4">
            <div className="text-[12px] text-bw-muted">{label}</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[22px] font-extrabold tracking-tight font-mono">{value}</span>
              {sub && <span className="text-[11px] text-bw-muted">{sub}</span>}
            </div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        {list.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-[15px] font-semibold mb-1">No bids yet</div>
            <p className="text-[13px] text-bw-body">When an operator dispatches a bid to you, it’ll appear here ready to review.</p>
          </div>
        ) : (
          <table className="w-full text-[14px]">
            <thead className="bg-bw-surface text-bw-muted text-[12px] uppercase tracking-wide">
              <tr>
                <th className="text-left font-semibold px-4 py-3">Project</th>
                <th className="text-left font-semibold px-4 py-3">GC</th>
                <th className="text-left font-semibold px-4 py-3">Due</th>
                <th className="text-right font-semibold px-4 py-3">Value</th>
                <th className="text-left font-semibold px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.id} className="border-t border-bw-border hover:bg-bw-surface">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/app/bids/${b.id}`} className="hover:text-bw-green hover:underline">{b.project_name ?? "—"}</Link>
                  </td>
                  <td className="px-4 py-3 text-bw-body">{b.gc_contact_name ?? "—"}</td>
                  <td className="px-4 py-3 text-bw-body">{b.bid_due_date ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-mono">{b.total ? usd(Number(b.total)) : "—"}</td>
                  <td className="px-4 py-3">
                    {repliedBids.has(b.id) ? <Tag tone="green">Replied</Tag> : <StatusPill status={b.status} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <LearningCard items={learning} />
    </div>
  );
}

/** Recent price edits that differ from the current rate card — i.e. unapplied
 *  learning signals the contractor can choose to teach back into their DNA. */
async function loadLearning(supabase: ReturnType<typeof createClient>): Promise<LearningItem[]> {
  const { data: trade } = await supabase.from("trades").select("id").eq("slug", "window-treatments").single();
  if (!trade) return [];

  const { data: priceItems } = await supabase
    .from("pricing_items")
    .select("code, pricing, sell_price")
    .eq("trade_id", trade.id);
  const wt = (priceItems?.find((p) => p.code === "WT")?.pricing as { byShadesPerMotor?: Record<string, number> } | undefined)?.byShadesPerMotor ?? {};
  const mbTiers = (priceItems?.find((p) => p.code === "MB")?.pricing as { byWidthTier?: { maxWidthInches: number; price: number }[] } | undefined)?.byWidthTier ?? [];
  const fps = priceItems?.find((p) => p.code === "FPS")?.sell_price ?? null;

  const { data: edits } = await supabase
    .from("bid_edits")
    .select("id, new_value, old_value, line_item_id, created_at")
    .eq("category", "price")
    .order("created_at", { ascending: false })
    .limit(40);
  if (!edits?.length) return [];

  const { data: lines } = await supabase
    .from("bid_line_items")
    .select("id, type_code, attrs, bid_id")
    .in("id", edits.map((e) => e.line_item_id).filter(Boolean) as string[]);
  const lineById = new Map((lines ?? []).map((l) => [l.id, l]));

  const { data: bidRows } = await supabase
    .from("bids")
    .select("id, project_name")
    .in("id", [...new Set((lines ?? []).map((l) => l.bid_id))]);
  const projectByBid = new Map((bidRows ?? []).map((b) => [b.id, b.project_name]));

  const items: LearningItem[] = [];
  const seen = new Set<string>();
  for (const e of edits) {
    const line = e.line_item_id ? lineById.get(e.line_item_id) : null;
    if (!line?.type_code) continue;
    const attrs = (line.attrs ?? {}) as { shadesPerMotor?: number; widthInches?: number };
    const newPrice = Number(e.new_value);
    let current: number | null = null;
    let label = "";
    if (line.type_code === "WT" && attrs.shadesPerMotor != null) {
      current = wt[String(attrs.shadesPerMotor)] ?? null;
      label = `Motorized — ${attrs.shadesPerMotor} on 1 motor`;
    } else if (line.type_code === "MB") {
      const w = Number(attrs.widthInches ?? 0);
      current = (mbTiers.find((t) => w <= t.maxWidthInches) ?? mbTiers[mbTiers.length - 1])?.price ?? null;
      label = `Manual blind${attrs.widthInches ? ` (${attrs.widthInches}" W)` : ""}`;
    } else if (line.type_code === "FPS") {
      current = fps != null ? Number(fps) : null;
      label = "Fixed panel shade";
    } else continue;

    // Only surface unapplied signals (new differs from the current rate). Dedupe by tier.
    const key = `${line.type_code}:${attrs.shadesPerMotor ?? attrs.widthInches ?? ""}`;
    if (current == null || newPrice === current || seen.has(key)) continue;
    seen.add(key);
    items.push({ editId: e.id, project: projectByBid.get(line.bid_id) ?? null, label, oldPrice: Number(e.old_value), newPrice });
  }
  return items;
}
