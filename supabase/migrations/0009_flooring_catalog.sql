-- ============================================================================
-- BidWork — 0009 Flooring catalog (run after 0008). Idempotent.
-- Seeds the full PlanHub "Flooring" category as sub-trades, all category='flooring'
-- so they share ONE flooring pipeline (engine registry keys on category).
--
-- CATALOG / ROUTING ONLY — no prices. `router.keywords` are SEMANTIC bid signals
-- the scan model uses to judge relevance (it reads the PDF and scores each trade;
-- keywords are hints, never a literal text match). `negativeKeywords` and
-- `noBidSignals` disambiguate. Every contractor's rate card is trained, not seeded.
--
-- Shared scopeDrivers shape (all flooring sub-trades): floor_area (per-sqft,
-- blocking), system (per-system), substrate_prep (per-sqft), base_trim (per-lf).
-- requiredEvidence: finish_schedule + material_spec are blocking; floor_areas is a
-- WARNING (missing SF → site_visit bid, not a hard block).
--
-- High-traffic chips below have rich keyword/negative sets; chips marked STARTER
-- have correct-but-minimal configs to refine as real bids come through.
-- ============================================================================

insert into public.trades (slug, label, category, category_label, vertical_config) values

-- ---- Epoxy / Resinous (re-seed: standardize scopeDrivers to base_trim) -------
('epoxy-floors','Epoxy / Resinous Flooring','flooring','Flooring', $j$
{
  "groupBy":["level","room"],
  "router":{
    "keywords":["epoxy floor","resinous flooring","fluid-applied flooring","09 67 00","09 67 23","09 61 00","self-leveling epoxy","urethane cement","broadcast quartz","MMA flooring","seamless flooring","floor coating","decorative flake"],
    "negativeKeywords":["epoxy anchor","epoxy adhesive","adhesive anchor","hit-hy","hit-z","re-500","rebar dowel","doweled","post-installed","epoxy nose filler","nose filler","anchor bolt"]},
  "noBidSignals":["floor finishes are resilient only (VCT/LVT/rubber/carpet) with no resinous system","every 'epoxy' reference is an adhesive/anchor or nose filler","no Division 09 6x fluid-applied/resinous spec present","structural-only set with no finish schedule"],
  "scopeDrivers":[
    {"key":"floor_area","label":"Resinous floor area by room (SF)","pricingUnit":"per-sqft","blocking":true},
    {"key":"system","label":"Coating system & build (mils)","pricingUnit":"per-system"},
    {"key":"substrate_prep","label":"Substrate prep (shot-blast/grind/moisture)","pricingUnit":"per-sqft"},
    {"key":"base_trim","label":"Integral cove base (LF)","pricingUnit":"per-lf"}],
  "requiredEvidence":[
    {"key":"finish_schedule","label":"Floor-finish schedule (which rooms get resinous)","blocking":true},
    {"key":"material_spec","label":"Division 09 6x resinous spec","blocking":true},
    {"key":"floor_areas","label":"Floor areas by room (SF)","blocking":false}],
  "disambiguation":"'epoxy' is usually anchors/adhesive or stair nose filler — NOT flooring. Score semantically.",
  "pricingModel":{"basis":"per-sqft by system + prep + per-LF cove base"}
}
$j$::jsonb),

