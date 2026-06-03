import "server-only";

export type MailgunResult = { delivered: boolean; messageId: string | null };

/** Strip Mailgun's angle brackets so the send id matches webhook message-ids. */
export const normalizeMessageId = (id: string | null | undefined) => (id ?? "").replace(/^<|>$/g, "") || null;

/**
 * Best-effort Mailgun send, shared by bid-send and network say-hi. Returns whether
 * it was actually delivered + the Mailgun message-id (used to correlate delivery/
 * open webhooks). If Mailgun isn't configured, returns {delivered:false} and the
 * caller still records the action. Reply-to routes replies to the contractor —
 * BidWork never sees the conversation.
 */
export async function sendViaMailgun(msg: {
  to: string;
  replyTo: string | null;
  subject: string;
  body: string;
  cc?: string | null;
}): Promise<MailgunResult> {
  const key = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const from = process.env.MAILGUN_FROM ?? (domain ? `BidWork <bids@${domain}>` : null);
  if (!key || !domain || !from) {
    console.warn("Mailgun not configured — recorded without external delivery.");
    return { delivered: false, messageId: null };
  }
  const form = new URLSearchParams();
  form.set("from", from);
  form.set("to", msg.to);
  if (msg.replyTo) form.set("h:Reply-To", msg.replyTo);
  if (msg.cc) form.set("cc", msg.cc);
  form.set("subject", msg.subject);
  form.set("text", msg.body);
  form.set("o:tracking-opens", "yes"); // enables the ✓✓ "read" signal
  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`api:${key}`).toString("base64")}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Mailgun ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { id?: string };
  return { delivered: true, messageId: normalizeMessageId(data.id) };
}
