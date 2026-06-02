import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/tag";

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, company_name")
    .eq("id", user.id)
    .single();

  // Operators land in the console, not the contractor dashboard.
  if (profile?.role === "admin") redirect("/app/admin");

  // RLS scopes this to the contractor's workspace automatically.
  const { data: bids } = await supabase
    .from("bids")
    .select("id, project_name, gc_contact_name, bid_due_date, total, status")
    .order("created_at", { ascending: false });

  const list = bids ?? [];
  const ready = list.filter((b) => b.status === "ready").length;
  const sent = list.filter((b) => b.status === "sent").length;
  const totalValue = list.reduce((a, b) => a + Number(b.total ?? 0), 0);

  const tiles = [
    ["New bids", ready],
    ["Sent", sent],
    ["All bids", list.length],
    ["Total value", `$${totalValue.toLocaleString()}`],
  ] as const;

  return (
    <div>
      <h1 className="text-[1.6rem] font-extrabold tracking-tight mb-1">
        {profile?.company_name ?? "Your bids"}
      </h1>
      <p className="text-[14px] text-bw-body mb-6">Your bids — new and in progress.</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {tiles.map(([label, value]) => (
          <Card key={label} className="p-4">
            <div className="text-[12px] text-bw-muted">{label}</div>
            <div className="text-[22px] font-extrabold tracking-tight font-mono">{value}</div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        {list.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-[15px] font-semibold mb-1">No bids yet</div>
            <p className="text-[13px] text-bw-body">
              When an operator dispatches a bid to you, it’ll appear here ready to review.
            </p>
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
                    <Link href={`/app/bids/${b.id}`} className="hover:text-bw-green hover:underline">
                      {b.project_name ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-bw-body">{b.gc_contact_name ?? "—"}</td>
                  <td className="px-4 py-3 text-bw-body">{b.bid_due_date ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {b.total ? `$${Number(b.total).toLocaleString()}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={b.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
