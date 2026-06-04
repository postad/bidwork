-- ============================================================================
-- BidWork — 0010 Window-Treatments seed audit (run after 0009). Idempotent.
-- Audit finding: the validated window-treatments vertical_config (0003) is sound —
-- productTypes (WT/MS/FPS/MB), noBidSignals, and requiredEvidence are correct and
-- battle-tested against the spike, so they are LEFT UNTOUCHED. The only gap is
-- router RECALL: the keyword/CSI hints miss common shade terminology and brands,
-- which can cause the scan to under-score relevance on sets that use those words.
--
-- This migration SURGICALLY expands router.keywords + router.csiSections via
-- jsonb_set (everything else in the config is preserved). Keywords are semantic
-- hints to the scan model, never a literal match — broadening them improves recall
-- without affecting the validated extraction/pricing path. No prices touched.
-- ============================================================================

update public.trades
set vertical_config = jsonb_set(
  jsonb_set(
    vertical_config,
    '{router,keywords}',
    $j$["window treatment","roller shade","motorized shade","manual shade","fixed shade","aluminum blind","mini blind","drapery","shade schedule","fascia","valance","openness","somfy","rollease","WT1","MB1","FPS","solar shade","blackout shade","light-filtering shade","dual shade","banded shade","zebra shade","sheer shade","cellular shade","honeycomb shade","roman shade","cassette","side channel","pocket","lutron","mechoshade","mecho","draper","hunter douglas","skyfold","window shade","interior shade"]$j$::jsonb,
    true
  ),
  '{router,csiSections}',
  $j$["12 20 00","12 24 00","12 21 00","12 22 00","12 23 00"]$j$::jsonb,
  true
)
where slug = 'window-treatments';
