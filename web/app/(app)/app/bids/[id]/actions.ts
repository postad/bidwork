"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendViaMailgun } from "@/lib/email";

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
    .select("id, status, workspace_id, trade_id, bid_request_id, discount_label, delivery_install, tax_rate, gc_contact_email, project_name")
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

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Pillar 3 — learn priced corrections. When a contractor sets a price on a line the
 * engine flagged "needs your price" (a product not in their rate card), add it to
 * their card for this trade so the NEXT bid's AI match auto-prices it. Flooring stores
 * {name, perSqft}; WT stores {name, prices:{small,standard,large}} — same SYS row the
 * loaders read. We only ADD new products (never overwrite an existing one).
 */
async function learnPricedProducts(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  tradeId: string,
  learned: { name: string; price: number }[],
  project: string | null,
) {
  if (!learned.length) return;
  const { data: trade } = await supabase.from("trades").select("category").eq("id", tradeId).single();
  const isWt = trade?.category === "window-treatments";

  const { data: sysRow } = await supabase
    .from("pricing_items")
    .select("pricing")
    .eq("workspace_id", workspaceId)
    .eq("trade_id", tradeId)
    .eq("code", "SYS")
    .maybeSingle();
  const bySystem = (((sysRow?.pricing as { bySystem?: Record<string, unknown>[] })?.bySystem) ?? []).slice();
  const have = new Set(bySystem.map((p) => normName(String(p.name ?? ""))));

  let changed = false;
  for (const item of learned) {
    const name = item.name.trim();
    if (!name || have.has(normName(name))) continue;
    // Tag provenance so the Settings → Proposal Learning tab can list what was learned.
    const learnedMeta = { learned: true, learnedFrom: project ?? null, learnedAt: new Date().toISOString() };
    bySystem.push(isWt ? { name, prices: { small: null, standard: item.price, large: null }, ...learnedMeta } : { name, perSqft: item.price, ...learnedMeta });
    have.add(normName(name));
    changed = true;
  }
  if (!changed) return;

  await supabase.from("pricing_items").upsert(
    {
      workspace_id: workspaceId,
      trade_id: tradeId,
      code: "SYS",
      label: isWt ? "Shade products ($/unit by size)" : "Floor systems ($/SF)",
      unit: isWt ? "per-unit" : "per-sqft",
      sell_price: null,
      pricing: { bySystem },
    },
    { onConflict: "workspace_id,trade_id,code" },
  );
}

/**
 * Persist the contractor's edits: rewrite line item qty/price/amount, recompute
 * the bid totals, and record field-level diffs in bid_edits (the learning loop).
 */