-- ---- Carpet ------------------------------------------------------------------
('carpet','Carpet','flooring','Flooring', $j$
{
  "groupBy":["level","room"],
  "router":{
    "keywords":["carpet","carpet tile","broadloom","modular carpet","carpet pad","cushion","walk-off","09 68 00","09 68 13","09 68 16","CPT","tackless","direct glue"],
    "negativeKeywords":["carpet protection","temporary protection","entrance grille","floor mat recessed frame"]},
  "noBidSignals":["finishes are hard-surface only (tile/resinous/wood) with no carpet","carpet shown for reference/existing-to-remain only","demolition only"],
  "scopeDrivers":[
    {"key":"floor_area","label":"Carpet area by room (SF/SY)","pricingUnit":"per-sqft","blocking":true},
    {"key":"system","label":"Carpet system (tile / broadloom + pad)","pricingUnit":"per-system"},
    {"key":"substrate_prep","label":"Floor prep / leveling","pricingUnit":"per-sqft"},
    {"key":"base_trim","label":"Resilient / carpet base + transitions (LF)","pricingUnit":"per-lf"}],
  "requiredEvidence":[
    {"key":"finish_schedule","label":"Floor-finish schedule (which rooms get carpet)","blocking":true},
    {"key":"material_spec","label":"Division 09 68 carpet spec","blocking":true},
    {"key":"floor_areas","label":"Floor areas by room (SF)","blocking":false}],
  "disambiguation":"Distinguish installed carpet finish from temporary carpet protection or existing-to-remain.",
  "pricingModel":{"basis":"per-sqft by system + prep + per-LF base/transitions"}
}
$j$::jsonb),

-- ---- Vinyl & VCT (resilient) -------------------------------------------------
('vinyl-vct-flooring','Vinyl & VCT Flooring','flooring','Flooring', $j$
{
  "groupBy":["level","room"],
  "router":{
    "keywords":["resilient flooring","VCT","vinyl composition tile","LVT","luxury vinyl tile","luxury vinyl plank","LVP","sheet vinyl","vinyl plank","rubber flooring","linoleum","resilient base","09 65 00","09 65 19","09 65 16","09 65 13","09 65 36"],
    "negativeKeywords":["vinyl wall base only","vinyl wallcovering","vinyl-coated fabric","resilient anchor"]},
  "noBidSignals":["finishes are carpet/wood/resinous only with no resilient product","resilient base only (no field flooring)","existing-to-remain only"],
  "scopeDrivers":[
    {"key":"floor_area","label":"Resilient floor area by room (SF)","pricingUnit":"per-sqft","blocking":true},
    {"key":"system","label":"Product (VCT / LVT / sheet / rubber)","pricingUnit":"per-system"},
    {"key":"substrate_prep","label":"Floor prep / moisture mitigation / leveling","pricingUnit":"per-sqft"},
    {"key":"base_trim","label":"Resilient base + transition strips (LF)","pricingUnit":"per-lf"}],
  "requiredEvidence":[
    {"key":"finish_schedule","label":"Floor-finish schedule (which rooms get resilient)","blocking":true},
    {"key":"material_spec","label":"Division 09 65 resilient spec","blocking":true},
    {"key":"floor_areas","label":"Floor areas by room (SF)","blocking":false}],
  "disambiguation":"Resilient field flooring vs. resilient wall base alone — base-only sets are usually another sub's scope.",
  "pricingModel":{"basis":"per-sqft by product + prep + per-LF base/transitions"}
}
$j$::jsonb),

-- ---- Polished Concrete -------------------------------------------------------
('polished-concrete','Polished Concrete','flooring','Flooring', $j$
{
  "groupBy":["level","room"],
  "router":{
    "keywords":["polished concrete","concrete polishing","densified concrete","ground and polished","grind and seal","burnished concrete","03 35 43","09 67 00","grit level","gloss level","aggregate exposure"],
    "negativeKeywords":["polished stone","polished tile","concrete sealer for waterproofing","epoxy coating system"]},
  "noBidSignals":["concrete slab is substrate for another finish (carpet/tile/resinous)","slab-on-grade structural only with no polish/finish callout","exterior paving"],
  "scopeDrivers":[
    {"key":"floor_area","label":"Polished concrete area by room (SF)","pricingUnit":"per-sqft","blocking":true},
    {"key":"system","label":"Polish build (grind/grit/gloss level)","pricingUnit":"per-system"},
    {"key":"substrate_prep","label":"Grind / patch / crack repair","pricingUnit":"per-sqft"},
    {"key":"base_trim","label":"Edge / cove detail (LF)","pricingUnit":"per-lf"}],
  "requiredEvidence":[
    {"key":"finish_schedule","label":"Floor-finish schedule (which rooms are polished)","blocking":true},
    {"key":"material_spec","label":"Polished-concrete spec (grit/gloss/aggregate)","blocking":true},
    {"key":"floor_areas","label":"Floor areas by room (SF)","blocking":false}],
  "disambiguation":"Finished polished concrete floor vs. a bare slab that merely receives another finish.",
  "pricingModel":{"basis":"per-sqft by polish level + prep + per-LF edge"}
}
$j$::jsonb),

