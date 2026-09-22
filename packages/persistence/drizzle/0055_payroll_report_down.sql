-- Down path for 0055_payroll_report.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-037` (`WF-005`) monthly payroll-input report table
-- `payroll_report`. Its organization FK, its nullable `export_file_id` FK to
-- `file_object`, its `(organization_id, period_start)` unique, its checks and
-- its two indexes go with the table; the cross-organization guard trigger and
-- function are dropped by the companion
-- `0056_payroll_report_org_guard_down.sql`, which must be applied **before**
-- this file. This is **destructive**: every report row (and its frozen
-- snapshot) is lost, so take a backup or export first if the table holds data.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0055_payroll_report_down.sql
BEGIN;

DROP TABLE IF EXISTS "payroll_report";

COMMIT;
