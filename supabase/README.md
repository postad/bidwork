# BidWork — Database setup (Supabase)

Run the migrations **in order** in the Supabase SQL editor (or `psql`), then create
the two test users and link their profiles. Idempotent where possible.

## 1 · Run migrations (in order)

| File | What it does |
|---|---|
| `migrations/0001_schema.sql` | extensions, enums, ~16 tables, triggers, enables RLS |
| `migrations/0002_rls.sql`    | RLS helper functions + tenant-isolation policies |
| `migrations/0003_seed.sql`   | 3 trade configs, plan catalog, Shade Co workspace + Pricing DNA |
| `migrations/0004_pricing_extras.sql` | TAX/DISCOUNT pricing-item convention |
| `migrations/0005_workspace_settings.sql` | workspace settings + pricing_items unique key |
| `migrations/0006_bid_kind.sql` | `bids.kind` ('priced' \| 'site_visit') |
| `migrations/0007_bucket_size_limits.sql` | Storage bucket file-size limits (100 MB bid-docs) |
| `migrations/0008_categories.sql` | `trades.category` + `category_label` (catalog grouping) |
| `migrations/0009_flooring_catalog.sql` | full **Flooring** category — sub-trade chips (carpet, vinyl/VCT, epoxy, polished/sealed concrete, wood, tile, …) sharing one pipeline |
| `migrations/0010_wt_seed_review.sql` | expands window-treatments router keywords/CSI (recall) |

Paste each file's contents into **SQL Editor → New query → Run**, in order 0001 → 0010.

> **Categories vs. pricing.** 0008–0010 seed only the trade *catalog* + scanner keywords — never prices. Every contractor's rate card is trained from their own proposals at onboarding (`pricing_items`), never seeded.

## 1b · Self-serve signup

Contractors create their own accounts at **`/signup`** → pick category + sub-trades at
`/app/onboarding/trades` → train pricing at `/app/onboarding`.

Signup runs entirely server-side via the service-role admin API
([signup/actions.ts](../web/app/(marketing)/signup/actions.ts) `signUpContractor`): it
creates the auth user **pre-confirmed**, then the workspace + profile + trialing
subscription atomically (rolling back the auth user if any step fails). The browser
then signs in with the same credentials. **No dependency on the "Confirm email"
toggle** — it works whether confirmation is on or off. Requires `SUPABASE_SERVICE_ROLE_KEY`
in the web app's env (already needed by the engine).

## 2 · Create the operator (admin) user

The **admin** still has no signup path (operators are created by hand). Contractors use `/signup` above. Supabase **Authentication → Users → Add user** (email + password, auto-confirm):
- an **operator/admin** (e.g. `support@postad.io`)
- optionally the legacy **Shade Co contractor** (e.g. `sales@shadesco.com`) to use the seeded fixture

Copy each user's **UID**, then run this once (replace the two UIDs):

```sql
insert into public.profiles (id, workspace_id, role, full_name, email, company_name, address, website, reply_to_email)
values
  ('<ADMIN_AUTH_UID>',      null, 'admin',      'BidWork Operator',  'support@postad.io', null, null, null, null),
  ('<CONTRACTOR_AUTH_UID>', '11111111-1111-1111-1111-111111111111', 'contractor',
     'The Shade Company', 'sales@shadesco.com', 'The Shade Company',
     '500 7th Avenue 9th Floor, New York NY 10018', 'www.shadesco.com', 'sales@shadesco.com')
on conflict (id) do update
  set workspace_id = excluded.workspace_id, role = excluded.role,
      company_name = excluded.company_name, address = excluded.address;
```

> Stage 1 will move profile creation into an automatic `auth.users` trigger / server action.
> For now this manual link is fine to test RLS.

## 3 · Create Storage buckets

```sql
insert into storage.buckets (id, name, public, file_size_limit) values
  ('bid-docs','bid-docs', false, 104857600),   -- uploaded ITB/RFP PDFs (100 MB — combined arch sets get big)
  ('bid-files','bid-files', false, 52428800),  -- generated proposal PDFs (50 MB)
  ('logos','logos', true, 5242880)             -- tenant logos (5 MB)
on conflict (id) do nothing;
```
Storage RLS policies are added in Stage 1 when uploads are wired.

## 4 · Keys → env

Project **Settings → API**: copy the **Project URL**, **anon** key, and **service_role** key into
`web/.env.local` (see `.env.example`). The service-role key is server-only and bypasses RLS.

## Sanity checks

```sql
select slug, label from public.trades;                 -- 3 rows
select slug, included_bids_per_month from public.plans; -- 3 rows
select code, unit, sell_price, pricing from public.pricing_items; -- Shade Co DNA (WT/MB/FPS/INSTALL)
-- as the contractor user, this should return only their workspace rows (RLS):
select * from public.pricing_items;
```
