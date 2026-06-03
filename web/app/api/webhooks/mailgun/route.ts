import crypto from "crypto";
import { engineDb } from "@/lib/engine/supabase";
import { normalizeMessageId } from "@/lib/email";

// Mailgun delivery/open webhooks → bid & outreach email status (✓ delivered, ✓✓ read).
// Unauthenticated endpoint, verified by Mailgun's HMAC signature. "Replied" is not
// here by design — replies go to the contractor's own inbox, not through Mailgun.

const RANK: Record<string, number> = { queued: 0, delivered: 1, read: 2, replied: 3 };

export async function POST(req: Request) {
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  if (!signingKey) return new Response("Mailgun webhook not configured", { status: 503 });

  let body: { signature?: { timestamp: string; token: string; signature: string }; "event-data"?: any };
  try {
    body = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const sig = body.signature;
  if (!sig?.timestamp || !sig?.token || !sig?.signature) return new Response("missing signature", { status: 400 });
  const computed = crypto.createHmac("sha256", signingKey).update(sig.timestamp + sig.token).digest("hex");
  // timing-safe compare
  const a = Buffer.from(computed);
  const b = Buffer.from(sig.signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return new Response("bad signature", { status: 401 });

  const ev = body["event-data"];
  const event: string = ev?.event ?? "";
  const messageId = normalizeMessageId(ev?.message?.headers?.["message-id"]);
  if (!messageId) return new Response("ok (no message-id)", { status: 200 });

  // Map Mailgun event → our status.
  const newStatus = event === "opened" ? "read" : event === "delivered" ? "delivered" : event === "failed" || event === "complained" ? "failed" : null;
  if (!newStatus) return new Response("ok (ignored event)", { status: 200 });

  const db = engineDb();
  const col = event === "opened" ? "read_at" : event === "delivered" ? "delivered_at" : null;

  const { data: rows } = await db.from("emails").select("id, status").eq("mailgun_message_id", messageId);
  for (const row of rows ?? []) {
    // Never downgrade (a late "delivered" must not clobber "read"); failures always set.
    if (newStatus !== "failed" && (RANK[newStatus] ?? 0) <= (RANK[row.status] ?? 0)) continue;
    const patch: Record<string, unknown> = { status: newStatus };
    if (col) patch[col] = new Date().toISOString();
    await db.from("emails").update(patch).eq("id", row.id);
  }

  return new Response("ok", { status: 200 });
}
