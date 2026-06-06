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

type TradeRow = { id: string; slug: string; label: string; category: string | null; category_label: string | null };

/** The trades a workspace has opted into (workspace_trades → trades catalog). */
async function workspaceTradeRows(db: ReturnType<typeof engineDb>, workspaceId: string): Promise<TradeRow[]> {
  const { data: wt, error } = await db.from("workspace_trades").select("trade_id").eq("workspace_id", workspaceId);
  if (error) throw new Error(`load workspace_trades: ${error.message}`);
  const ids = (wt ?? []).map((r) => r.trade_id as string);
  if (!ids.length) return [];
  const { data: trades, error: tErr } = await db.from("trades").select("id, slug, label, category, category_label").in("id", ids);
  if (tErr) throw new Error(`load trades: ${tErr.message}`);
  return (trades ?? []) as TradeRow[];
}

/** The signup picker's catalog — supported categories and their sub-trades (chips).
 *  Restricted to categories that have a live pipeline (window-treatments, flooring). */
export async function getTradeCatalog() {
  await requireContractor();
  const db = engineDb();
  const { data, error } = await db
    .from("trades")
    .select("slug, label, category, category_label")
    .eq("active", true)
    .in("category", ["window-treatments", "flooring"])
    .order("label");
  if (error) throw new Error(`load catalog: ${error.message}`);

  const byCat = new Map<string, { category: string; label: string; trades: { slug: string; label: string }[] }>();
  for (const t of data ?? []) {
    const cat = t.category as string | null;
    if (!cat) continue;
    if (!byCat.has(cat)) byCat.set(cat, { category: cat, label: (t.category_label as string) ?? cat, trades: [] });
    byCat.get(cat)!.trades.push({ slug: t.slug as string, label: t.label as string });
  }
  return [...byCat.values()];
}

/** Picker submit: write the chosen sub-trades (+ service area) to workspace_trades. */
export async function selectSubTrades(slugs: string[], centerZip: string | null, radiusMi: number) {
  const { workspaceId } = await requireContractor();
  const db = engineDb();
  if (!slugs.length) throw new Error("Pick at least one sub-trade.");

  const { data: trades, error } = await db.from("trades").select("id, slug").in("slug", slugs);
  if (error) throw new Error(`resolve trades: ${error.message}`);
  const rows = (trades ?? []).map((t) => ({ workspace_id: workspaceId, trade_id: t.id, center_zip: centerZip, radius_mi: radiusMi }));
  const { error: uErr } = await db.from("workspace_trades").upsert(rows, { onConflict: "workspace_id,trade_id" });
  if (uErr) throw new Error(`save trades: ${uErr.message}`);

  revalidatePath("/app/onboarding");
  return { ok: true };
}

/** Drives the onboarding wizard: which category this contractor is training, and
 *  the sub-trades they cover. Onboarding trains one category at a time. */
export async function getOnboardingContext() {
  const { workspaceId } = await requireContractor();
  const db = engineDb();
  const trades = await workspaceTradeRows(db, workspaceId);
  const category = trades[0]?.category ?? null;
  return {
    category,
    categoryLabel: trades[0]?.category_label ?? null,
    subTrades: trades.filter((t) => t.category === category).map((t) => ({ slug: t.slug, label: t.label })),
  };
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

/** Step 1b: after the browser uploads, kick off the pricing-DNA extraction for the
 *  contractor's category (flooring recovers a per-SF rate card; WT recovers shades). */
export async function startPricingExtraction(storagePaths: string[], category: string) {
  const { workspaceId } = await requireContractor();
  const db = engineDb();
  // Mark extracting immediately so the UI can show progress before the worker picks up.
  const { data: ws } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();
  const settings = (ws?.settings ?? {}) as Record<string, unknown>;
  await db.from("workspaces").update({ settings: { ...settings, pendingDna: { status: "extracting", category } } }).eq("id", workspaceId);

  await tasks.trigger<typeof extractPricing>("engine.extract-pricing", { workspaceId, storagePaths, category });
  return { ok: true };
}

/** Polled by the confirm step until extraction finishes. */
export async function getPendingDna() {
  const { supabase, workspaceId } = await requireContractor();
  const { data: ws } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).single();
  const settings = (ws?.settings ?? {}) as Record<string, unknown>;
  return (settings.pendingDna ?? null) as Record<string, unknown> | null;
}

export type ConfirmWtDna = {
  products: { name: string; perShade: number }[];
  mobilizationFee: number | null;
  discountPct: number | null;
  taxPct: number | null;
  paymentTerms: string | null;
  warranty: string | null;
  validityDays: number | null;
  exclusions: string[];
};

/** WT training: write the confirmed per-PRODUCT ($/shade) rate card to pricing_items
 *  for EACH window-treatments sub-trade the workspace covers, plus boilerplate to
 *  settings. Same codes/shape as flooring (SYS/MOB/TAX/DISCOUNT) — SYS.bySystem
 *  entries carry `perShade`. Mirrors confirmFlooringPricingDna. */
