-- ============================================================================
-- BidWork — 0003 seed (run after 0002). Idempotent (re-runnable).
-- Seeds the 3 validated trade configs, plan catalog, and The Shade Company
-- workspace + Pricing DNA. Auth users (admin + contractor) are created in the
-- Supabase dashboard, then linked via the snippet in supabase/README.md.
-- ============================================================================

-- Fixed workspace id so README + app seed can reference it deterministically.
insert into public.workspaces (id, name)
values ('11111111-1111-1111-1111-111111111111','The Shade Company')
on conflict (id) do nothing;

-- ---------- Trades (VerticalConfig carries schema + pricing model) ----------
insert into public.trades (slug, label, vertical_config) values
('window-treatments','Window Treatments', $j$
{
  "groupBy":["floor","room"],
  "router":{"csiSections":["12 24 00","12 21 00","12 22 00"],
    "keywords":["window treatment","roller shade","motorized shade","manual shade","fixed shade","aluminum blind","mini blind","drapery","shade schedule","fascia","valance","openness","somfy","rollease","WT1","MB1","FPS"]},
  "noBidSignals":["drive-thru only with no occupied interior","exterior facade only, no interior glazing","no windows / interior shell","demolition only"],
  "productTypes":[
    {"code":"WT","name":"Motorized Roller Shade","unit":"shade","pricingUnit":"per-motor-set","attributes":["motor","control","fabric","openness","color","fascia","shadesPerMotor"]},
    {"code":"MS","name":"Manual Roller Shade","unit":"shade","pricingUnit":"per-shade"},
    {"code":"FPS","name":"Fixed Roller Shade","unit":"shade","pricingUnit":"per-shade"},
    {"code":"MB","name":"Manual Aluminum / Mini Blind","unit":"blind","pricingUnit":"per-blind","attributes":["material","slatSize","widthInches"]}],
  "requiredEvidence":[
    {"key":"shade_schedule","label":"Shade schedule (types + counts)","blocking":true},
    {"key":"type_definitions","label":"Type definitions (WT/MB/FPS)","blocking":true},
    {"key":"location_plans","label":"Floor plans locating each shade","blocking":true},
    {"key":"fabric_spec","label":"Fabric / openness spec","blocking":false},
    {"key":"motorization","label":"Motor / control spec","blocking":false},
    {"key":"ganging","label":"Shades-per-motor (drives pricing)","blocking":false}],
  "takeoff":{"method":"tiled-tag-count","dpi":200},
  "pricingModel":{"WT":"per-motor-set by shadesPerMotor","MB":"per-blind by widthInches tier","FPS":"flat per shade"}
}
$j$::jsonb),
('cleaning-waste-removal','Construction Cleaning & Waste Removal', $j$
{
  "groupBy":["level","area"],
  "scopeServices":["rough-clean-during-build","debris-and-waste-haul-off","final-post-construction-clean","window-cleaning"],
  "router":{"keywords":["floor plan","square feet","s.f.","area schedule","new work","renovation","demolition","finish","debris","cleaning","dumpster","haul"]},
  "noBidSignals":["no physical construction (study/report only)","site/civil only with no enclosed building areas","owner self-performs cleanup"],
  "scopeDrivers":[
    {"key":"cleanable_area","label":"Cleanable floor area by level (SF)","pricingUnit":"per-sqft","blocking":true},
    {"key":"bathrooms","label":"Bathroom + powder count","pricingUnit":"per-fixture-room"},
    {"key":"windows","label":"Window count (final glass)","pricingUnit":"per-window"},
    {"key":"debris_volume","label":"New-construction volume / disturbed area","pricingUnit":"per-dumpster"}],
  "requiredEvidence":[
    {"key":"floor_areas","label":"Floor areas by level (SF)","blocking":true},
    {"key":"floor_plans","label":"Floor plans","blocking":true}],
  "pricingModel":{"basis":"per-sqft + per-room/fixture + flat-minimum + per-dumpster"}
}
$j$::jsonb),
('epoxy-floors','Epoxy / Resinous Flooring', $j$
{
  "groupBy":["level","room"],
  "router":{
    "keywords":["epoxy floor","resinous flooring","fluid-applied flooring","09 67 00","09 61 00","self-leveling epoxy","urethane cement","broadcast quartz","MMA flooring","polished concrete","sealed concrete floor","floor coating","seamless flooring"],
    "negativeKeywords":["epoxy anchor","epoxy adhesive","adhesive anchor","hit-hy","hit-z","re-500","rebar dowel","doweled","post-installed","epoxy nose filler","nose filler","anchor bolt"]},
  "noBidSignals":["floor finishes are resilient only (VCT/LVT/rubber/carpet) with no resinous system","every 'epoxy' reference is an adhesive/anchor or nose filler","no Division 09 6x fluid-applied/resinous spec present","structural-only set with no finish schedule"],
  "scopeDrivers":[
    {"key":"epoxy_area","label":"Epoxy/resinous floor area by room (SF)","pricingUnit":"per-sqft","blocking":true},
    {"key":"system","label":"Coating system & build (mils)","pricingUnit":"per-system"},
    {"key":"substrate_prep","label":"Substrate prep (shot-blast/grind/moisture)","pricingUnit":"per-sqft"},
    {"key":"cove_base","label":"Integral cove base (LF)","pricingUnit":"per-lf"}],
  "requiredEvidence":[
    {"key":"finish_schedule","label":"Floor-finish schedule (which rooms get epoxy)","blocking":true},
    {"key":"div09_spec","label":"Division 09 6x resinous spec","blocking":true},
    {"key":"floor_areas","label":"Floor areas by room (SF)","blocking":true}],
  "disambiguation":"'epoxy' is usually anchors/adhesive or stair nose filler — NOT flooring. Score semantically.",
  "pricingModel":{"basis":"per-sqft by system + substrate prep + per-LF cove base"}
}
$j$::jsonb)
on conflict (slug) do update set label = excluded.label, vertical_config = excluded.vertical_config;

