-- Down path for 0066_competitor_observations.sql. Not listed in meta/_journal.json
-- on purpose: `drizzle-kit migrate` only applies journal entries, so a rollback
-- is an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-126` `competitor_observation` table first (its organization/
-- `competitor`/`item` NO ACTION FKs, its review-status/price/review-gate checks
-- and its two `(…, observed_at)` indexes go with it) and then `competitor` (its
-- organization FK and its `(organization_id, name)` unique go with it). Both
-- drops are **destructive**: every captured observation and every competitor in
-- the register is lost. Both tables were added with **no backfill**, so only rows
-- added after the expand are at risk; take a backup or export first if either
-- holds data. Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0066_competitor_observations_down.sql
BEGIN;

DROP TABLE IF EXISTS "competitor_observation";

DROP TABLE IF EXISTS "competitor";

COMMIT;
