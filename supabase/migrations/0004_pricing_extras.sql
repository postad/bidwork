-- ============================================================================
-- BidWork — 0004 pricing extras (run after 0003). Idempotent.
-- The deterministic pricer needs two tenant-level rates the rate-card rows don't
-- carry: sales tax and the default proposal discount. Stored as pricing_items so
-- pricing stays fully data-driven (sell-price-only philosophy holds). Values are
-- percentages (8.875 = 8.875%, 20 = 20%) — see lib/engine/pricing.ts.
-- ============================================================================

insert into public.pricing_items (workspace_id, trade_id, code, label, unit, sell_price, pricing)
select '11111111-1111-1111-1111-111111111111', t.id, v.code, v.label, v.unit, v.sell_price, '{}'::jsonb
from public.trades t,
  (values
    ('TAX','Sales Tax Rate','percent', 8.875),
    ('DISCOUNT','Default Proposal Discount','percent', 20)
  ) as v(code,label,unit,sell_price)
where t.slug = 'window-treatments'
on conflict do nothing;
