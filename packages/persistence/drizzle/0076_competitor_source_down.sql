-- Down path for 0076_competitor_source.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md,
-- "Down migrations").
--
-- Drops the five §4C columns added to `competitor_observation`
-- (`competitor_source_id` and its FK/index, `capture_method` and its check,
-- `product_category`, `season`, `provenance`) and then the `competitor_source`
-- table. The drop order is explicit: the observation FK is removed before its
-- target table. The column drops are **destructive** to any §4C provenance or
-- source link recorded after the expand; the pre-existing `DEC-126` columns
-- (`source`/`source_url`/`review_status`, `competitor`, and every observation
-- row) are left intact, so this down is far narrower than `0066`'s. Take a
-- backup before running it. Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0076_competitor_source_down.sql
BEGIN;

ALTER TABLE "competitor_observation" DROP CONSTRAINT IF EXISTS "competitor_observation_capture_method_check";
DROP INDEX IF EXISTS "competitor_observation_source_idx";
ALTER TABLE "competitor_observation"
  DROP CONSTRAINT IF EXISTS "competitor_observation_competitor_source_id_competitor_source_id_fk";
ALTER TABLE "competitor_observation" DROP COLUMN IF EXISTS "competitor_source_id";
ALTER TABLE "competitor_observation" DROP COLUMN IF EXISTS "capture_method";
ALTER TABLE "competitor_observation" DROP COLUMN IF EXISTS "product_category";
ALTER TABLE "competitor_observation" DROP COLUMN IF EXISTS "season";
ALTER TABLE "competitor_observation" DROP COLUMN IF EXISTS "provenance";

DROP TABLE IF EXISTS "competitor_source";

COMMIT;
