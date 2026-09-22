-- Down path for 0046_workforce.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-087` (`WF-007`, `DOC-001`…`DOC-004`) workforce personnel slice
-- tables: `employee_document` first, because it FKs `employee` (and
-- `file_object`), then `employee`. The indexes and the single-column FKs go with
-- the tables; the cross-organization guard triggers and functions are dropped by
-- the companion `0047_workforce_org_guard_down.sql`, which must be applied
-- **before** this file. This is **destructive**: every employee and personnel
-- document row is lost, so take a backup or export first if the tables hold
-- data.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0046_workforce_down.sql
BEGIN;

DROP TABLE IF EXISTS "employee_document";
DROP TABLE IF EXISTS "employee";

COMMIT;
