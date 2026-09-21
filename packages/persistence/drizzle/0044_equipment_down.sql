-- Down path for 0044_equipment.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-092` (`HMS-006`) equipment/maintenance slice tables:
-- `maintenance_log` first, because it FKs `equipment` (and `file_object`), then
-- `equipment`. The indexes and the single-column FKs go with the tables; the
-- cross-organization guard triggers and functions are dropped by the companion
-- `0045_equipment_org_guard_down.sql`, which must be applied **before** this
-- file. This is **destructive**: every equipment register row and maintenance
-- log row is lost, so take a backup or export first if the tables hold data.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0044_equipment_down.sql
BEGIN;

DROP TABLE IF EXISTS "maintenance_log";
DROP TABLE IF EXISTS "equipment";

COMMIT;
