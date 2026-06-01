# BidWork — Build Plan

**Status:** Engine validated across 3 verticals (see `spike/FINDINGS.md`). This plan turns the
validated engine + the mockups + `spec.html` into the real multi-tenant app.
**Date:** 2026-06-01 · **Approach:** walking-skeleton vertical slice, then widen.

---

## 1 · Guiding approach

- **Not** big-bang, **not** "finish admin then finish user." Build a **thin slice that spans both
  roles end-to-end**, then thicken. Admin and contractor are two ends of one pipe (admin dispatches →
  contractor reviews/sends); they must be built and tested together, narrowly first.
- **The multi-trade scan is intrinsic and built from Stage 1.** One upload is read **once** and scored
  against **every** trade in the system (3 today, N later). It is never a per-trade upload.
- **Wire the real engine early** (Stage 1) — it's the de-risked part. Seed the spike's cached extraction
  JSON as fixtures so UI work isn't blocked on job latency/cost, then flip to live Trigger.dev runs.
- **Scope default (adjustable in one line):** the multi-trade **scan/relevance** is real for all 3 trades
  from Stage 1; the full downstream pipe (extract → price → dispatch → review → send) **leads with
  window-treatments** (our penny-accurate ground truth), with epoxy + cleaning full pricing in Stage 3.

---

## 2 · Architecture

- **Frontend/app:** Next.js 14 (App Router) + Tailwind, `bw-` design tokens. Route groups:
  `/` marketing · `/app/*` contractor · `/app/admin/*` operator console.
- **Data layer:** Supabase — Postgres + **Auth** (email/password, verification, reset, Google/MS OAuth,
  sessions) + **Storage** (ITB PDFs, logos, generated bid files) + **RLS** for tenant isolation.
  `supabase-js` is the data layer (passes per-request auth context RLS reads). **No Prisma.**
- **Background jobs:** **Trigger.dev v3** runs the engine (long, multi-step, native PDF rendering, no
  serverless timeout). Each pipeline step is a durable task with its own retry policy.
- **Email:** Mailgun — bid subdomain + outreach subdomain (reputation isolation); inbound parse +
  delivery webhooks (✓/✓✓); per-tenant sending identity via OAuth mailbox-connect.
- **Payments:** **Stripe** — subscriptions (monthly packages), Checkout + Customer Portal, webhooks.
- **Hosting:** Vercel (app + API routes for engine kickoff, Mailgun + Stripe webhooks).

### The engine in production — read once, score all trades, extract only winners

This is the single most important correction vs. the spike (which re-read the doc per vertical):

```
admin uploads package (all docs)
  1. Render & route          ── ONCE, shared, page-hash cached
  2. Multi-trade relevance scan ── ONE pass over every trade config
        → bid/no-bid + confidence per trade · tags relevant pages/doc-types
        → doc-level gaps · project-team contacts            (all shared)
  3. Per BID trade only: trade-specific extraction (per-vertical schema)
        → quantity takeoff (tiled hi-DPI counting) → price per matched contractor
  ▼
 admin Review & Dispatch: per-trade bid/no-bid cards · gaps · contractor fan-out by trade+geo
  → dispatch → each contractor gets their trade's bid
```

- **Token efficiency:** the expensive 100–200pp read happens once. **Anthropic prompt caching** caches
  the document so per-trade calls pay document tokens ~once (~10% on cache reads). Opus extraction runs
  **only for trades that scored bid** — a package bid for 1 of 6 trades ≈ one scan + one extraction.
- **Reuses spike code:** `lib/pdf.ts` (chunk, base64+token-aware split), `lib/render.ts` (MuPDF+sharp
  tiling), `pipeline/{triage,extract,count,price}.ts`, the 3 `VerticalConfig`s + Pricing DNA.

---

## 3 · Data model (~16 tables, 6 groups)

Rule of thumb: relational columns for anything we query/filter/learn from; JSONB for shape-varying
payloads. Everything tenant-scoped carries `workspace_id` that RLS keys on.

