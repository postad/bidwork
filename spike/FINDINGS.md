# Engine spike — findings (2160-Sunrise-Hwy-Merrick)

Validated against the matched submitted proposal (Estimate #14473, total $17,003.01).

## Two-pass engine is the right shape

| Pass | Input | Strong at | Model |
|---|---|---|---|
| **A · Spec/type extraction** | native PDF of triage-selected pages | product types, attributes, specs, exclusions, contacts, references, relevance | Opus |
| **B · Quantity takeoff** | high-DPI **tiled** images of the tag-bearing plan pages | counting per-window units; locating motorized motor-sets | Sonnet (vision) |

Sending whole drawing sheets as native PDF undercounts badly (the API downsamples
big sheets and small tags vanish). Rendering each plan sheet at ~200 DPI and tiling
into ~1500 px tiles fixes it.

## Accuracy

| Type | Pass A (native PDF) | Pass B (tiled @200 DPI) | Ground truth |
|---|---|---|---|
| MB1 mini-blinds | 9 | **12** | 12 ✅ |
| FPS1 fixed panels | 0/null | **2** | 2 ✅ |
| WT1 motorized | 2 | ~5 tags (6 raw, 1 seam-dup) | 5 motor sets / 11 shades |

- **Per-window types → 1 tag = 1 unit → exact.**
- **Motorized → 1 tag = 1 motor-set** (the pricing unit; config has WT `pricingUnit: per-motor-set`).
  The remaining work is reading each tag's **ganging tier** (2-on-1 / 3-on-1 / single) to pick its
  rate — a per-tag attribute, i.e. the `shadesPerMotor` field Pass A already flags as a gap.

## Key behaviors confirmed

- **Honest nulls, not hallucinations.** When unsure, the model returned `null` + reason and the
  pipeline raised a flag — never a confident-wrong number.
- **Config-driven.** One `window-treatments.json` drove relevance, routing, extraction, and gaps
  with no bespoke code → "add a trade = add a config" holds.
- **Self-flagged the root cause.** This set has **no tabular counts-schedule**; counts live as tags
  on A-402. Pass A correctly raised a *critical* "schedule missing (types+counts)" gap.
- **Contacts for Network**: architect, owner, engineer — all with email — from the title block.
- **Cost** ≈ brief's ~$1.50/project (triage Haiku + extract Opus + a counting pass on the plan pages).

## Implications for the real build

1. Triage must tag the **tag-bearing plan page** so Pass B knows where to count (don't rely on the
   `floor_plan` label alone — A-402 came back as `shade_schedule`).
2. `bid_line_items` for motorized = **motor-sets**, each carrying `shadesPerMotor` → selects the rate.
   This matches the proposal's structure exactly.
3. Pass B should reconcile tag counts across plan pages and against any legend (quantity-recon gap #3).
4. The extraction output shape in `src/lib/schema.ts` survived a real bid set → safe basis for the
   `extractions` JSONB and `bid_line_items` columns.

## Loop closed: read → count → price → total

`npm run close` against Estimate #14473 ($17,003.01):

- **Pricing engine (deterministic): EXACT $17,003.01.** products $17,427 → −20% $3,485 → +install
  $1,675 = subtotal $15,617 → +8.875% tax $1,386.01 = **$17,003.01**. The model never does arithmetic;
  pricing is pure code over the tenant's Pricing DNA (`config/pricing-dna.shade-co.json`, sell-price only).
- **Fully automated AI draft: $18,447.78 — within 8.5% (Δ $1,445), zero human input.** FPS exact, MB
  count exact (size split 10/2 vs 8/4), WT off by the seam-duplicate set + ganging tiers all guessed 2-on-1.
- **The residual delta = exactly the review-time confirmations the product is built around** (WT ganging
  tier, the duplicate set, MB size split). Contractor confirms → total snaps to exact. Thesis proven.

Implication: `bid_line_items` for WT carries `shadesPerMotor` (selects rate); MB carries `widthInches`
(selects size tier); discount % and install fee are bid-level; tax is workspace/jurisdiction config.

## Robustness sweep — engine run across all 10 projects (`npm run batch`)

Triage-only (Haiku) no-bid sweep over the other 9 real bid sets. Findings:

**Engine robustness — fixed two real limits the brief understated:**
- The 32 MB limit is on the *base64 request* (raw ×4/3) and there's also a hard **200k-token** ceiling
  that bites first on dense drawings. Chunker now caps raw at 18 MB / 40 pages, and triage **recursively
  splits any chunk that still overflows** at call time (recovered FIC-391's 210k-token chunk live). No crashes.

**No-bid gate works at the extremes, but is NON-DETERMINISTIC on borderline sets:**
- Clear scope → stable **BID** every run (520 Madison, WeWork-511). Empty → stable **NO-BID**.
- Ambiguous sets **flip between runs** (131 Irwin, Advantage BH, PS-66 each flipped BID↔NO-BID).
- → A single Haiku pass is not a trustworthy silent gate. Hardening needed: stronger model for the
  relevance call and/or **multi-vote**, and **bias toward surfacing for admin review** rather than
  silently dropping. This is exactly why the brief keeps admin-confirms-on-upload — the gate *suggests*,
  the human *decides*. Don't let a flaky gate auto-drop a real bid.

**File selection by filename is unreliable** — picking one arch file by name regressed (stub "Drawings.pdf"
vs full "Merged Drawing"; "MEPS" vs "ARCH"). The production lesson: the engine must ingest the **whole
uploaded package** (the `documents` table — multiple files per `bid_request`), not guess a single file.
CSI's real set (246 MB) exceeds the per-file cap and needs the production streaming-split path.

## Second vertical proven: Cleaning & Waste Removal (62 Eagle, `npm run clean`)

62 Eagle = a 7-page single-family-residence permit set, listed on PlanHub as pre-construction cleaning.

- **Decoupled per-trade scoring proven on ONE real document**: window-treatments engine → **NO-BID 85%**
  (windows present, no treatment scope); cleaning engine → **BID 95%** (real building, finishes, baths).
  This is the brief's multi-trade dispatch story, demonstrated end to end on the same file.
- **The engine generalizes to a structurally different vertical.** Cleaning scope is *area/count-derived*,
  not tagged items — and there are NO cleaning callouts in the document. The engine still derived it from
  the title-sheet area schedule + plans: areas by level (Cellar 677 / First 995 / Second 983 / Attic 400 /
  Garage 235 SF), 3,290 cleanable SF, 4 levels, 4 bed / 4 bath / 1 powder / 1 kitchen, ~28 windows
  (flagged conf 0.5), debris sized from new-construction SF. 7 explicit assumptions surfaced for review.
- **Architectural requirement confirmed: the extraction schema is PER-VERTICAL, declared by the config**
  (`schema-cleaning.ts` ≠ `schema.ts`). "One engine, config per vertical" holds — but config carries the
  vertical's schema + prompt, and pricing is per-vertical too (per-SF / per-room / per-dumpster / flat).
- No ground-truth cleaning proposal yet → pricing is illustrative (placeholder rates). Need a real
  submitted cleaning bid to make this an accuracy yardstick like 2160 was for shades.

## Third vertical proven: Epoxy / Resinous Flooring (ABH Absecon, `npm run epoxy`)

Package = structural set (9p) + RFI log (15p), merged and read as one (tests multi-doc ingestion).

- **The hardest no-bid case — semantic disambiguation beats keyword frequency.** The package contains
  **12 "epoxy" mentions, ALL false positives**: 7 are Hilti HIT-HY epoxy *anchors* / rebar dowels
  (structural), 5 are Roppe "Epoxy Nose Filler" for *rubber stair-tread* setting. A keyword router would
  score a confident BID and be wrong. The engine scored **NO-BID 95%**, with an explicit disambiguation:
  `epoxyFlooringScopePresent=false`, `epoxyMentionsAreAnchorOrAdhesive=true`. The actual finishes are
  F-1 resilient + rubber treads + wood/gypcrete — no fluid-applied coating.
- **Missing-document detection (gap detector #4) working:** flagged the absent architectural finish
  schedule, Division 09 6x spec, A-series plans, and undefined F-1/B-1 codes — exactly the "admin
  resolves before dispatch" case. Epoxy scope lives in the architectural set, which isn't in this folder.
- **Multi-document ingestion** (merge structural + RFI) worked — the production lesson from the batch sweep.

**Re-score after the missing doc was added (the gap-resolution loop, proven on real data):**
The architectural set (finish schedule A8.01 + finish plans) was later added — exactly the doc the engine
flagged missing. Re-running flipped the verdict **NO-BID → BID (55%, low-confidence/honest)** with an
expert-level read: F-1=LVT, F-3=carpet, **F-4=Sealed Concrete (assigned to F/W, Elect/IT, storage, closets,
janitor — real scope)**, **F-5=Sealed Resinous Flooring (defined in the legend but NOT assigned to any room,
no Div 09 spec — contemplated, unquantified)**. It still excluded the Hilti HIT-HY anchors as non-flooring,
and auto-drafted the exact RFIs ("where does F-5 apply?", "provide Div 09 resinous spec + SF takeoff").
This is the brief's flow: incomplete → NO-BID + flag → doc supplied → re-score → qualified BID with real
scope separated from a flagged clarification. Bid recommendation: price F-4 sealed concrete now, RFI on F-5.

## Engine status: all three live verticals validated

| Vertical | Pattern | Result on real docs |
|---|---|---|
| Window treatments | tag-counting + per-unit pricing | Priced to the penny ($17,003.01) vs the submitted proposal |
| Cleaning & waste removal | area/count-derived scope | BID where windows scored NO-BID (decoupled per-trade scoring) |
| Epoxy / resinous flooring | semantic relevance + missing-doc | NO-BID, defeating 12 "epoxy" keyword false positives |

Confirmed cross-cutting requirements for the real build: (1) extraction schema + pricing are PER-VERTICAL,
declared by the config; (2) the no-bid gate must be SEMANTIC (and admin-confirmed); (3) the engine ingests
the whole multi-file package and detects missing documents; (4) chunking must respect base64 + 200k-token
limits with live re-splitting.
