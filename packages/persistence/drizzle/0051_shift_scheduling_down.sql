-- Down path for 0051_shift_scheduling.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-037`/`DEC-038` (`WF-002`, `WF-003`) shift-scheduling tables:
-- `shift_assignment` first, because it FKs `shift` and `employee`, then `shift`
-- (which FKs `organization` and `location`). The indexes and the single-column
-- FKs go with the tables; the cross-organization guard triggers and functions
-- are dropped by the companion `0052_shift_scheduling_org_guard_down.sql`,
-- which must be applied **before** this file. This is **destructive**: every
-- shift and assignment row is lost, so take a backup or export first if the
-- tables hold data.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0051_shift_scheduling_down.sql
BEGIN;

DROP TABLE IF EXISTS "shift_assignment";
DROP TABLE IF EXISTS "shift";

COMMIT;
