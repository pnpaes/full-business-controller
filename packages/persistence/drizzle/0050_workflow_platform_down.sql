-- Down path for 0050_workflow_platform.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-094` schema-only workflow platform tables: `approval` first,
-- then `task` (both reference only `organization`, so the order is FK-safe).
-- The checks, the single-column organization FKs and the org-first indexes go
-- with the tables. There is no companion org-guard migration: neither table has
-- a cross-organization FK beyond `organization_id`, so `0050` is the only file.
-- This is **destructive**: every task and approval row is lost, so take a backup
-- or export first if the tables hold data.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0050_workflow_platform_down.sql
BEGIN;

DROP TABLE IF EXISTS "approval";
DROP TABLE IF EXISTS "task";

COMMIT;
