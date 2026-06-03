"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type Branding = {
  companyName: string;
  website: string | null;
  address: string | null;
  description: string | null;
  replyToEmail: string | null;
};

export type Boilerplate = {
  paymentTerms: string | null;
  warranty: string | null;
  validityDays: number | null;
  exclusions: string[];
  disclaimer: string | null;
};

/**
 * Save the contractor's branding (→ profiles) and proposal boilerplate
 * (→ workspaces.settings.boilerplate). Branding lands on the letterhead; the
 * boilerplate is reused on every generated proposal.
 */
export async function saveSettings(branding: Branding, boilerplate: Boilerplate) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: profile } = await supabase.from("profiles").select("workspace_id").eq("id", user.id).single();
  if (!profile?.workspace_id) throw new Error("No workspace on this account.");

  const { error: pErr } = await supabase
    .from("profiles")
    .update({
      company_name: branding.companyName,
      website: branding.website,
      address: branding.address,
      description: branding.description,
      reply_to_email: branding.replyToEmail,
    })
    .eq("id", user.id);
  if (pErr) throw new Error(`save branding: ${pErr.message}`);

  // Merge into the workspace settings blob (keep ops/onboardedAt/etc.).
  const { data: ws } = await supabase.from("workspaces").select("settings").eq("id", profile.workspace_id).single();
  const settings = (ws?.settings ?? {}) as Record<string, unknown>;
  const cleanExclusions = boilerplate.exclusions.map((e) => e.trim()).filter(Boolean);
  const { error: wErr } = await supabase
    .from("workspaces")
    .update({ settings: { ...settings, boilerplate: { ...boilerplate, exclusions: cleanExclusions } } })
    .eq("id", profile.workspace_id);
  if (wErr) throw new Error(`save boilerplate: ${wErr.message}`);

  revalidatePath("/app/settings");
  return { ok: true };
}
