"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { engineDb } from "@/lib/engine/supabase";
import { tasks } from "@trigger.dev/sdk";
import type { scanRequest } from "@/trigger/engine";

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
 * Mint signed upload URLs to add document(s) to an existing request — the
 * missing-doc resolution loop (e.g. upload the architectural set ABH flagged).
 */
export async function createRequestUploads(bidRequestId: string, files: { name: string }[]) {
  await requireAdmin();
  const db = engineDb();
  const uploads: { name: string; path: string; token: string }[] = [];
  for (const f of files) {
    const safe = f.name.replace(/[^\w.\-]+/g, "_");
    const path = `${bidRequestId}/${Date.now()}_${safe}`;
    const { data, error } = await db.storage.from("bid-docs").createSignedUploadUrl(path);
    if (error || !data) throw new Error(error?.message ?? "Could not create upload URL");
    uploads.push({ name: f.name, path, token: data.token });
  }
  return { uploads };
}

/**
 * Record newly-added documents and re-run the engine over the WHOLE (now larger)
 * package: re-scan re-scores every trade and re-triggers extraction. This is the
 * re-score loop — a flagged-missing doc can flip a NO-BID to BID and clear gaps.
 */
export async function rescoreRequest(bidRequestId: string, files: { name: string; path: string; size: number }[]) {
  await requireAdmin();
  const db = engineDb();

  if (files.length) {
    const { error } = await db
      .from("documents")
      .insert(files.map((f) => ({ bid_request_id: bidRequestId, filename: f.name, storage_path: f.path, bytes: f.size })));
    if (error) throw new Error(`record documents: ${error.message}`);
  }

  // Clear stale gaps + flip to processing, then re-scan the full package.
  const { error: uErr } = await db.from("bid_requests").update({ status: "processing", doc_gaps: [] }).eq("id", bidRequestId);
  if (uErr) throw new Error(`reset request: ${uErr.message}`);

  await tasks.trigger<typeof scanRequest>("engine.scan-request", { bidRequestId });
  revalidatePath(`/app/admin/requests/${bidRequestId}`);
  revalidatePath("/app/admin");
  return { ok: true };
}

/**
 * Acknowledge the request's critical gaps so dispatch can proceed. The full
 * resolution loop (upload the missing doc → re-score) is Stage 3; here the
 * operator explicitly takes responsibility for the gap (e.g. "no shade schedule —
 * priced off the plan tags, contractor confirms"). Marks every critical gap
 * acknowledged; warnings still dispatch as caveats.
 */
export async function acknowledgeGaps(bidRequestId: string) {
  const supabase = await requireAdmin();
  const { data: req, error } = await supabase.from("bid_requests").select("doc_gaps").eq("id", bidRequestId).single();
  if (error || !req) throw new Error(error?.message ?? "Bid request not found");
  const gaps = (Array.isArray(req.doc_gaps) ? req.doc_gaps : []) as Record<string, unknown>[];
  const next = gaps.map((g) => (g.severity === "critical" ? { ...g, acknowledged: true } : g));
  const { error: uErr } = await supabase.from("bid_requests").update({ doc_gaps: next }).eq("id", bidRequestId);
  if (uErr) throw new Error(`acknowledge gaps: ${uErr.message}`);
  revalidatePath(`/app/admin/requests/${bidRequestId}`);
  return { acknowledged: next.filter((g) => g.severity === "critical").length };
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
  const gaps = Array.isArray(req.doc_gaps) ? (req.doc_gaps as { severity?: string; acknowledged?: boolean }[]) : [];
  if (gaps.some((g) => g.severity === "critical" && !g.acknowledged)) {
    throw new Error("A critical gap blocks dispatch. Acknowledge it first.");
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