-- ---- Sealed Concrete ---------------------------------------------------------
('sealed-concrete','Sealed Concrete','flooring','Flooring', $j$
{
  "groupBy":["level","room"],
  "router":{
    "keywords":["sealed concrete","concrete sealer","densifier","hardener","dustproofing","cure and seal","penetrating sealer","exposed sealed concrete floor","03 35 00","09 61 00"],
    "negativeKeywords":["waterproofing membrane","below-grade waterproofing","epoxy coating","polished concrete"]},
  "noBidSignals":["sealer is curing compound for slab placement only (not a finished floor)","concrete is substrate for another finish","exterior/site concrete"],
  "scopeDrivers":[
    {"key":"floor_area","label":"Sealed concrete area by room (SF)","pricingUnit":"per-sqft","blocking":true},
    {"key":"system","label":"Sealer/densifier system & coats","pricingUnit":"per-system"},
    {"key":"substrate_prep","label":"Clean / etch / patch","pricingUnit":"per-sqft"},
    {"key":"base_trim","label":"Edge / cove detail (LF)","pricingUnit":"per-lf"}],
  "requiredEvidence":[
    {"key":"finish_schedule","label":"Floor-finish schedule (which rooms are sealed)","blocking":true},
    {"key":"material_spec","label":"Concrete sealer/densifier spec","blocking":true},
    {"key":"floor_areas","label":"Floor areas by room (SF)","blocking":false}],
  "disambiguation":"Finished sealed-concrete floor vs. a curing compound applied only during slab placement.",
  "pricingModel":{"basis":"per-sqft by sealer system + prep + per-LF edge"}
}
$j$::jsonb),

-- ---- Hardwood ----------------------------------------------------------------
('hardwood-flooring','Hardwood Flooring','flooring','Flooring', $j$
{
  "groupBy":["level","room"],
  "router":{
    "keywords":["wood flooring","hardwood","engineered wood","solid wood","wood strip","wood plank","sand and finish","sleepers","09 64 00","09 64 29","09 64 23","gym wood floor"],
    "negativeKeywords":["wood blocking","plywood underlayment only","wood base only","millwork","casework"]},
  "noBidSignals":["wood shown as base/trim only (no field wood floor)","finishes are non-wood throughout","existing-to-remain only"],
  "scopeDrivers":[
    {"key":"floor_area","label":"Wood floor area by room (SF)","pricingUnit":"per-sqft","blocking":true},
    {"key":"system","label":"Product (solid / engineered / species & grade)","pricingUnit":"per-system"},
    {"key":"substrate_prep","label":"Subfloor prep / sleepers / underlayment","pricingUnit":"per-sqft"},
    {"key":"base_trim","label":"Wood base / shoe / transitions (LF)","pricingUnit":"per-lf"}],
  "requiredEvidence":[
    {"key":"finish_schedule","label":"Floor-finish schedule (which rooms get wood)","blocking":true},
    {"key":"material_spec","label":"Division 09 64 wood flooring spec","blocking":true},
    {"key":"floor_areas","label":"Floor areas by room (SF)","blocking":false}],
  "disambiguation":"Field wood flooring vs. wood used only as base/trim, blocking, or millwork.",
  "pricingModel":{"basis":"per-sqft by product + prep + per-LF base/transitions"}
}
$j$::jsonb),

