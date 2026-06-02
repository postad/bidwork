"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { engineDb } from "@/lib/engine/supabase";
import { tasks } from "@trigger.dev/sdk";
import type { extractPricing } from "@/trigger/engine";

async function requireContractor() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: profile } = await supabase.from("profiles").select("workspace_id, role").eq("id", user.id).single();
  if (!profile?.workspace_id) throw new Error("No workspace — onboarding is for contractor accounts.");
  return { supabase, workspaceId: profile.workspace_id as string };
}

async function wtTradeId(db: ReturnType<typeof engineDb>) {
  const { data: trade, error } = await db.from("trades").select("id").eq("slug", "window-treatments").single();
  if (error || !trade) throw new Error("window-treatments trade not found");
  return trade.id as string;
}

/** Step 1a: mint signed upload URLs for the contractor's past proposals. */
export async function createOnboardingUploads(workspaceArg: undefined, files: { name: string }[]) {
  const { workspaceId } = await requireContractor();
  const db = engineDb();
  const uploads: { name: string; path: string; token: string }[] = [];
  for (const f of files) {
    const safe = f.name.replace(/[^\w.\-]+/g, "_");
    const path = `onboarding/${workspaceId}/${Date.now()}_${safe}`;
    const { data, error } = await db.storage.from("bid-docs").createSignedUploadUrl(path);
    if (error || !data) throw new Error(error?.message ?? "Could not create upload URL");
    uploads.push({ name: f.name, path, token: data.token });
  }
  return { uploads };
}

/** Step 1b: after the browser uploads, kick off the pricing-DNA extraction. */
export async function startPricingExtraction(storagePaths: string[]) {
  const { workspaceId } = await requireContractor();
  const db = engineDb();
  // Mark extracting immediately so the UI can show progress before the worker picks up.
  const { data: ws } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();
  const settings = (ws?.settings ?? {}) as Record<string, unknown>;
  await db.from("workspaces").update({ settings: { ...settings, pendingDna: { status: "extracting" } } }).eq("id", workspaceId);

  await tasks.trigger<typeof extractPricing>("engine.extract-pricing", { workspaceId, storagePaths });
  return { ok: true };
}

/** Polled by the confirm step until extraction finishes. */
export async function getPendingDna() {
  const { supabase, workspaceId } = await requireContractor();
  const { data: ws } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).single();
  const settings = (ws?.settings ?? {}) as Record<string, unknown>;
  return (settings.pendingDna ?? null) as Record<string, unknown> | null;
}

export type ConfirmDna = {
  motorizedByGanging: { shadesPerMotor: number; price: number }[];
  blindsByWidth: { maxWidthInches: number; price: number }[];
  fixedPanelPrice: number | null;
  installFee: number | null;
  discountPct: number | null;
  taxPct: number | null;
  paymentTerms: string | null;
  warranty: string | null;
  validityDays: number | null;
  exclusions: string[];
};

/** Step 2: write the confirmed Pricing DNA to pricing_items + boilerplate to settings. */
export async function confirmPricingDna(dna: ConfirmDna) {
  const { workspaceId } = await requireContractor();
  const db = engineDb();
  const tradeId = await wtTradeId(db);

  const byShadesPerMotor: Record<string, number> = {};
  for (const m of dna.motorizedByGanging) byShadesPerMotor[String(m.shadesPerMotor)] = m.price;
  const byWidthTier = [...dna.blindsByWidth].sort((a, b) => a.maxWidthInches - b.maxWidthInches);

  const rows: { workspace_id: string; trade_id: string; code: string; label: string; unit: string; sell_price: number | null; pricing: Record<string, unknown> }[] = [
    { workspace_id: workspaceId, trade_id: tradeId, code: "WT", label: "Motorized Roller Shade", unit: "per-motor-set", sell_price: null, pricing: { byShadesPerMotor } },
    { workspace_id: workspaceId, trade_id: tradeId, code: "MB", label: "Manual Aluminum Blind", unit: "per-blind", sell_price: null, pricing: { byWidthTier } },
  ];
  if (dna.fixedPanelPrice != null) rows.push({ workspace_id: workspaceId, trade_id: tradeId, code: "FPS", label: "Fixed Roller Shade", unit: "per-shade", sell_price: dna.fixedPanelPrice, pricing: {} });
  if (dna.installFee != null) rows.push({ workspace_id: workspaceId, trade_id: tradeId, code: "INSTALL", label: "Installation Fee", unit: "flat", sell_price: dna.installFee, pricing: {} });
  if (dna.taxPct != null) rows.push({ workspace_id: workspaceId, trade_id: tradeId, code: "TAX", label: "Sales Tax Rate", unit: "percent", sell_price: dna.taxPct, pricing: {} });
  if (dna.discountPct != null) rows.push({ workspace_id: workspaceId, trade_id: tradeId, code: "DISCOUNT", label: "Default Proposal Discount", unit: "percent", sell_price: dna.discountPct, pricing: {} });

  const { error } = await db.from("pricing_items").upsert(rows, { onConflict: "workspace_id,trade_id,code" });
  if (error) throw new Error(`save pricing: ${error.message}`);

  // Boilerplate → workspace settings; clear the staged DNA.
  const { data: ws } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();
  const settings = (ws?.settings ?? {}) as Record<string, unknown>;
  const next = {
    ...settings,
    boilerplate: { paymentTerms: dna.paymentTerms, warranty: dna.warranty, validityDays: dna.validityDays, exclusions: dna.exclusions },
    pendingDna: null,
  };
  await db.from("workspaces").update({ settings: next }).eq("id", workspaceId);

  revalidatePath("/app/onboarding");
  return { ok: true };
}

export type OnboardingOps = {
  defaultProduct: string;
  minCharge: number | null;
  leadTime: string | null;
  serviceArea: string | null;
  noBid: string[];
};

/** Step 3: save non-sensitive ops settings + mark onboarded. */
export async function saveOnboardingSettings(ops: OnboardingOps) {
  const { workspaceId } = await requireContractor();
  const db = engineDb();
  const { data: ws } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();
  const settings = (ws?.settings ?? {}) as Record<string, unknown>;
  await db.from("workspaces").update({ settings: { ...settings, ops, onboardedAt: new Date().toISOString() } }).eq("id", workspaceId);
  revalidatePath("/app");
  return { ok: true };
}
