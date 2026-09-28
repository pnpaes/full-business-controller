-- Down path for 0080_role_position.sql (`DEC-151`). Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md, "Down migrations").
--
-- Drops the org-coherence triggers and their functions, the employee role FK,
-- the `shift.position_id` column (and its FK/index), then the
-- `employee_position` join table and the `position` catalogue.
--
-- Destructive to the expansion only. It does NOT revert the `employee.role_code`
-- normalisation (the alias rewrite and the created role rows stay — the values
-- are a valid `ROLE_CODE` either way) and it does NOT restore `shift.role_code`
-- from the backfilled position (that column was never dropped). Take a backup
-- before running it (AGENTS.md Rule 2). Apply manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0080_role_position_down.sql
BEGIN;

DROP TRIGGER IF EXISTS "shift_position_org_guard" ON "shift";
DROP FUNCTION IF EXISTS "shift_position_org_guard"();

DROP TRIGGER IF EXISTS "employee_position_position_org_guard" ON "employee_position";
DROP FUNCTION IF EXISTS "employee_position_position_org_guard"();

DROP TRIGGER IF EXISTS "employee_position_employee_org_guard" ON "employee_position";
DROP FUNCTION IF EXISTS "employee_position_employee_org_guard"();

ALTER TABLE "employee" DROP CONSTRAINT IF EXISTS "employee_organization_id_role_code_fk";
DROP INDEX IF EXISTS "employee_org_role_code_idx";

DROP INDEX IF EXISTS "shift_org_position_idx";
ALTER TABLE "shift" DROP CONSTRAINT IF EXISTS "shift_position_id_position_id_fk";
ALTER TABLE "shift" DROP COLUMN IF EXISTS "position_id";

DROP TABLE IF EXISTS "employee_position";
DROP TABLE IF EXISTS "position";

COMMIT;
