import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NetworkList, type NetContact } from "./NetworkList";

export default async function NetworkPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("workspace_id, company_name, reply_to_email, email")
    .eq("id", user.id)
    .single();
  if (!profile?.workspace_id) redirect("/app");

  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, name, role, company, email, found_in, source_bid_request_id, in_network")
    .not("email", "is", null)
    .order("created_at", { ascending: false });
  const list = contacts ?? [];

  // Outreach status per contact + project titles for "found in".
  const [{ data: emails }, { data: reqs }] = await Promise.all([
    supabase.from("emails").select("contact_id, status").eq("stream", "outreach"),
    list.some((c) => c.source_bid_request_id)
      ? supabase.from("bid_requests").select("id, title").in("id", list.map((c) => c.source_bid_request_id).filter(Boolean) as string[])
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
  ]);
  const statusByContact = new Map((emails ?? []).map((e) => [e.contact_id, e.status]));
  const titleById = new Map((reqs ?? []).map((r) => [r.id, r.title]));

  const contactsOut: NetContact[] = list.map((c) => ({
    id: c.id,
    name: c.name,
    role: c.role ?? "Other",
    company: c.company,
    email: c.email as string,
    foundIn: c.found_in,
    project: c.source_bid_request_id ? titleById.get(c.source_bid_request_id) ?? null : null,
    inNetwork: c.in_network,
    status: (statusByContact.get(c.id) as string | undefined) ?? null,
  }));

  const stats = {
    peopleFound: contactsOut.length,
    saidHi: contactsOut.filter((c) => c.inNetwork).length,
    inNetwork: contactsOut.filter((c) => c.inNetwork).length,
    replies: contactsOut.filter((c) => c.status === "replied").length,
  };

  return (
    <NetworkList
      contacts={contactsOut}
      stats={stats}
      companyName={profile.company_name ?? "Your Company"}
      replyTo={profile.reply_to_email ?? profile.email ?? null}
    />
  );
}
