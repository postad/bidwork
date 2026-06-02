"use server";

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
  return user;
}

/**
 * Step 1: create the bid_request and mint a signed upload URL per file. The
 * browser uploads the (potentially large) files straight to Storage with these.
 */
export async function createBidRequest(input: {
  title: string;
  zip: string;
  radius: number;
  files: { name: string }[];
}) {
  const user = await requireAdmin();
  const db = engineDb();

  const { data: req, error } = await db
    .from("bid_requests")
    .insert({ title: input.title, center_zip: input.zip, radius_mi: input.radius, created_by: user.id, status: "processing" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const uploads: { name: string; path: string; token: string }[] = [];
  for (const f of input.files) {
    const safe = f.name.replace(/[^\w.\-]+/g, "_");
    const path = `${req.id}/${safe}`;
    const { data, error: e } = await db.storage.from("bid-docs").createSignedUploadUrl(path);
    if (e || !data) throw new Error(e?.message ?? "Could not create upload URL");
    uploads.push({ name: f.name, path, token: data.token });
  }
  return { bidRequestId: req.id as string, uploads };
}

/**
 * Step 2: after the browser finishes uploading, record the documents and kick
 * off the multi-trade scan (Trigger.dev). Requires TRIGGER_SECRET_KEY in env.
 */
export async function finalizeBidRequest(
  bidRequestId: string,
  files: { name: string; path: string; size: number }[],
) {
  await requireAdmin();
  const db = engineDb();

  const { error } = await db.from("documents").insert(
    files.map((f) => ({ bid_request_id: bidRequestId, filename: f.name, storage_path: f.path, bytes: f.size })),
  );
  if (error) throw new Error(error.message);

  await tasks.trigger<typeof scanRequest>("engine.scan-request", { bidRequestId });
  return { ok: true };
}
