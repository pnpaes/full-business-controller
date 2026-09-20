-- Down path for 0025_mapping_state_conflict.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Restores the pre-0025 four-value `MAPPING_STATE` checks on `import_staging_row`
-- and `sales_line` (`unmapped`/`mapped`/`ignored`/`error`). It touches no table
-- and no row, but re-adding the narrower checks **validates existing rows**, so
-- it fails (and rolls back, leaving 0025 in place) if any row already holds
-- `mapping_state = 'conflict'`. Resolve those rows first (re-map them, or set
-- them back to `error` with the conflict recorded in `error_code`). Apply it
-- manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0025_mapping_state_conflict_down.sql
BEGIN;

ALTER TABLE "import_staging_row"
  DROP CONSTRAINT IF EXISTS "import_staging_row_mapping_state_check";
ALTER TABLE "sales_line"
  DROP CONSTRAINT IF EXISTS "sales_line_mapping_state_check";

ALTER TABLE "import_staging_row"
  ADD CONSTRAINT "import_staging_row_mapping_state_check"
  CHECK ("import_staging_row"."mapping_state" in ('unmapped', 'mapped', 'ignored', 'error'));
ALTER TABLE "sales_line"
  ADD CONSTRAINT "sales_line_mapping_state_check"
  CHECK ("sales_line"."mapping_state" in ('unmapped', 'mapped', 'ignored', 'error'));

COMMIT;