**Tenancy & identity**
- `workspaces` — one per contractor tenant (RLS boundary).
- `profiles` — users → `auth.users`; role (admin/contractor), branding, reply-to, mailbox token ref.

**Trades & pricing**
- `trades` — global vertical catalog; `VerticalConfig` JSONB **now carries the per-vertical extraction
  schema + pricing model** (proven necessary in the spike), requiredEvidence, semantic no-bid signals.
- `workspace_trades` — tenant's trades + geo (center zip, lat/lng, radius_mi).
- `pricing_items` — Pricing DNA; **sell price only** (per unit/sqft/LF/adder/motor-set). Never cost/margin.

**Requests & extraction**
- `bid_requests` — admin upload: geo radius, **per-trade relevance scores (JSONB)**, doc-level gaps,
  dispatch status.
- `documents` — each file in Storage + page metadata, classification, page-hash cache key (JSONB).
- `extractions` — per request × **bid** trade: raw structured extract (JSONB, per-vertical shape) with
  confidence + citations. Internal/QA artifact.

**Bids & learning**
- `bids` — one per matched contractor per trade; status (draft/approved/sent), **boilerplate snapshot**
  frozen at send, **`billable`/`counted_at`** for metering (see §5).
- `bid_line_items` — relational rows (qty, unit, sell price, attrs e.g. `shadesPerMotor`/`widthInches`) → diffable.
- `bid_edits` — learning loop: field-level diffs (qty/price/line-item/wording). Feeds that tenant's DNA only.

**Network & email**
- `contacts` — GCs/architects/owners per tenant (email is the unit — no email, no contact).
- `emails` — every outbound (bid/intro): stream, status timeline (queued→delivered✓→read✓✓→replied), Mailgun id.

**Billing & plans** *(new — see §5)*
- `plans` — global catalog: name, monthly_price_cents, **included_bids_per_month**, stripe_price_id, active.
- `subscriptions` — per workspace: stripe_customer_id, stripe_subscription_id, plan_id (null in trial),
  status (trialing/active/past_due/canceled), **trial_bids_used**, trial_bids_limit (default 3),
  current_period_start/end.
- `bid_usage_events` — ledger: workspace_id, bid_id, period_start, counted_at. Meters consumption; one
  row per billable bid (avoids double counts, gives an audit trail).

---

## 4 · Routes & components

**Routes** — `/` `/pricing` `/login` `/signup` (marketing/auth) · `/app` dashboard · `/app/onboarding`
· `/app/bids/[id]` review · `/app/network` · `/app/settings` · `/app/billing` · `/app/admin` queue ·
`/app/admin/upload` · `/app/admin/requests/[id]` review & dispatch.

**Shared components (faithful port of mockups):** AppHeader/Nav, Card, StatusPill, DataTable,
Modal, Dropzone, RangeSlider (geo radius), BidDocument (letterhead + line items), EditableCell,
ViewToggle (location/product), WhatWeReadTooltip, SendModal (PDF preview + email composer), SayHiModal,
TradeRelevanceCard, GapFlag, ContractorFanoutRow, PlanCard, UsageMeter.

---

## 5 · Billing & plans (Stripe) — design now, enforce later

**Model:** new user signs up → onboarding → **free trial of 3 bids** (count-based, not time-based) →
after 3, must subscribe to a **monthly package** → each package includes a **fixed number of bids/month**;
the system **caps bids per month per package**.

**What counts as a "bid" (proposed default — open decision):** a `bids` row that reaches
**"ready for review"** for a contractor — i.e., a successfully drafted, priced bid dispatched to them.
No-bid trades, failed extractions, and never-dispatched drafts **don't** count. A bill ledger row
(`bid_usage_events`) is written at draft-ready; declined-by-contractor bids still count (value delivered).

**Enforcement point:** at **admin dispatch** (Phase 1). For each target contractor, check their
workspace's remaining allowance (trial credits, else plan period allowance). Only dispatch within
allowance; **skipped contractors show a reason** ("trial limit reached" / "monthly allowance reached") —
same UI pattern the mockup already uses for "incomplete Pricing DNA". v1 = hard cap + upgrade prompt;
overage billing deferred.

