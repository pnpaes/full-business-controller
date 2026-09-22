-- Down path for 0053_shift_adjustment.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-038` (`WF-004`) worked-hours correction table
-- (`shift_adjustment`), which FKs `shift_assignment`. The single-column FKs, the
-- checks and the index go with the table; the cross-organization guard trigger
-- and its function are dropped by the companion
-- `0054_shift_adjustment_org_guard_down.sql`, which must be applied **before**
-- this file. This is **destructive**: every recorded hours correction is lost,
-- so take a backup or export first if the table holds data.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0053_shift_adjustment_down.sql
BEGIN;

DROP TABLE IF EXISTS "shift_adjustment";

COMMIT;
