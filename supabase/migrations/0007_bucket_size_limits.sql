-- ============================================================================
-- BidWork — 0007 storage bucket size limits (run after 0006). Idempotent.
-- The re-score loop uploads combined arch/MEP sets straight to Storage from the
-- browser. With file_size_limit NULL the bucket inherited the project-wide cap
-- and rejected a 23.8 MB ARCH COMBINED SET with "The object exceeded the maximum
-- allowed size". Set explicit per-bucket limits so this is reproducible across
-- environments. NOTE: the project-wide upload limit (Settings → Storage) still
-- clamps every bucket — keep it >= the largest value below.
-- ============================================================================

update storage.buckets set file_size_limit = 104857600 where id = 'bid-docs';   -- 100 MB: uploaded ITB/RFP sets
update storage.buckets set file_size_limit = 52428800  where id = 'bid-files';  -- 50 MB: generated proposal PDFs
update storage.buckets set file_size_limit = 5242880   where id = 'logos';      -- 5 MB: tenant logos
