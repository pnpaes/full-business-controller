-- Down path for 0078_competitor_observation_content_hash.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md, "Down migrations").
--
-- Drops the partial unique index and then the nullable `content_hash` column.
-- The column drop is **destructive** to the captured idempotency keys, so a
-- revert re-arms duplicate capture (the pre-0078 behaviour) and a later re-apply
-- would rebuild the index from an empty column. No observation rows, no other
-- column and no other index is touched. Take a backup before running it. Apply
-- it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0078_competitor_observation_content_hash_down.sql
BEGIN;

DROP INDEX IF EXISTS "competitor_observation_org_source_content_hash_key";
ALTER TABLE "competitor_observation" DROP COLUMN IF EXISTS "content_hash";

COMMIT;
