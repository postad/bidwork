import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LearningList, type LearnedItem } from "./LearningList";

export default async function ProposalLearningPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("workspace_id").eq("id", user.id).single();
  if (!profile?.workspace_id) redirect("/app");
  const workspaceId = profile.workspace_id as string;

  const { data: cov } = await supabase.from("workspace_trades").select("trade_id").eq("workspace_id", workspaceId);
  const tradeIds = (cov ?? []).map((c) => c.trade_id as string);
  const { data: trades } = tradeIds.length
    ? await supabase.from("trades").select("id, label, category").in("id", tradeIds)
    : { data: [] as { id: string; label: string; category: string | null }[] };
  const tradeById = new Map((trades ?? []).map((t) => [t.id, t]));

  const { data: rows } = tradeIds.length
    ? await supabase.from("pricing_items").select("trade_id, pricing").eq("workspace_id", workspaceId).eq("code", "SYS").in("trade_id", tradeIds)
    : { data: [] as { trade_id: string; pricing: unknown }[] };

  const items: LearnedItem[] = [];
  for (const r of rows ?? []) {
    const t = tradeById.get(r.trade_id);
    const isWt = t?.category === "window-treatments";
    const bySystem = ((r.pricing as { bySystem?: Array<{ name: string; perSqft?: number; prices?: { standard?: number | null }; learned?: boolean; learnedFrom?: string | null; learnedAt?: string }> })?.bySystem) ?? [];
    for (const p of bySystem) {
      if (!p.learned) continue;
      items.push({
        tradeId: r.trade_id,
        tradeLabel: t?.label ?? "Trade",
        name: p.name,
        price: isWt ? Number(p.prices?.standard ?? 0) : Number(p.perSqft ?? 0),
        unit: isWt ? "each" : "/SF",
        learnedFrom: p.learnedFrom ?? null,
        learnedAt: p.learnedAt ?? null,
      });
    }
  }
  items.sort((a, b) => (b.learnedAt ?? "").localeCompare(a.learnedAt ?? ""));

  return (
    <div className="max-w-[760px] mx-auto">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h1 className="text-[1.8rem] font-extrabold tracking-tight">Proposal learning</h1>
        <a href="/app/settings" className="text-[13px] font-semibold text-bw-body hover:text-bw-text">← Settings</a>
      </div>
      <p className="text-[14px] text-bw-body mb-6">
        Products BidWork <span className="text-bw-text font-medium">learned from your proposals</span> — added to your pricing when you priced a flagged line. They auto-price on future bids. Remove any you don&apos;t want kept.
      </p>
      <LearningList items={items} />
    </div>
  );
}
