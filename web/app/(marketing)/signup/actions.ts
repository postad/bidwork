"use server";

import { engineDb } from "@/lib/engine/supabase";

/**
 * Create a brand-new contractor account in ONE atomic server step, using the
 * service-role admin API. This avoids the two fragile dependencies of a
 * client-side signUp: (1) the project's "Confirm email" toggle — we create the
 * user already email-confirmed, so a session is always obtainable; and (2) the
 * client→server session race — there is no session involved here, we provision by
 * the returned user id. If any tenant row fails we delete the auth user so the
 * email can be retried (no orphaned, half-created accounts).
 *
 * The browser signs in with the same credentials afterward to get its session.
 */
export async function signUpContractor(email: string, password: string, companyName: string) {
  const db = engineDb();
  const name = companyName?.trim() || email || "New contractor";

  const { data: created, error: cErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // pre-confirmed — no email round-trip, works regardless of project toggle
  });
  if (cErr || !created?.user) {
    const msg = cErr?.message ?? "Could not create account";
    if (/already|registered|exists|duplicate/i.test(msg)) throw new Error("That email already has an account — sign in instead.");
    throw new Error(msg);
  }
  const userId = created.user.id;

  try {
    const { data: ws, error: wErr } = await db.from("workspaces").insert({ name }).select("id").single();
    if (wErr || !ws) throw new Error(`create workspace: ${wErr?.message}`);

    const { error: pErr } = await db.from("profiles").insert({
      id: userId,
      workspace_id: ws.id,
      role: "contractor",
      email,
      company_name: name,
      full_name: name,
    });
    if (pErr) throw new Error(`create profile: ${pErr.message}`);

    const { error: sErr } = await db.from("subscriptions").insert({ workspace_id: ws.id, status: "trialing", trial_bids_limit: 3, trial_bids_used: 0 });
    if (sErr) throw new Error(`create subscription: ${sErr.message}`);
  } catch (e) {
    // Roll back the orphaned auth user so the email isn't permanently stuck.
    await db.auth.admin.deleteUser(userId).catch(() => {});
    throw e;
  }

  return { ok: true };
}
