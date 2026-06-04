-- ============================================================================
-- BidWork — 0011 zip ingest + triage (run after 0010). Idempotent.
-- The admin now drops PlanHub project zips (one per project). engine.ingest
-- unzips server-side, then a cheap per-file triage pass classifies each PDF and
-- drops clear non-content (standalone takeoffs, bid bonds, insurance certs, wage
-- forms) so the expensive scan only reads files with biddable scope.
--   • documents.skipped  — true = triage dropped it; scan-request ignores these.
--   • documents.triage   — the triage verdict (kind/keep/confidence/reason) for review.
-- ============================================================================

alter table public.documents add column if not exists skipped boolean not null default false;
alter table public.documents add column if not exists triage  jsonb;

-- PlanHub zips bundle ~8 large drawing sets + a spec book — a single zip routinely
-- exceeds the 100 MB per-file limit set in 0007. Raise the bid-docs cap to fit the
-- transient zip (engine.ingest deletes it after unzipping). NOTE: the project-wide
-- upload limit (Dashboard → Settings → Storage) still clamps every bucket — it must
-- be raised to >= this value or large zips are rejected before they reach the bucket.
update storage.buckets set file_size_limit = 524288000 where id = 'bid-docs';   -- 500 MB
