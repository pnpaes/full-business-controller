-- Down path for 0056_payroll_report_org_guard.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-037` cross-organization coherence guard for the monthly
-- payroll-input report: the `payroll_report_export_file_org_guard` trigger and
-- its function. No table and no row is touched, so it is safe to run whenever
-- the cross-organization invariant must be removed (for example before a data
-- repair). While dropped, the organization coherence of a report's
-- `export_file_id` is validated only by the application until the migration is
-- re-applied. Apply `0056`'s org-guard down **before**
-- `0055_payroll_report_down.sql`, because its trigger lives on the table that
-- down drops.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0056_payroll_report_org_guard_down.sql
BEGIN;

DROP TRIGGER IF EXISTS "payroll_report_export_file_org_guard" ON "payroll_report";
DROP FUNCTION IF EXISTS "payroll_report_export_file_org_guard"();

COMMIT;
