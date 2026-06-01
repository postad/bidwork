# BidWork — Database setup (Supabase)

Run the migrations **in order** in the Supabase SQL editor (or `psql`), then create
the two test users and link their profiles. Idempotent where possible.

## 1 · Run migrations (in order)

| File | What it does |
|---|---|
| `migrations/0001_schema.sql` | extensions, enums, ~16 tables, triggers, enables RLS |
| `migrations/0002_rls.sql`    | RLS helper functions + tenant-isolation policies |
| `migrations/0003_seed.sql`   | 3 trade configs, plan catalog, Shade Co workspace + Pricing DNA |

Paste each file's contents into **SQL Editor → New query → Run**, 0001 → 0002 → 0003.

## 2 · Create the two test users

Supabase **Authentication → Users → Add user** (email + password, auto-confirm):
- an **operator/admin** (e.g. `support@postad.io`)
- a **contractor** (e.g. `sales@shadesco.com`)

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
insert into storage.buckets (id, name, public) values
  ('bid-docs','bid-docs', false),   -- uploaded ITB/RFP PDFs
  ('bid-files','bid-files', false), -- generated proposal PDFs
  ('logos','logos', true)           -- tenant logos
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
