-- Down path for 0024_reconciliation_tolerance.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the hand-written `reconciliation_tolerance_no_overlap` EXCLUDE
-- constraint and then the `reconciliation_tolerance` table inside one
-- transaction. The constraint is dropped explicitly first (rather than relying
-- on the table drop) so a plain `DROP TABLE` is the only remaining step and any
-- constraint-drop failure surfaces on its own. This is **destructive**: any
-- effective-dated tolerance configuration rows are lost, so it is only safe
-- while that configuration carries nothing that must be preserved. Apply it
-- manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0024_reconciliation_tolerance_down.sql
BEGIN;

ALTER TABLE "reconciliation_tolerance"
  DROP CONSTRAINT IF EXISTS "reconciliation_tolerance_no_overlap";
DROP TABLE IF EXISTS "reconciliation_tolerance";

COMMIT;
