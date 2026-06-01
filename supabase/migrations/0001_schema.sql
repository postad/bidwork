-- ============================================================================
-- BidWork — 0001 schema (run first)
-- Multi-tenant auto-bidding. ~16 tables in 6 groups. See BUILD-PLAN.md §3.
-- Safe to run on a fresh Supabase project. RLS is enabled here; policies are in 0002.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------- enums ----------------------------------------------------------
do $$ begin
  create type user_role          as enum ('admin','contractor');
  create type bid_status         as enum ('draft','ready','approved','sent','declined');
  create type request_status     as enum ('processing','needs_review','dispatched','archived');
  create type relevance          as enum ('bid','no_bid');
  create type gap_severity       as enum ('critical','warning');
  create type email_stream       as enum ('bid','outreach');
  create type email_status       as enum ('queued','delivered','read','replied','failed');
  create type subscription_status as enum ('trialing','active','past_due','canceled');
exception when duplicate_object then null; end $$;

-- ---------- generic updated_at trigger -------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- geo helper (miles, haversine) ----------------------------------
create or replace function public.miles_between(lat1 double precision, lng1 double precision,
                                                 lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 3958.7613 * 2 * asin(sqrt(
    power(sin(radians(lat2-lat1)/2),2) +
    cos(radians(lat1))*cos(radians(lat2))*power(sin(radians(lng2-lng1)/2),2)
  ));
$$;

-- ===========================================================================
-- GROUP 1 · Tenancy & identity
-- ===========================================================================
create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  workspace_id    uuid references public.workspaces(id) on delete set null, -- null for global operators
  role            user_role not null default 'contractor',
  full_name       text,
  email           text,
  -- branding (contractor)
  company_name    text,
  website         text,
  address         text,
  description     text,
  logo_url        text,
  reply_to_email  text,
  mailbox_token_ref text,            -- reference to connected-mailbox OAuth token (never the token itself)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index profiles_workspace_idx on public.profiles(workspace_id);

-- ===========================================================================
-- GROUP 2 · Trades & pricing
-- ===========================================================================
create table public.trades (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,                  -- 'window-treatments', 'cleaning-waste-removal', 'epoxy-floors'
  label         text not null,
  vertical_config jsonb not null default '{}'::jsonb,  -- units, router, noBidSignals, requiredEvidence, extraction schema + pricing model
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.workspace_trades (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  trade_id      uuid not null references public.trades(id) on delete cascade,
  center_zip    text,
  center_lat    double precision,
  center_lng    double precision,
  radius_mi     integer not null default 100,
  created_at    timestamptz not null default now(),
  unique (workspace_id, trade_id)
);
create index workspace_trades_trade_idx on public.workspace_trades(trade_id);

create table public.pricing_items (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  trade_id      uuid not null references public.trades(id) on delete cascade,
  code          text not null,                  -- e.g. 'WT', 'MB', 'FPS', 'INSTALL'
  label         text not null,
  unit          text not null,                  -- 'per-motor-set','per-blind','per-shade','per-sqft','flat'
  sell_price    numeric(12,2),                  -- sell price only; never cost/margin
  pricing       jsonb not null default '{}'::jsonb, -- tiered structures (byShadesPerMotor, byWidthTier, ...)
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index pricing_items_ws_trade_idx on public.pricing_items(workspace_id, trade_id);

-- ===========================================================================
-- GROUP 3 · Requests & extraction  (operator-owned)
-- ===========================================================================
create table public.bid_requests (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  created_by      uuid references public.profiles(id) on delete set null,
  center_zip      text,
  center_lat      double precision,
  center_lng      double precision,
  radius_mi       integer not null default 100,
  status          request_status not null default 'processing',
  trade_scores    jsonb not null default '[]'::jsonb,   -- [{trade_slug, relevance, confidence, reasoning, relevant_pages}]
  doc_gaps        jsonb not null default '[]'::jsonb,   -- document-level gaps (severity, message, ...)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  bid_request_id  uuid not null references public.bid_requests(id) on delete cascade,
  filename        text not null,
  storage_path    text not null,               -- Supabase Storage object path
  bytes           bigint,
  page_count      integer,
  page_meta       jsonb not null default '{}'::jsonb,  -- classification, page-hash cache keys, rotation
  created_at      timestamptz not null default now()
);
create index documents_request_idx on public.documents(bid_request_id);

create table public.extractions (
  id              uuid primary key default gen_random_uuid(),
  bid_request_id  uuid not null references public.bid_requests(id) on delete cascade,
  trade_id        uuid not null references public.trades(id) on delete cascade,
  relevance       relevance not null,
  confidence      numeric(4,3),
  result          jsonb not null default '{}'::jsonb,   -- raw structured extract (per-vertical shape) + confidence + citations
  created_at      timestamptz not null default now(),
  unique (bid_request_id, trade_id)
);

-- ===========================================================================
-- GROUP 4 · Bids & learning  (workspace-scoped)
-- ===========================================================================
create table public.bids (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  bid_request_id    uuid references public.bid_requests(id) on delete set null,
  trade_id          uuid not null references public.trades(id) on delete cascade,
  status            bid_status not null default 'draft',
  project_name      text,
  gc_contact_name   text,
  gc_contact_email  text,
  bid_due_date      date,
  subtotal          numeric(12,2),
  discount_label    text,
  discount_amount   numeric(12,2),
  delivery_install  numeric(12,2),
  tax_rate          numeric(6,5),
  tax_amount        numeric(12,2),
  total             numeric(12,2),
  notes_to_gc       text,
  boilerplate_snapshot jsonb,                  -- frozen terms/exclusions/disclaimer at send (immutable record)
  billable          boolean not null default true,
  counted_at        timestamptz,               -- set when metered into bid_usage_events
  sent_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index bids_ws_idx on public.bids(workspace_id);
create index bids_request_idx on public.bids(bid_request_id);

create table public.bid_line_items (
  id            uuid primary key default gen_random_uuid(),
  bid_id        uuid not null references public.bids(id) on delete cascade,
  sort_order    integer not null default 0,
  location      text,                          -- floor/room/zone (vertical-configurable grouping)
  type_code     text,                          -- e.g. WT1, MB1, FPS1
  description   text,
  qty           numeric(12,2),
  unit          text,
  unit_price    numeric(12,2),
  amount        numeric(12,2),
  attrs         jsonb not null default '{}'::jsonb,  -- shadesPerMotor, widthInches, etc.
  source_note   jsonb,                         -- "what we read": sheet, assumptions, flags
  created_at    timestamptz not null default now()
);
create index bid_line_items_bid_idx on public.bid_line_items(bid_id);

create table public.bid_edits (
  id            uuid primary key default gen_random_uuid(),
  bid_id        uuid not null references public.bids(id) on delete cascade,
  line_item_id  uuid references public.bid_line_items(id) on delete set null,
  category      text not null,                 -- 'quantity' | 'price' | 'line_item' | 'wording'
  field         text,
  old_value     jsonb,
  new_value     jsonb,
  created_at    timestamptz not null default now()
);
create index bid_edits_bid_idx on public.bid_edits(bid_id);

-- ===========================================================================
-- GROUP 5 · Network & email  (workspace-scoped)
-- ===========================================================================
create table public.contacts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null,
  role          text,                          -- GC | Architect | Owner | Designer | Engineer | Other
  company       text,
  email         text,                          -- email is the unit — no email, no contact
  found_in      text,
  source_bid_request_id uuid references public.bid_requests(id) on delete set null,
  in_network    boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (workspace_id, email)
);
create index contacts_ws_idx on public.contacts(workspace_id);

create table public.emails (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  stream          email_stream not null,
  bid_id          uuid references public.bids(id) on delete set null,
  contact_id      uuid references public.contacts(id) on delete set null,
  to_email        text not null,
  reply_to        text,
  subject         text,
  status          email_status not null default 'queued',
  mailgun_message_id text,
  queued_at       timestamptz not null default now(),
  delivered_at    timestamptz,
  read_at         timestamptz,
  replied_at      timestamptz
);
create index emails_ws_idx on public.emails(workspace_id);

-- ===========================================================================
-- GROUP 6 · Billing & plans  (schema now, enforce in Stage 5)
-- ===========================================================================
create table public.plans (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  name                  text not null,
  monthly_price_cents   integer not null,
  included_bids_per_month integer not null,
  stripe_price_id       text,
  active                boolean not null default true,
  created_at            timestamptz not null default now()
);

create table public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references public.workspaces(id) on delete cascade unique,
  plan_id                uuid references public.plans(id) on delete set null, -- null while trialing
  stripe_customer_id     text,
  stripe_subscription_id text,
  status                 subscription_status not null default 'trialing',
  trial_bids_limit       integer not null default 3,
  trial_bids_used        integer not null default 0,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table public.bid_usage_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  bid_id        uuid not null references public.bids(id) on delete cascade unique, -- one ledger row per billable bid
  period_start  timestamptz,
  counted_at    timestamptz not null default now()
);
create index bid_usage_ws_period_idx on public.bid_usage_events(workspace_id, period_start);

-- ---------- updated_at triggers --------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['workspaces','profiles','trades','pricing_items','bid_requests','bids','subscriptions'] loop
    execute format('create trigger %I_set_updated before update on public.%I for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;

-- ---------- enable RLS (policies in 0002) ----------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'workspaces','profiles','trades','workspace_trades','pricing_items',
    'bid_requests','documents','extractions','bids','bid_line_items','bid_edits',
    'contacts','emails','plans','subscriptions','bid_usage_events'] loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