-- ---- Laminate ----------------------------------------------------------------
('laminate-flooring','Laminate Flooring','flooring','Flooring', $j$
{
  "groupBy":["level","room"],
  "router":{
    "keywords":["laminate flooring","laminate plank","floating floor","click-lock","HPL flooring","laminate underlayment","09 64 66"],
    "negativeKeywords":["plastic laminate countertop","HPL casework","laminate wall panel","cabinet laminate"]},
  "noBidSignals":["'laminate' refers to casework/countertops, not floor","finishes are non-laminate throughout","existing-to-remain only"],
  "scopeDrivers":[
    {"key":"floor_area","label":"Laminate floor area by room (SF)","pricingUnit":"per-sqft","blocking":true},
    {"key":"system","label":"Product (AC rating / thickness)","pricingUnit":"per-system"},
    {"key":"substrate_prep","label":"Subfloor prep / underlayment","pricingUnit":"per-sqft"},
    {"key":"base_trim","label":"Base / transitions (LF)","pricingUnit":"per-lf"}],
  "requiredEvidence":[
    {"key":"finish_schedule","label":"Floor-finish schedule (which rooms get laminate)","blocking":true},
    {"key":"material_spec","label":"Division 09 64 66 laminate spec","blocking":true},
    {"key":"floor_areas","label":"Floor areas by room (SF)","blocking":false}],
  "disambiguation":"Laminate FLOORING vs. plastic-laminate (HPL) countertops/casework — the latter is not this trade.",
  "pricingModel":{"basis":"per-sqft by product + prep + per-LF base/transitions"}
}
$j$::jsonb),

-- ---- Tile --------------------------------------------------------------------
('tile-flooring','Tile Flooring','flooring','Flooring', $j$
{
  "groupBy":["level","room"],
  "router":{
    "keywords":["tile","ceramic tile","porcelain tile","quarry tile","mosaic","floor tile","thinset","setting bed","grout","crack isolation membrane","09 30 00","09 30 13"],
    "negativeKeywords":["wall tile only","ceiling tile","acoustical tile","tile roofing","carpet tile"]},
  "noBidSignals":["tile shown is wall/ceiling/backsplash only (no floor tile)","finishes are non-tile throughout","existing-to-remain only"],
  "scopeDrivers":[
    {"key":"floor_area","label":"Floor tile area by room (SF)","pricingUnit":"per-sqft","blocking":true},
    {"key":"system","label":"Product (ceramic / porcelain / mosaic, size)","pricingUnit":"per-system"},
    {"key":"substrate_prep","label":"Setting bed / membrane / leveling","pricingUnit":"per-sqft"},
    {"key":"base_trim","label":"Tile base / cove / transitions (LF)","pricingUnit":"per-lf"}],
  "requiredEvidence":[
    {"key":"finish_schedule","label":"Floor-finish schedule (which rooms get tile)","blocking":true},
    {"key":"material_spec","label":"Division 09 30 tiling spec","blocking":true},
    {"key":"floor_areas","label":"Floor areas by room (SF)","blocking":false}],
  "disambiguation":"FLOOR tile only — exclude wall tile, ceiling/acoustical tile, and carpet tile (separate trades).",
  "pricingModel":{"basis":"per-sqft by product + setting/prep + per-LF base"}
}
$j$::jsonb),

-- ---- Terrazzo (STARTER) ------------------------------------------------------
('terrazzo-flooring','Terrazzo Flooring','flooring','Flooring', $j$
{
  "groupBy":["level","room"],
  "router":{
    "keywords":["terrazzo","epoxy terrazzo","cementitious terrazzo","divider strips","terrazzo base","09 66 00","09 66 13","09 66 23"],
    "negativeKeywords":["terrazzo tile precast only"]},
  "noBidSignals":["finishes are non-terrazzo throughout","existing terrazzo to remain / restore only with no new install"],
  "scopeDrivers":[
    {"key":"floor_area","label":"Terrazzo area by room (SF)","pricingUnit":"per-sqft","blocking":true},
    {"key":"system","label":"System (epoxy / cementitious, divider layout)","pricingUnit":"per-system"},
    {"key":"substrate_prep","label":"Substrate prep / membrane","pricingUnit":"per-sqft"},
    {"key":"base_trim","label":"Terrazzo cove base (LF)","pricingUnit":"per-lf"}],
  "requiredEvidence":[
    {"key":"finish_schedule","label":"Floor-finish schedule (which rooms get terrazzo)","blocking":true},
    {"key":"material_spec","label":"Division 09 66 terrazzo spec","blocking":true},
    {"key":"floor_areas","label":"Floor areas by room (SF)","blocking":false}],
  "pricingModel":{"basis":"per-sqft by system + prep + per-LF cove base"}
}
$j$::jsonb),

