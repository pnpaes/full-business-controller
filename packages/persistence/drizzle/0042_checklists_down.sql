-- Down path for 0042_checklists.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-091` (`HMS-005`) IK-mat checklist slice tables: `checklist_run`
-- first, because it FKs `checklist_template` (and `location`), then
-- `checklist_template` (whose self-FK `supersedes_id` does not change the drop
-- order — it is an intra-table reference and goes with the table). The indexes
-- and the single-column FKs go with the tables; the cross-organization guard
-- triggers and functions are dropped by the companion
-- `0043_checklists_org_guard_down.sql`, which must be applied **before** this
-- file. This is **destructive**: every checklist template and run row is lost,
-- so take a backup or export first if the tables hold data.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0042_checklists_down.sql
BEGIN;

DROP TABLE IF EXISTS "checklist_run";
DROP TABLE IF EXISTS "checklist_template";

COMMIT;
