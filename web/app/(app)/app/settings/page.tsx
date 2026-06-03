import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "./SettingsForm";

export default async function SettingsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("workspace_id, company_name, website, address, description, reply_to_email")
    .eq("id", user.id)
    .single();
  if (!profile?.workspace_id) redirect("/app");

  const { data: ws } = await supabase.from("workspaces").select("settings").eq("id", profile.workspace_id).single();
  const bp = ((ws?.settings as Record<string, unknown>)?.boilerplate ?? {}) as Record<string, unknown>;

  return (
    <SettingsForm
      branding={{
        companyName: profile.company_name ?? "",
        website: profile.website ?? "",
        address: profile.address ?? "",
        description: profile.description ?? "",
        replyToEmail: profile.reply_to_email ?? "",
      }}
      boilerplate={{
        paymentTerms: (bp.paymentTerms as string) ?? "",
        warranty: (bp.warranty as string) ?? "",
        validityDays: (bp.validityDays as number) ?? null,
        exclusions: (bp.exclusions as string[]) ?? [],
        disclaimer: (bp.disclaimer as string) ?? "",
      }}
    />
  );
}
