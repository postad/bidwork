# BidWork — Stage 0 setup

One-time setup so we can work locally and push GitHub → Vercel. Do these in order.

## Repo layout (what goes where)

```
/                     spec.html · BUILD-PLAN.md · mockups (*.html)   ← docs / design source of truth
/web                  Next.js 14 app  ← Vercel "Root Directory" = web   (scaffolded next)
/supabase/migrations  the SQL you run on your Supabase project
/spike                validated engine prototype (reference; reused by /web)
/Projects             sample bid docs — GIT-IGNORED (never pushed)
```

## 1 · Supabase (you: create project + run SQL)

Follow **`supabase/README.md`**: run `0001 → 0002 → 0003`, create the admin + contractor
users, link their profiles, create the 3 storage buckets, then copy your keys.

## 2 · GitHub (you: create repo)

From this folder:
```bash
git init
git add .
git commit -m "BidWork: spec, build plan, engine spike, Supabase migrations"
git branch -M main
git remote add origin git@github.com:<you>/bidwork.git
git push -u origin main
```
`Projects/`, `node_modules/`, `.env*`, and `.next/` are already git-ignored — your sample
docs and secrets won't be pushed.

## 3 · Vercel (you: import + configure)

- Import the GitHub repo.
- **Root Directory → `web`** (the Next.js app lives there).
- Add env vars from `.env.example` (the `NEXT_PUBLIC_*` ones + `SUPABASE_SERVICE_ROLE_KEY`;
  Stripe/Mailgun/Trigger can wait until their stages).
- Every push to `main` auto-deploys; PRs get preview deploys.

## 4 · Local dev (once /web is scaffolded)

```bash
cd web
cp ../.env.example .env.local   # fill in Supabase URL + keys
npm install
npm run dev                     # http://localhost:3000
```

## Status

- [x] Database schema + RLS + seed (`/supabase/migrations`)
- [x] `/web` Next.js scaffold (App Router, Tailwind + `bw-` tokens, Supabase SSR clients, auth middleware, route groups, design-system primitives, dashboard + operator queue shells) — builds clean
- [ ] Stage 1 walking skeleton (admin upload → engine → dispatch → bid review → send) ← **next**

See **BUILD-PLAN.md** for the full stage plan.
