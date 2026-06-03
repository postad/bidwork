import "server-only";

/**
 * Best-effort Mailgun send, shared by bid-send and network say-hi. Returns true if
 * actually delivered, false if Mailgun isn't configured (callers still record the
 * action so the flow completes in the walking skeleton). Reply-to routes replies to
 * the contractor — BidWork never sees the conversation.
 */
export async function sendViaMailgun(msg: {
  to: string;
  replyTo: string | null;
  subject: string;
  body: string;
  cc?: string | null;
}): Promise<boolean> {
  const key = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const from = process.env.MAILGUN_FROM ?? (domain ? `BidWork <bids@${domain}>` : null);
  if (!key || !domain || !from) {
    console.warn("Mailgun not configured — recorded without external delivery.");
    return false;
  }
  const form = new URLSearchParams();
  form.set("from", from);
  form.set("to", msg.to);
  if (msg.replyTo) form.set("h:Reply-To", msg.replyTo);
  if (msg.cc) form.set("cc", msg.cc);
  form.set("subject", msg.subject);
  form.set("text", msg.body);
  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`api:${key}`).toString("base64")}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Mailgun ${res.status}: ${await res.text()}`);
  return true;
}
