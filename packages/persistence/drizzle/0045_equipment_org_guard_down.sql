-- Down path for 0045_equipment_org_guard.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-092` cross-organization coherence guards: the
-- `equipment_location_org_guard`, `maintenance_log_equipment_org_guard` and
-- `maintenance_log_file_object_org_guard` triggers and their functions. No
-- table and no row is touched, so it is safe to run whenever the
-- cross-organization invariant must be removed (for example before a data
-- repair). While dropped, the organization coherence of an equipment row's
-- `location_id` and a maintenance log's `equipment_id`/`file_object_id` is
-- validated only by the application until the migration is re-applied. Apply
-- `0045`'s org-guard down **before** `0044_equipment_down.sql`, because its
-- triggers live on the tables that down drops.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0045_equipment_org_guard_down.sql
BEGIN;

DROP TRIGGER IF EXISTS "maintenance_log_file_object_org_guard" ON "maintenance_log";
DROP TRIGGER IF EXISTS "maintenance_log_equipment_org_guard" ON "maintenance_log";
DROP TRIGGER IF EXISTS "equipment_location_org_guard" ON "equipment";
DROP FUNCTION IF EXISTS "maintenance_log_file_object_org_guard"();
DROP FUNCTION IF EXISTS "maintenance_log_equipment_org_guard"();
DROP FUNCTION IF EXISTS "equipment_location_org_guard"();

COMMIT;
