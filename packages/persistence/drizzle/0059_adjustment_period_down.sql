-- Down path for 0059_adjustment_period.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the `REC-006`/`DEC-027` (row 13b) adjustment-period table
-- `adjustment_period`. Its organization FK, its three checks, its partial unique
-- `adjustment_period_open_key` and its two indexes go with the table. The table
-- carries no trigger and no companion guard migration. This is **destructive**:
-- every adjustment period (and its approval) is lost, so take a backup or export
-- first if the table holds data. Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0059_adjustment_period_down.sql
BEGIN;

DROP TABLE IF EXISTS "adjustment_period";

COMMIT;
