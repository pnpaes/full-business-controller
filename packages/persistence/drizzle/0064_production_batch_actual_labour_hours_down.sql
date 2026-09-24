-- Down path for 0064_production_batch_actual_labour_hours.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-124` additive nullable `production_batch.actual_labour_hours`
-- column; its `production_batch_actual_labour_hours_check` goes with it. This is
-- **destructive**: every recorded actual labour-hours value on a batch is lost,
-- and the column backs a production fact, so take a backup or export first if it
-- holds data. Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0064_production_batch_actual_labour_hours_down.sql
BEGIN;

ALTER TABLE "production_batch" DROP COLUMN IF EXISTS "actual_labour_hours";

COMMIT;
