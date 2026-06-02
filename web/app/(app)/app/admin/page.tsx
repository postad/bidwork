import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { Button } from "@/components/ui/button";

export default async function AdminQueuePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/app");

  const { data: requests } = await supabase
    .from("bid_requests")
    .select("id, title, status, center_zip, radius_mi, trade_scores, created_at")
    .order("created_at", { ascending: false });

  const list = requests ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[1.6rem] font-extrabold tracking-tight mb-1">Bid requests</h1>
          <p className="text-[14px] text-bw-body">
            Upload a package once — the system scores every trade and dispatches to matching contractors.
          </p>
        </div>
        <Link href="/app/admin/upload">
          <Button>New bid request</Button>
        </Link>
      </div>

      <Card className="overflow-hidden">
        {list.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-[15px] font-semibold mb-1">No bid requests yet</div>
            <p className="text-[13px] text-bw-body">
              Upload an ITB/RFP with a geo radius to start. (Upload + engine wiring lands in Stage 1.)
            </p>
          </div>
        ) : (
          <table className="w-full text-[14px]">
            <thead className="bg-bw-surface text-bw-muted text-[12px] uppercase tracking-wide">
              <tr>
                <th className="text-left font-semibold px-4 py-3">Request</th>
                <th className="text-left font-semibold px-4 py-3">Area</th>
                <th className="text-left font-semibold px-4 py-3">Trades matched</th>
                <th className="text-left font-semibold px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const scores = Array.isArray(r.trade_scores) ? (r.trade_scores as any[]) : [];
                const bids = scores.filter((s) => s.relevance === "bid").length;
                return (
                  <tr key={r.id} className="border-t border-bw-border hover:bg-bw-surface">
                    <td className="px-4 py-3 font-medium">{r.title}</td>
                    <td className="px-4 py-3 text-bw-body">
                      {r.radius_mi} mi · {r.center_zip ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-bw-body">
                      {bids} of {scores.length} trades
                    </td>
                    <td className="px-4 py-3">
                      <Tag tone={r.status === "needs_review" ? "amber" : r.status === "dispatched" ? "blue" : "neutral"}>
                        {r.status}
                      </Tag>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