export async function saveBidEdits(bidId: string, lines: LineInput[], discountPct?: number, installFee?: number) {
  const { supabase, bid } = await loadOwnedBid(bidId);
  if (bid.status === "sent") throw new Error("This bid was already sent — it can't be edited.");

  // Discount is per-bid and editable. Clamp to a sane 0–100% and keep the label in sync.
  const pct = discountPct == null ? discountPctOf(bid.discount_label) : Math.min(1, Math.max(0, discountPct));
  // Delivery & install (the global charges total) is a per-bid override too.
  const install = installFee == null ? Number(bid.delivery_install ?? 0) : Math.max(0, installFee);

  const { data: existing } = await supabase
    .from("bid_line_items")
    .select("id, qty, unit_price, attrs")
    .eq("bid_id", bidId);
  const prev = new Map((existing ?? []).map((l) => [l.id, l]));

  // Lines the contractor removed in edit mode → delete them from the bid.
  const keep = new Set(lines.map((l) => l.id));
  const removed = (existing ?? []).filter((l) => !keep.has(l.id)).map((l) => l.id);
  if (removed.length) {
    const { error } = await supabase.from("bid_line_items").delete().in("id", removed).eq("bid_id", bidId);
    if (error) throw new Error(`remove lines: ${error.message}`);
  }

  const edits: { bid_id: string; line_item_id: string; category: string; field: string; old_value: unknown; new_value: unknown }[] = [];
  for (const l of lines) {
    const before = prev.get(l.id);
    const attrs = (before?.attrs ?? {}) as Record<string, unknown>;
    // Pricing a flagged "needs your price" line clears the flag (so the send gate passes).
    const nextAttrs = l.unitPrice > 0 && attrs.unpriced ? { ...attrs, unpriced: false } : attrs;
    const { error } = await supabase
      .from("bid_line_items")
      .update({ description: l.description, location: l.location, qty: l.qty, unit_price: l.unitPrice, amount: r2(l.qty * l.unitPrice), attrs: nextAttrs })
      .eq("id", l.id)
      .eq("bid_id", bidId);
    if (error) throw new Error(`update line: ${error.message}`);
    if (before && Number(before.qty) !== l.qty) edits.push({ bid_id: bidId, line_item_id: l.id, category: "quantity", field: "qty", old_value: before.qty, new_value: l.qty });
    if (before && Number(before.unit_price) !== l.unitPrice) edits.push({ bid_id: bidId, line_item_id: l.id, category: "price", field: "unit_price", old_value: before.unit_price, new_value: l.unitPrice });
  }
  if (edits.length) await supabase.from("bid_edits").insert(edits);

  // Pillar 3: a flagged "needs your price" line the contractor just priced → learn it
  // into their rate card so the next bid auto-prices it (the AI match consults the card).
  const learned = lines
    .map((l) => {
      const before = prev.get(l.id);
      const wasFlagged = (before?.attrs as { unpriced?: boolean } | undefined)?.unpriced;
      if (!wasFlagged || !(l.unitPrice > 0)) return null;
      const a = (before?.attrs ?? {}) as Record<string, unknown>;
      const name = (a.product as string) ?? (a.system as string) ?? (l.description ?? "").split(" — ")[0];
      return name ? { name: String(name).trim(), price: l.unitPrice } : null;
    })
    .filter((x): x is { name: string; price: number } => x !== null);
  await learnPricedProducts(supabase, bid.workspace_id as string, bid.trade_id as string, learned, bid.project_name ?? null);

  const p = priceFromLines(lines, pct, install, Number(bid.tax_rate ?? 0));
  const { error: bErr } = await supabase
    .from("bids")
    .update({ subtotal: p.subtotal, discount_amount: p.discount, discount_label: `${Math.round(pct * 100)}%`, delivery_install: install, tax_amount: p.tax, total: p.total })
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

  // The proposal = all this sub's bids (sections) for the same request — send as ONE.
  const { data: group, error: gErr } = await supabase
    .from("bids")
    .select("id, status, gc_contact_email")
    .eq("bid_request_id", bid.bid_request_id)
    .eq("workspace_id", bid.workspace_id);
  if (gErr || !group?.length) throw new Error(gErr?.message ?? "Proposal not found");
  if (group.some((g) => g.status === "sent")) throw new Error("This proposal was already sent.");
  const gcEmail = bid.gc_contact_email ?? group.find((g) => g.gc_contact_email)?.gc_contact_email ?? null;
  if (!gcEmail) throw new Error("No GC email on this proposal — can't send.");

  // Don't let a "needs your price" line (any section) reach the GC.
  const groupIds = group.map((g) => g.id);
  const { data: flagged } = await supabase.from("bid_line_items").select("attrs").in("bid_id", groupIds);
  if ((flagged ?? []).some((l) => (l.attrs as { unpriced?: boolean })?.unpriced)) {
    throw new Error('Some lines still say "needs your price." Price or remove them in Edit before sending.');
  }

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

  const { delivered, messageId } = await sendViaMailgun({
    to: gcEmail,
    replyTo,
    subject: email.subject,
    body: email.body,
    cc: email.ccMe ? replyTo : null,
    fromName: profile?.company_name ?? null,
  });

  // One email record for the whole proposal (anchored to the clicked section).
  const { error: eErr } = await supabase.from("emails").insert({
    workspace_id: profile?.workspace_id,
    stream: "bid",
    bid_id: bidId,
    to_email: gcEmail,
    reply_to: replyTo,
    subject: email.subject,
    status: delivered ? "delivered" : "queued",
    mailgun_message_id: messageId,
  });
  if (eErr) throw new Error(`record email: ${eErr.message}`);

  // Mark every section sent.
  const { error: bErr } = await supabase
    .from("bids")
    .update({ status: "sent", sent_at: now, boilerplate_snapshot: boilerplate })
    .in("id", groupIds);
  if (bErr) throw new Error(`mark sent: ${bErr.message}`);

  revalidatePath(`/app/bids/${bidId}`);
  revalidatePath("/app");
  return { sent: true, delivered };
}
