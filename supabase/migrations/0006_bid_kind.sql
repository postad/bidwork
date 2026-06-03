-- ============================================================================
-- BidWork — 0006 bid kind (run after 0005). Idempotent.
-- A bid is either a normal 'priced' proposal or a 'site_visit' request: when a
-- trade scores BID but the package can't be quantified (scope named but no
-- schedule/plan/tags to count), the engine produces a no-price proposal that
-- shows the contractor read the project and asks to field-measure — warmer and
-- more credible than a cold intro. See SPEC-ADDITIONS.md #1.
-- ============================================================================

alter table public.bids add column if not exists kind text not null default 'priced';
