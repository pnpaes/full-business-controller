-- Down path for 0052_shift_scheduling_org_guard.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-037`/`DEC-038` cross-organization coherence guards: the
-- `shift_location_org_guard`, `shift_assignment_shift_org_guard` and
-- `shift_assignment_employee_org_guard` triggers and their functions. No table
-- and no row is touched, so it is safe to run whenever the cross-organization
-- invariant must be removed (for example before a data repair). While dropped,
-- the organization coherence of a shift's `location_id` and an assignment's
-- `shift_id`/`employee_id` is validated only by the application until the
-- migration is re-applied. Apply `0052`'s org-guard down **before**
-- `0051_shift_scheduling_down.sql`, because its triggers live on the tables
-- that down drops.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0052_shift_scheduling_org_guard_down.sql
BEGIN;

DROP TRIGGER IF EXISTS "shift_assignment_employee_org_guard" ON "shift_assignment";
DROP TRIGGER IF EXISTS "shift_assignment_shift_org_guard" ON "shift_assignment";
DROP TRIGGER IF EXISTS "shift_location_org_guard" ON "shift";
DROP FUNCTION IF EXISTS "shift_assignment_employee_org_guard"();
DROP FUNCTION IF EXISTS "shift_assignment_shift_org_guard"();
DROP FUNCTION IF EXISTS "shift_location_org_guard"();

COMMIT;
