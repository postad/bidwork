"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type LineInput = {
  id: string;
  location: string | null;
  description: string | null;
  qty: number;
  unitPrice: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

async function loadOwnedBid(bidId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  // RLS already scopes bids to the caller's workspace; this is a clear error if not.
  const { data: bid, error } = await supabase
    .from("bids")
    .select("id, status, discount_label, delivery_install, tax_rate, gc_contact_email, project_name")
    .eq("id", bidId)
    .single();
  if (error || !bid) throw new Error(error?.message ?? "Bid not found");
  return { supabase, user, bid };
}

function discountPctOf(label: string | null) {
  const n = parseFloat(String(label ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n / 100 : 0;
}

/** Recompute bid totals from edited line items + the bid's discount/install/tax,
 *  using the same order of operations as the engine's deterministic pricer. */
function priceFromLines(lines: LineInput[], discountPct: number, install: number, taxRate: number) {
  const products = r2(lines.reduce((a, l) => a + l.qty * l.unitPrice, 0));
  const discount = -Math.round(products * discountPct);
  const subtotal = r2(products + discount + install);
  const tax = r2(subtotal * taxRate);
  const total = r2(subtotal + tax);
  return { products, discount, subtotal, tax, total };
}

/**
 * Persist the contractor's edits: rewrite line item qty/price/amount, recompute
 * the bid totals, and record field-level diffs in bid_edits (the learning loop).
 */
export async function saveBidEdits(bidId: string, lines: LineInput[], discountPct?: number) {
  const { supabase, bid } = await loadOwnedBid(bidId);
  if (bid.status === "sent") throw new Error("This bid was already sent — it can't be edited.");

  // Discount is per-bid and editable. Clamp to a sane 0–100% and keep the label in sync.
  const pct = discountPct == null ? discountPctOf(bid.discount_label) : Math.min(1, Math.max(0, discountPct));

  const { data: existing } = await supabase
    .from("bid_line_items")
    .select("id, qty, unit_price")
    .eq("bid_id", bidId);
  const prev = new Map((existing ?? []).map((l) => [l.id, l]));

  const edits: { bid_id: string; line_item_id: string; category: string; field: string; old_value: unknown; new_value: unknown }[] = [];
  for (const l of lines) {
    const before = prev.get(l.id);
    const { error } = await supabase
      .from("bid_line_items")
      .update({ qty: l.qty, unit_price: l.unitPrice, amount: r2(l.qty * l.unitPrice) })
      .eq("id", l.id)
      .eq("bid_id", bidId);
    if (error) throw new Error(`update line: ${error.message}`);
    if (before && Number(before.qty) !== l.qty) edits.push({ bid_id: bidId, line_item_id: l.id, category: "quantity", field: "qty", old_value: before.qty, new_value: l.qty });
    if (before && Number(before.unit_price) !== l.unitPrice) edits.push({ bid_id: bidId, line_item_id: l.id, category: "price", field: "unit_price", old_value: before.unit_price, new_value: l.unitPrice });
  }
  if (edits.length) await supabase.from("bid_edits").insert(edits);

  const p = priceFromLines(lines, pct, Number(bid.delivery_install ?? 0), Number(bid.tax_rate ?? 0));
  const { error: bErr } = await supabase
    .from("bids")
    .update({ subtotal: p.subtotal, discount_amount: p.discount, discount_label: `${Math.round(pct * 100)}%`, tax_amount: p.tax, total: p.total })
    .eq("id", bidId);
  if (bErr) throw new Error(`update bid totals: ${bErr.message}`);

  revalidatePath(`/app/bids/${bidId}`);
  return { total: p.total };
}

/**
 * Approve and send the bid to the GC. Freezes a boilerplate snapshot, records the
 * outbound email (reply-to = contractor, never BidWork), and flips status → sent.
 * Actual delivery goes through Mailgun when configured; otherwise it's recorded as
 * sent without external delivery (wiring Mailgun creds is the remaining step).
 */
export async function approveAndSend(bidId: string, email: { subject: string; body: string; ccMe: boolean }) {
  const { supabase, user, bid } = await loadOwnedBid(bidId);
  if (bid.status === "sent") throw new Error("This bid was already sent.");
  if (!bid.gc_contact_email) throw new Error("No GC email on this bid — can't send.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("workspace_id, reply_to_email, email, company_name")
    .eq("id", user.id)
    .single();
  const replyTo = profile?.reply_to_email ?? profile?.email ?? null;

  const now = new Date().toISOString();
  const boilerplate = {
    terms: "50% deposit, 50% on completion. Valid 30 days.",
    warranty: "2 years labor · manufacturer warranty on product",
    frozenAt: now,
  };

  const delivered = await sendViaMailgun({
    to: bid.gc_contact_email,
    replyTo,
    subject: email.subject,
    body: email.body,
    cc: email.ccMe ? replyTo : null,
  });

  const { error: eErr } = await supabase.from("emails").insert({
    workspace_id: profile?.workspace_id,
    stream: "bid",
    bid_id: bidId,
    to_email: bid.gc_contact_email,
    reply_to: replyTo,
    subject: email.subject,
    status: delivered ? "delivered" : "queued",
  });
  if (eErr) throw new Error(`record email: ${eErr.message}`);

  const { error: bErr } = await supabase
    .from("bids")
    .update({ status: "sent", sent_at: now, boilerplate_snapshot: boilerplate })
    .eq("id", bidId);
  if (bErr) throw new Error(`mark sent: ${bErr.message}`);

  revalidatePath(`/app/bids/${bidId}`);
  revalidatePath("/app");
  return { sent: true, delivered };
}

/** Best-effort Mailgun send. Returns true if actually delivered, false if Mailgun
 *  isn't configured (the bid is still recorded as sent for the walking skeleton). */
async function sendViaMailgun(msg: { to: string; replyTo: string | null; subject: string; body: string; cc: string | null }): Promise<boolean> {
  const key = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const from = process.env.MAILGUN_FROM ?? (domain ? `BidWork <bids@${domain}>` : null);
  if (!key || !domain || !from) {
    console.warn("Mailgun not configured — bid recorded as sent without external delivery.");
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
