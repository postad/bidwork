"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendViaMailgun } from "@/lib/email";

/**
 * Send a warm "say hi" intro to a contact. Reply-to = the contractor (replies never
 * touch BidWork), records an outreach email, and the moment it goes out the contact
 * joins the workspace's network (in_network = true). One hello — not a sequence.
 */
export async function sayHi(contactId: string, email: { subject: string; body: string; ccMe: boolean }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: profile } = await supabase
    .from("profiles")
    .select("workspace_id, reply_to_email, email")
    .eq("id", user.id)
    .single();
  if (!profile?.workspace_id) throw new Error("No workspace on this account.");
  const replyTo = profile.reply_to_email ?? profile.email ?? null;

  // RLS scopes contacts to the workspace; this also gives us the email to send to.
  const { data: contact, error } = await supabase.from("contacts").select("id, name, email, in_network").eq("id", contactId).single();
  if (error || !contact) throw new Error(error?.message ?? "Contact not found");
  if (!contact.email) throw new Error("This contact has no email — nothing to say hi to.");
  if (contact.in_network) throw new Error("You've already said hi to this contact.");

  const { delivered, messageId } = await sendViaMailgun({ to: contact.email, replyTo, subject: email.subject, body: email.body, cc: email.ccMe ? replyTo : null });

  const { error: eErr } = await supabase.from("emails").insert({
    workspace_id: profile.workspace_id,
    stream: "outreach",
    contact_id: contactId,
    to_email: contact.email,
    reply_to: replyTo,
    subject: email.subject,
    status: delivered ? "delivered" : "queued",
    mailgun_message_id: messageId,
  });
  if (eErr) throw new Error(`record outreach: ${eErr.message}`);

  const { error: cErr } = await supabase.from("contacts").update({ in_network: true }).eq("id", contactId);
  if (cErr) throw new Error(`update contact: ${cErr.message}`);

  revalidatePath("/app/network");
  return { ok: true, delivered };
}
