"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

async function requireWorkspace() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: profile } = await supabase.from("profiles").select("workspace_id").eq("id", user.id).single();
  if (!profile?.workspace_id) throw new Error("No workspace on this account.");
  return { supabase, workspaceId: profile.workspace_id as string };
}

/** Remove a learned product from the rate card. It drops off the Proposal Learning
 *  tab AND out of pricing (the engine stops auto-pricing it) — the contractor's
 *  explicit "no, don't keep that." */
export async function removeLearnedProduct(tradeId: string, name: string) {
  const { supabase, workspaceId } = await requireWorkspace();

  const { data: row } = await supabase
    .from("pricing_items")
    .select("pricing")
    .eq("workspace_id", workspaceId)
    .eq("trade_id", tradeId)
    .eq("code", "SYS")
    .maybeSingle();
  const bySystem = (((row?.pricing as { bySystem?: { name: string }[] })?.bySystem) ?? []).filter((p) => normName(String(p.name ?? "")) !== normName(name));

  const { error } = await supabase
    .from("pricing_items")
    .update({ pricing: { bySystem } })
    .eq("workspace_id", workspaceId)
    .eq("trade_id", tradeId)
    .eq("code", "SYS");
  if (error) throw new Error(`remove learned product: ${error.message}`);

  revalidatePath("/app/settings/learning");
  revalidatePath("/app/settings/pricing");
  return { ok: true };
}
