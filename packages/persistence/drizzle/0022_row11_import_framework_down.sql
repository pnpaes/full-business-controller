-- Down path for 0022_row11_import_framework.sql. Not listed in meta/_journal.json
-- on purpose: `drizzle-kit migrate` only applies journal entries, so a rollback
-- is an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the three row-11 import-framework tables (`import_staging_row`,
-- `import_run`, `external_mapping`) inside one transaction, in FK-safe order
-- (the staging child before its `import_run` parent). This is **destructive**:
-- any import-run, staging-row or external-mapping rows are lost, so it is only
-- safe while those tables carry nothing that must be preserved. Apply it
-- manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0022_row11_import_framework_down.sql
--
-- No hand-written invariant is involved: row 11 posts no stock movement, so the
-- `stock_movement_source_guard` trigger is untouched (the `sales_line` branch
-- belongs to row 12, which is owner-gated on ADR-0008).
BEGIN;

DROP TABLE IF EXISTS "import_staging_row";
DROP TABLE IF EXISTS "import_run";
DROP TABLE IF EXISTS "external_mapping";

COMMIT;
