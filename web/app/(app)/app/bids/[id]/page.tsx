import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BidReview, type BidData } from "./BidReview";

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

  const { data: bid } = await supabase
    .from("bids")
    .select("id, status, project_name, gc_contact_name, gc_contact_email, bid_due_date, subtotal, discount_label, discount_amount, delivery_install, tax_rate, tax_amount, total, notes_to_gc, sent_at")
    .eq("id", params.id)
    .single();
  if (!bid) notFound();

  const { data: lines } = await supabase
    .from("bid_line_items")
    .select("id, sort_order, location, type_code, description, qty, unit, unit_price, amount, attrs")
    .eq("bid_id", bid.id)
    .order("sort_order", { ascending: true });

  const discountPct = parseFloat(String(bid.discount_label ?? "").replace(/[^0-9.]/g, "")) || 0;

  const data: BidData = {
    id: bid.id,
    status: bid.status,
    projectName: bid.project_name,
    gcName: bid.gc_contact_name,
    gcEmail: bid.gc_contact_email,
    bidDue: bid.bid_due_date,
    discountPct,
    discountLabel: bid.discount_label,
    deliveryInstall: Number(bid.delivery_install ?? 0),
    taxRate: Number(bid.tax_rate ?? 0),
    notesToGc: bid.notes_to_gc,
    sentAt: bid.sent_at,
    company: {
      name: profile?.company_name ?? "Your Company",
      replyTo: profile?.reply_to_email ?? profile?.email ?? null,
      website: profile?.website ?? null,
      address: profile?.address ?? null,
    },
    lines: (lines ?? []).map((l) => ({
      id: l.id,
      location: l.location,
      typeCode: l.type_code,
      description: l.description,
      qty: Number(l.qty ?? 0),
      unit: l.unit,
      unitPrice: Number(l.unit_price ?? 0),
      attrs: (l.attrs ?? {}) as Record<string, unknown>,
    })),
  };

  return <BidReview data={data} />;
}