-- ---------- Plan catalog (Stripe price ids filled in Stage 5) ---------------
insert into public.plans (slug, name, monthly_price_cents, included_bids_per_month) values
('starter','Starter', 14900, 10),
('growth','Growth',   34900, 30),
('pro','Pro',         69900, 80)
on conflict (slug) do update set name = excluded.name,
  monthly_price_cents = excluded.monthly_price_cents,
  included_bids_per_month = excluded.included_bids_per_month;

-- ---------- The Shade Company: trade coverage + Pricing DNA -----------------
insert into public.workspace_trades (workspace_id, trade_id, center_zip, center_lat, center_lng, radius_mi)
select '11111111-1111-1111-1111-111111111111', t.id, '10018', 40.7549, -73.9925, 100
from public.trades t where t.slug = 'window-treatments'
on conflict (workspace_id, trade_id) do nothing;

-- Pricing DNA from Estimate #14473 (sell prices only). Tiers in `pricing` JSONB.
insert into public.pricing_items (workspace_id, trade_id, code, label, unit, sell_price, pricing)
select '11111111-1111-1111-1111-111111111111', t.id, v.code, v.label, v.unit, v.sell_price, v.pricing
from public.trades t,
  (values
    ('WT','Motorized Roller Shade','per-motor-set', null::numeric, $j${"byShadesPerMotor":{"1":1359,"2":2143,"3":2927}}$j$::jsonb),
    ('MB','Manual Aluminum Blind','per-blind',       null::numeric, $j${"byWidthTier":[{"maxWidthInches":30,"price":350},{"maxWidthInches":999,"price":500}]}$j$::jsonb),
    ('FPS','Fixed Roller Shade','per-shade',          264, '{}'::jsonb),
    ('INSTALL','Installation Fee','flat',            1675, '{}'::jsonb)
  ) as v(code,label,unit,sell_price,pricing)
where t.slug = 'window-treatments'
on conflict do nothing;

-- ---------- Subscription row (trialing, 3 free bids) ------------------------
insert into public.subscriptions (workspace_id, status, trial_bids_limit, trial_bids_used)
values ('11111111-1111-1111-1111-111111111111','trialing',3,0)
on conflict (workspace_id) do nothing;
