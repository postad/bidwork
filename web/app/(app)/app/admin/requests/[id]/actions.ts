"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") throw new Error("Forbidden — operators only");
  return supabase;
}

/**
 * Dispatch selected priced drafts to their contractors. Each becomes `ready` —
 * visible in that contractor's dashboard for review (nothing auto-sends). Writes
 * one bid_usage_event per dispatched bid (metering ledger; enforcement is Stage 5).
 * Severity gate: a critical, unresolved gap blocks the whole dispatch.
 */
export async function dispatchBids(bidRequestId: string, bidIds: string[]) {
  const supabase = await requireAdmin();

  if (!bidIds.length) throw new Error("Select at least one contractor to dispatch.");

  // Re-check gating server-side — never trust the client's enabled button.
  const { data: req, error: rErr } = await supabase
    .from("bid_requests")
    .select("doc_gaps")
    .eq("id", bidRequestId)
    .single();
  if (rErr || !req) throw new Error(rErr?.message ?? "Bid request not found");
  const gaps = Array.isArray(req.doc_gaps) ? (req.doc_gaps as { severity?: string }[]) : [];
  if (gaps.some((g) => g.severity === "critical")) {
    throw new Error("A critical gap blocks dispatch. Resolve it first.");
  }

  // Only dispatch draft bids that actually belong to this request (defends against stale ids).
  const { data: bids, error: bErr } = await supabase
    .from("bids")
    .select("id, workspace_id, status")
    .eq("bid_request_id", bidRequestId)
    .in("id", bidIds);
  if (bErr) throw new Error(bErr.message);
  const dispatchable = (bids ?? []).filter((b) => b.status === "draft");
  if (!dispatchable.length) throw new Error("No draft bids to dispatch (already dispatched, or pricing still pending).");

  const now = new Date().toISOString();

  const { error: uErr } = await supabase
    .from("bids")
    .update({ status: "ready", counted_at: now })
    .in("id", dispatchable.map((b) => b.id));
  if (uErr) throw new Error(`dispatch bids: ${uErr.message}`);

  // Metering ledger — one row per billable bid. bid_id is unique, so re-dispatch won't double-count.
  const { error: lErr } = await supabase.from("bid_usage_events").insert(
    dispatchable.map((b) => ({ workspace_id: b.workspace_id, bid_id: b.id, counted_at: now })),
  );
  if (lErr) throw new Error(`write usage ledger: ${lErr.message}`);

  const { error: sErr } = await supabase
    .from("bid_requests")
    .update({ status: "dispatched" })
    .eq("id", bidRequestId);
  if (sErr) throw new Error(`update request status: ${sErr.message}`);

  revalidatePath(`/app/admin/requests/${bidRequestId}`);
  revalidatePath("/app/admin");
  return { dispatched: dispatchable.length };
}