**Stripe integration:** Checkout for subscribe, Customer Portal for self-serve management, webhooks
(`customer.subscription.*`, `invoice.paid|payment_failed`) sync `subscriptions.status` + period dates.
`plans` rows map to Stripe Prices. Monthly allowance reset = on `current_period_start` rollover.

**Phasing:** schema lands in **Stage 0** (no painful migration later); the **bid-consumption ledger hook**
lands in Stage 1 (write the event, no enforcement yet); **trial counting + cap enforcement + Stripe +
billing UI** land in **Stage 5**. Until then everyone is effectively unlimited-trial.

---

## 6 · Stages

| Stage | Ships | Real vs. mock | Acceptance test |
|---|---|---|---|
| **0 · Foundation** | Next.js route groups; Supabase Auth + **full schema incl. billing tables** + RLS + Storage; `bw-` design system + shared components; seed (Shade Co workspace, admin + contractor users, 3 trade configs + Pricing DNA from spike) | all real | both roles log in; RLS isolates tenant; schema migrates clean |
| **1 · Walking skeleton** | Admin upload → **multi-trade scan (all 3 real)** → Review & Dispatch → dispatch. Contractor: dashboard → bid review (location grouping, edit mode, what-we-read) → approve → send (PDF + Mailgun) → Sent. **Full pipe wired for window-treatments**; bid-usage ledger written (no enforcement) | engine = spike pipeline as Trigger.dev tasks; seed = 2160 ITB | **reproduce $17,003.01 through the real app, admin→contractor→sent** |
| **2 · Contractor depth** | Onboarding (Pricing DNA capture, upload-first), Settings (boilerplate), Dashboard states, **learning loop** (`bid_edits`), **Network / say-hi** | real | edits feed DNA; say-hi sends reply-to=contractor |
| **3 · Admin depth + breadth** | **Multi-doc package ingestion**, **missing-doc gap UI + re-score loop** (the 62 ABH demo), **semantic no-bid gate + admin-confirm**, **epoxy + cleaning full extraction/dispatch**, **reply tracking** (✓/✓✓ webhooks) | real | 62 ABH "NO-BID → add doc → BID" works in-app; 2nd/3rd trade dispatch |
| **4 · Multi-tenant hardening** | 2nd tenant onboarding, observability, marketing homepage, perf on 100–200pp sets | real | 2nd tenant onboarded cleanly; big-set runs stable |
| **5 · Billing & plans** | Stripe Checkout/Portal + webhooks, trial (3 bids) enforcement, monthly **bid-cap** enforcement at dispatch, `/app/billing` + UsageMeter, `/pricing` plans | real | trial→subscribe→cap enforced; webhook state sync |

---

## 7 · Cross-cutting requirements (carried from the spike)

1. **Per-vertical schema + pricing** declared by `trades.VerticalConfig` — not one universal shape.
2. **No-bid gate is semantic + admin-confirmed** (keyword scoring and silent gating both proven to fail).
3. **Whole-package ingestion + missing-document detection** (don't guess one file; detect & flag absent docs).
4. **base64- + 200k-token-aware chunking with live re-splitting**, page-hash render cache, **prompt caching**.
5. **Nothing auto-sends**; **sell-price-only + RLS**; **reply-to = contractor**; **immutable sent bids** (boilerplate snapshot).

---

## 8 · Open decisions

- **Trade scope of the first slice:** windows-leads (default) vs. all-3-end-to-end. One-line switch.
- **Bid metering definition:** confirm a "bid" = draft-ready dispatched bid (vs. sent-only). Affects the ledger trigger.
- **Overage policy:** hard cap + upgrade (v1) vs. metered overage billing (later).
- **Trial reset:** 3 bids lifetime (proposed) vs. per-period. Proposed: lifetime, pre-subscription only.