-- ---- Brick & Stone (STARTER) -------------------------------------------------
('brick-stone-flooring','Brick & Stone Flooring','flooring','Flooring', $j$
{
  "groupBy":["level","room"],
  "router":{
    "keywords":["stone flooring","brick flooring","brick paver","stone paver","flagstone","granite floor","limestone floor","slate floor","09 63 00","09 63 13","09 63 40"],
    "negativeKeywords":["brick veneer wall","masonry wall","stone cladding","countertop stone"]},
  "noBidSignals":["stone/brick is wall/cladding/veneer only (no floor)","exterior site paving only","existing-to-remain only"],
  "scopeDrivers":[
    {"key":"floor_area","label":"Stone/brick floor area by room (SF)","pricingUnit":"per-sqft","blocking":true},
    {"key":"system","label":"Material (brick / stone type, finish)","pricingUnit":"per-system"},
    {"key":"substrate_prep","label":"Setting bed / membrane","pricingUnit":"per-sqft"},
    {"key":"base_trim","label":"Stone base / transitions (LF)","pricingUnit":"per-lf"}],
  "requiredEvidence":[
    {"key":"finish_schedule","label":"Floor-finish schedule (which rooms get stone/brick)","blocking":true},
    {"key":"material_spec","label":"Division 09 63 masonry flooring spec","blocking":true},
    {"key":"floor_areas","label":"Floor areas by room (SF)","blocking":false}],
  "disambiguation":"FLOOR stone/brick only — exclude wall veneer, cladding, and countertops.",
  "pricingModel":{"basis":"per-sqft by material + setting/prep + per-LF base"}
}
$j$::jsonb),

-- ---- Marble (STARTER) --------------------------------------------------------
('marble-flooring','Marble Flooring','flooring','Flooring', $j$
{
  "groupBy":["level","room"],
  "router":{
    "keywords":["marble flooring","marble tile floor","marble slab floor","honed marble","polished marble floor","09 63 40","09 30 00"],
    "negativeKeywords":["marble wall","marble countertop","marble threshold only","marble cladding"]},
  "noBidSignals":["marble is wall/cladding/countertop only (no floor)","existing-to-remain only"],
  "scopeDrivers":[
    {"key":"floor_area","label":"Marble floor area by room (SF)","pricingUnit":"per-sqft","blocking":true},
    {"key":"system","label":"Material (marble type, finish, size)","pricingUnit":"per-system"},
    {"key":"substrate_prep","label":"Setting bed / membrane","pricingUnit":"per-sqft"},
    {"key":"base_trim","label":"Marble base / transitions (LF)","pricingUnit":"per-lf"}],
  "requiredEvidence":[
    {"key":"finish_schedule","label":"Floor-finish schedule (which rooms get marble)","blocking":true},
    {"key":"material_spec","label":"Stone/marble flooring spec","blocking":true},
    {"key":"floor_areas","label":"Floor areas by room (SF)","blocking":false}],
  "disambiguation":"FLOOR marble only — exclude wall, cladding, thresholds, and countertops.",
  "pricingModel":{"basis":"per-sqft by material + setting/prep + per-LF base"}
}
$j$::jsonb),