export async function confirmWtPricingDna(dna: ConfirmWtDna) {
  const { workspaceId } = await requireContractor();
  const db = engineDb();
  const wtTrades = (await workspaceTradeRows(db, workspaceId)).filter((t) => t.category === "window-treatments");
  if (!wtTrades.length) throw new Error("No window-treatments sub-trades selected for this workspace.");

  const products = dna.products.filter((p) => p.name && p.perShade != null);
  // Guard: a confirm writes SYS to EVERY covered WT trade, so an empty extraction
  // would wipe a card you already trained. Refuse rather than silently overwrite.
  if (!products.length) {
    throw new Error("No shade products were found in those proposals — nothing to save here. Add or edit your products in Settings → Edit full pricing model.");
  }
  type Row = { workspace_id: string; trade_id: string; code: string; label: string; unit: string; sell_price: number | null; pricing: Record<string, unknown> };
  const rows: Row[] = [];
  for (const t of wtTrades) {
    rows.push({ workspace_id: workspaceId, trade_id: t.id, code: "SYS", label: "Shade products ($/shade)", unit: "per-shade", sell_price: null, pricing: { bySystem: products } });
    if (dna.mobilizationFee != null) rows.push({ workspace_id: workspaceId, trade_id: t.id, code: "MOB", label: "Mobilization Fee", unit: "flat", sell_price: dna.mobilizationFee, pricing: {} });
    if (dna.taxPct != null) rows.push({ workspace_id: workspaceId, trade_id: t.id, code: "TAX", label: "Sales Tax Rate", unit: "percent", sell_price: dna.taxPct, pricing: {} });
    if (dna.discountPct != null) rows.push({ workspace_id: workspaceId, trade_id: t.id, code: "DISCOUNT", label: "Default Proposal Discount", unit: "percent", sell_price: dna.discountPct, pricing: {} });
  }

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

export type ConfirmFlooringDna = {
  systems: { name: string; perSqft: number }[];
  prepPerSqft: number | null;
  baseTrimPerLf: number | null;
  mobilizationFee: number | null;
  discountPct: number | null;
  taxPct: number | null;
  paymentTerms: string | null;
  warranty: string | null;
  validityDays: number | null;
  exclusions: string[];
};

/** Flooring training: write the confirmed per-SF rate card to pricing_items for EACH
 *  flooring sub-trade the workspace covers (epoxy/carpet/… share one system list in
 *  v1), plus boilerplate to settings. Codes: SYS/PREP/BASE/MOB/TAX/DISCOUNT. */
export async function confirmFlooringPricingDna(dna: ConfirmFlooringDna) {
  const { workspaceId } = await requireContractor();
  const db = engineDb();
  const flooringTrades = (await workspaceTradeRows(db, workspaceId)).filter((t) => t.category === "flooring");
  if (!flooringTrades.length) throw new Error("No flooring sub-trades selected for this workspace.");

  const systems = dna.systems.filter((s) => s.name && s.perSqft != null);
  // Guard: a confirm writes SYS to EVERY covered flooring trade, so an empty
  // extraction would wipe rate cards you already trained. If nothing was found,
  // refuse and point to the editor — never silently overwrite good cards.
  if (!systems.length) {
    throw new Error("No floor systems were found in those proposals — nothing to save here. Add or edit your systems in Settings → Edit full pricing model.");
  }
  type Row = { workspace_id: string; trade_id: string; code: string; label: string; unit: string; sell_price: number | null; pricing: Record<string, unknown> };
  const rows: Row[] = [];
  for (const t of flooringTrades) {
    rows.push({ workspace_id: workspaceId, trade_id: t.id, code: "SYS", label: "Floor systems ($/SF)", unit: "per-sqft", sell_price: null, pricing: { bySystem: systems } });
    if (dna.prepPerSqft != null) rows.push({ workspace_id: workspaceId, trade_id: t.id, code: "PREP", label: "Substrate Prep", unit: "per-sqft", sell_price: dna.prepPerSqft, pricing: {} });
    if (dna.baseTrimPerLf != null) rows.push({ workspace_id: workspaceId, trade_id: t.id, code: "BASE", label: "Base / Trim", unit: "per-lf", sell_price: dna.baseTrimPerLf, pricing: {} });
    if (dna.mobilizationFee != null) rows.push({ workspace_id: workspaceId, trade_id: t.id, code: "MOB", label: "Mobilization Fee", unit: "flat", sell_price: dna.mobilizationFee, pricing: {} });
    if (dna.taxPct != null) rows.push({ workspace_id: workspaceId, trade_id: t.id, code: "TAX", label: "Sales Tax Rate", unit: "percent", sell_price: dna.taxPct, pricing: {} });
    if (dna.discountPct != null) rows.push({ workspace_id: workspaceId, trade_id: t.id, code: "DISCOUNT", label: "Default Proposal Discount", unit: "percent", sell_price: dna.discountPct, pricing: {} });
  }

  const { error } = await db.from("pricing_items").upsert(rows, { onConflict: "workspace_id,trade_id,code" });
  if (error) throw new Error(`save pricing: ${error.message}`);

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
