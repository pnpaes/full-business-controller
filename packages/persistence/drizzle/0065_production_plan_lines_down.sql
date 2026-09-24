-- Down path for 0065_production_plan_lines.sql. Not listed in meta/_journal.json
-- on purpose: `drizzle-kit migrate` only applies journal entries, so a rollback
-- is an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-125` `production_plan_line` table — its organization FK, its
-- cascade `production_plan` FK, its `recipe_version` NO ACTION FK, its
-- `planned_qty > 0` check and its `(plan_id)` index go with the table — and the
-- additive nullable `production_batch.planned_qty` column (its check goes with
-- it). Both drops are **destructive**: every plan line and every recorded batch
-- planned quantity is lost. The column/table were added with no backfill, so a
-- row added after the expand is the only data at risk; take a backup or export
-- first if either holds data. Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0065_production_plan_lines_down.sql
BEGIN;

ALTER TABLE "production_batch" DROP COLUMN IF EXISTS "planned_qty";

DROP TABLE IF EXISTS "production_plan_line";

COMMIT;
