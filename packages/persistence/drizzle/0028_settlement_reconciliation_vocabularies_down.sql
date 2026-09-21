-- Down path for 0028_settlement_reconciliation_vocabularies.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Restores the pre-0028 state: drops the `settlement_status_check`
-- (`DEC-078` (a)) and `reconciliation_scope_type_check` (`DEC-078` (b)) checks
-- and removes the `settlement.status` default of `received`, so those columns
-- return to unconstrained/required text. It touches no table and no row, and
-- dropping a check never validates existing rows, so the down cannot fail on
-- data — while dropped, `settlement.status` and `reconciliation.scope_type` are
-- validated only by the application. Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0028_settlement_reconciliation_vocabularies_down.sql
BEGIN;

ALTER TABLE "settlement"
  DROP CONSTRAINT IF EXISTS "settlement_status_check";
ALTER TABLE "reconciliation"
  DROP CONSTRAINT IF EXISTS "reconciliation_scope_type_check";

ALTER TABLE "settlement"
  ALTER COLUMN "status" DROP DEFAULT;

COMMIT;
