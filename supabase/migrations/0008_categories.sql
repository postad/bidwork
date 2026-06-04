-- ============================================================================
-- BidWork — 0008 trade categories (run after 0007). Idempotent.
-- Adds a category dimension over the flat `trades` table so the signup picker can
-- group sub-trades (Window Treatments, Flooring, …) and the engine can pick a
-- pipeline by category. `category` is the engine/registry key (one shared pipeline
-- per category); `category_label` is the human label shown at signup.
-- A category groups one or more trades:
--   window-treatments → 1 trade (window-treatments)
--   flooring          → many sub-trades (epoxy, carpet, vinyl, … seeded in 0009)
-- NOTE: categories carry NO pricing — they are catalog/routing only. Every rate
-- card is trained per contractor (pricing_items), never seeded.
-- ============================================================================

alter table public.trades add column if not exists category text;
alter table public.trades add column if not exists category_label text;

-- Backfill the three existing trades. `epoxy-floors` joins the Flooring category
-- (0009 adds its sibling chips). `cleaning-waste-removal` has no pipeline yet.
update public.trades set category = 'window-treatments', category_label = 'Window Treatments' where slug = 'window-treatments';
update public.trades set category = 'flooring',          category_label = 'Flooring'          where slug = 'epoxy-floors';
update public.trades set category = 'cleaning',          category_label = 'Construction Cleaning & Waste Removal' where slug = 'cleaning-waste-removal';

create index if not exists trades_category_idx on public.trades(category);
