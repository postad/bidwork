"use server";

import { createClient } from "@/lib/supabase/server";
import { engineDb } from "@/lib/engine/supabase";

/**
 * Provision a brand-new contractor account after Supabase Auth signUp. Runs as the
 * just-signed-up user (session cookie set) but writes via the service-role client
 * (bypasses RLS — the established pattern for cross-table provisioning). Creates the
 * workspace + profile (contractor) + a trialing subscription. Idempotent: if a
 * profile already exists it reuses that workspace.
 *
 * NOTE: requires the session to exist — i.e. email-confirmation OFF in Supabase Auth
 * (see supabase/README.md). With confirmation ON, signUp returns no session and the
 * caller routes to "confirm your email" instead of calling this.
 */
export async function provisionWorkspace(companyName: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated — sign up first.");

  const db = engineDb();
  const { data: existing } = await db.from("profiles").select("workspace_id").eq("id", user.id).single();
  if (existing?.workspace_id) return { workspaceId: existing.workspace_id as string, existed: true };

  const name = companyName?.trim() || user.email || "New contractor";

  const { data: ws, error: wErr } = await db.from("workspaces").insert({ name }).select("id").single();
  if (wErr || !ws) throw new Error(`create workspace: ${wErr?.message}`);

  const { error: pErr } = await db.from("profiles").insert({
    id: user.id,
    workspace_id: ws.id,
    role: "contractor",
    email: user.email ?? null,
    company_name: name,
    full_name: name,
  });
  if (pErr) throw new Error(`create profile: ${pErr.message}`);

  // Trialing subscription (3 free bids), mirroring the seed fixture.
  const { error: sErr } = await db.from("subscriptions").insert({ workspace_id: ws.id, status: "trialing", trial_bids_limit: 3, trial_bids_used: 0 });
  if (sErr) throw new Error(`create subscription: ${sErr.message}`);

  return { workspaceId: ws.id as string, existed: false };
}
