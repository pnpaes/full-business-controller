-- Down path for 0054_shift_adjustment_org_guard.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-038` cross-organization coherence guard for the worked-hours
-- correction: the `shift_adjustment_shift_assignment_org_guard` trigger and its
-- function. No table and no row is touched, so it is safe to run whenever the
-- cross-organization invariant must be removed (for example before a data
-- repair). While dropped, the organization coherence of a shift adjustment's
-- `shift_assignment_id` is validated only by the application until the migration
-- is re-applied. Apply `0054`'s org-guard down **before**
-- `0053_shift_adjustment_down.sql`, because its trigger lives on the table that
-- down drops.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0054_shift_adjustment_org_guard_down.sql
BEGIN;

DROP TRIGGER IF EXISTS "shift_adjustment_shift_assignment_org_guard" ON "shift_adjustment";
DROP FUNCTION IF EXISTS "shift_adjustment_shift_assignment_org_guard"();

COMMIT;
