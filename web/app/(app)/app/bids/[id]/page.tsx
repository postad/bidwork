import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BidReview, type ProposalData, type ProposalSection, type BidLine } from "./BidReview";

export default async function BidPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_name, reply_to_email, email, website, address")
    .eq("id", user.id)
    .single();

  // The clicked bid identifies the proposal = all this sub's bids for the same request.
  const { data: anchor } = await supabase.from("bids").select("id, bid_request_id, workspace_id").eq("id", params.id).single();
  if (!anchor) notFound();

  const { data: bidRows } = await supabase
    .from("bids")
    .select("id, kind, status, project_name, gc_contact_name, gc_contact_email, bid_due_date, discount_label, delivery_install, tax_rate, notes_to_gc, sent_at, created_at, trades(label)")
    .eq("bid_request_id", anchor.bid_request_id)
    .eq("workspace_id", anchor.workspace_id)
    .order("created_at", { ascending: true });
  if (!bidRows?.length) notFound();

  const { data: ws } = await supabase.from("workspaces").select("settings").eq("id", anchor.workspace_id).single();
  const bp = ((ws?.settings as Record<string, unknown>)?.boilerplate ?? {}) as Record<string, unknown>;

  const { data: allLines } = await supabase
    .from("bid_line_items")
    .select("id, bid_id, sort_order, location, type_code, description, qty, unit, unit_price, amount, attrs")
    .in("bid_id", bidRows.map((b) => b.id))
    .order("sort_order", { ascending: true });
  const linesByBid = new Map<string, BidLine[]>();
  for (const l of allLines ?? []) {
    const arr = linesByBid.get(l.bid_id) ?? [];
    arr.push({
      id: l.id,
      location: l.location,
      typeCode: l.type_code,
      description: l.description,
      qty: Number(l.qty ?? 0),
      unit: l.unit,
      unitPrice: Number(l.unit_price ?? 0),
      attrs: (l.attrs ?? {}) as Record<string, unknown>,
    });
    linesByBid.set(l.bid_id, arr);
  }

  const pctOf = (label: string | null) => (parseFloat(String(label ?? "").replace(/[^0-9.]/g, "")) || 0) / 100;

  const sections: ProposalSection[] = bidRows.map((b) => ({
    bidId: b.id,
    tradeLabel: (b.trades as { label?: string } | null)?.label ?? "Scope",
    kind: b.kind ?? "priced",
    discountPct: pctOf(b.discount_label),
    discountLabel: b.discount_label,
    deliveryInstall: Number(b.delivery_install ?? 0),
    taxRate: Number(b.tax_rate ?? 0),
    notesToGc: b.notes_to_gc,
    lines: linesByBid.get(b.id) ?? [],
  }));

  // Group status: editable/sendable if any section is still a draft; sent once all sent.
  const statuses = new Set(bidRows.map((b) => b.status));
  const status = statuses.has("draft") ? "draft" : statuses.size === 1 && statuses.has("sent") ? "sent" : "ready";
  const first = bidRows[0];

  const data: ProposalData = {
    groupId: anchor.id,
    status,
    projectName: first.project_name,
    gcName: first.gc_contact_name,
    gcEmail: first.gc_contact_email,
    bidDue: first.bid_due_date,
    sentAt: bidRows.find((b) => b.sent_at)?.sent_at ?? null,
    company: {
      name: profile?.company_name ?? "Your Company",
      replyTo: profile?.reply_to_email ?? profile?.email ?? null,
      website: profile?.website ?? null,
      address: profile?.address ?? null,
    },
    boilerplate: {
      paymentTerms: (bp.paymentTerms as string) ?? null,
      warranty: (bp.warranty as string) ?? null,
      validityDays: (bp.validityDays as number) ?? null,
      exclusions: (bp.exclusions as string[]) ?? [],
      disclaimer: (bp.disclaimer as string) ?? null,
    },
    sections,
  };

  return <BidReview data={data} />;
}