-- ---- Athletic (STARTER) ------------------------------------------------------
('athletic-flooring','Athletic Flooring','flooring','Flooring', $j$
{
  "groupBy":["level","area"],
  "router":{
    "keywords":["athletic flooring","gym floor","sports flooring","sprung floor","poured urethane athletic","rubber athletic flooring","wood gym floor","running track surface","game lines","09 66 66","09 67 66"],
    "negativeKeywords":["playground surfacing exterior","turf field"]},
  "noBidSignals":["no athletic/sports surface in finishes","exterior field/track only","existing-to-remain only"],
  "scopeDrivers":[
    {"key":"floor_area","label":"Athletic surface area by area (SF)","pricingUnit":"per-sqft","blocking":true},
    {"key":"system","label":"System (wood / poured urethane / rubber)","pricingUnit":"per-system"},
    {"key":"substrate_prep","label":"Subfloor / moisture mitigation","pricingUnit":"per-sqft"},
    {"key":"base_trim","label":"Base / wall trim (LF)","pricingUnit":"per-lf"}],
  "requiredEvidence":[
    {"key":"finish_schedule","label":"Floor-finish schedule (athletic areas)","blocking":true},
    {"key":"material_spec","label":"Athletic flooring spec","blocking":true},
    {"key":"floor_areas","label":"Floor areas by area (SF)","blocking":false}],
  "pricingModel":{"basis":"per-sqft by system + prep + per-LF base (game lines as add)"}
}
$j$::jsonb),

-- ---- Raised Access (STARTER) -------------------------------------------------
('raised-access-flooring','Raised Access Flooring','flooring','Flooring', $j$
{
  "groupBy":["level","room"],
  "router":{
    "keywords":["raised access floor","access flooring","raised floor","pedestal floor","computer room floor","data center floor","understructure pedestal","09 69 00"],
    "negativeKeywords":["raised planter","stage platform","equipment housekeeping pad"]},
  "noBidSignals":["no access/raised floor system in scope","existing-to-remain only"],
  "scopeDrivers":[
    {"key":"floor_area","label":"Access floor area by room (SF)","pricingUnit":"per-sqft","blocking":true},
    {"key":"system","label":"System (panel type, finished height, load class)","pricingUnit":"per-system"},
    {"key":"substrate_prep","label":"Slab prep / leveling","pricingUnit":"per-sqft"},
    {"key":"base_trim","label":"Ramps / edge trim (LF)","pricingUnit":"per-lf"}],
  "requiredEvidence":[
    {"key":"finish_schedule","label":"Rooms with raised access floor","blocking":true},
    {"key":"material_spec","label":"Division 09 69 access flooring spec","blocking":true},
    {"key":"floor_areas","label":"Floor areas by room (SF)","blocking":false}],
  "pricingModel":{"basis":"per-sqft by panel system + prep + per-LF ramps/edge"}
}
$j$::jsonb),

-- ---- Dance (STARTER) ---------------------------------------------------------
('dance-flooring','Dance Flooring','flooring','Flooring', $j$
{
  "groupBy":["level","room"],
  "router":{
    "keywords":["dance floor","sprung dance floor","marley floor","vinyl performance floor","studio floor","09 64 00"],
    "negativeKeywords":["portable event dance floor rental","stage rigging"]},
  "noBidSignals":["no dance/performance floor in scope","existing-to-remain only"],
  "scopeDrivers":[
    {"key":"floor_area","label":"Dance floor area by room (SF)","pricingUnit":"per-sqft","blocking":true},
    {"key":"system","label":"System (sprung subfloor + marley/vinyl surface)","pricingUnit":"per-system"},
    {"key":"substrate_prep","label":"Subfloor prep","pricingUnit":"per-sqft"},
    {"key":"base_trim","label":"Base / edge trim (LF)","pricingUnit":"per-lf"}],
  "requiredEvidence":[
    {"key":"finish_schedule","label":"Rooms with dance/performance floor","blocking":true},
    {"key":"material_spec","label":"Dance flooring spec","blocking":true},
    {"key":"floor_areas","label":"Floor areas by room (SF)","blocking":false}],
  "pricingModel":{"basis":"per-sqft by system + prep + per-LF base"}
}
$j$::jsonb)

on conflict (slug) do update set
  label = excluded.label,
  category = excluded.category,
  category_label = excluded.category_label,
  vertical_config = excluded.vertical_config;
