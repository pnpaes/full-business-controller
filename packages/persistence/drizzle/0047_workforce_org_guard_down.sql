-- Down path for 0047_workforce_org_guard.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-087` cross-organization coherence guards: the
-- `employee_primary_location_org_guard`, `employee_user_org_guard`,
-- `employee_document_employee_org_guard` and
-- `employee_document_file_object_org_guard` triggers and their functions. No
-- table and no row is touched, so it is safe to run whenever the
-- cross-organization invariant must be removed (for example before a data
-- repair). While dropped, the organization coherence of an employee's
-- `primary_location_id`/`user_id` and a document's
-- `employee_id`/`file_object_id` is
-- validated only by the application until the migration is re-applied. Apply
-- `0047`'s org-guard down **before** `0046_workforce_down.sql`, because its
-- triggers live on the tables that down drops.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0047_workforce_org_guard_down.sql
BEGIN;

DROP TRIGGER IF EXISTS "employee_document_file_object_org_guard" ON "employee_document";
DROP TRIGGER IF EXISTS "employee_document_employee_org_guard" ON "employee_document";
DROP TRIGGER IF EXISTS "employee_primary_location_org_guard" ON "employee";
DROP TRIGGER IF EXISTS "employee_user_org_guard" ON "employee";
DROP FUNCTION IF EXISTS "employee_document_file_object_org_guard"();
DROP FUNCTION IF EXISTS "employee_document_employee_org_guard"();
DROP FUNCTION IF EXISTS "employee_primary_location_org_guard"();
DROP FUNCTION IF EXISTS "employee_user_org_guard"();

COMMIT;
