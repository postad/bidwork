-- ============================================================================
-- BidWork — 0005 workspace settings (run after 0004). Idempotent.
-- Onboarding (Stage 2) needs a home for a tenant's boilerplate (terms/exclusions),
-- ops defaults (default product, min charge, lead time, service area, no-bid
-- categories), and the staged Pricing-DNA extraction awaiting confirmation.
-- Shape-varying → one JSONB blob on the workspace rather than many columns.
--   settings = {
--     boilerplate: { paymentTerms, warranty, validityDays, exclusions: [...], disclaimer },
--     ops:         { defaultProduct, minCharge, leadTime, serviceArea, noBid: [...] },
--     pendingDna:  { status: 'extracting'|'ready'|'error', error, ...extract, extractedAt },
--     onboardedAt
--   }
-- ============================================================================

alter table public.workspaces add column if not exists settings jsonb not null default '{}'::jsonb;

-- One rate-card row per (workspace, trade, code) so onboarding can upsert the
-- confirmed Pricing DNA cleanly. Seed data already satisfies this.
do $$ begin
  alter table public.pricing_items add constraint pricing_items_ws_trade_code_uniq unique (workspace_id, trade_id, code);
exception when duplicate_object then null; end $$;
