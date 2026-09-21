-- Down path for 0040_hms_incidents.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-090`/`DEC-095` HMS incident slice tables: `corrective_action`
-- first, because it FKs `hms_incident` (and `monitoring_reading`), then
-- `hms_incident`. The indexes and the single-column FKs go with the tables; the
-- cross-organization guard triggers and functions are dropped by the companion
-- `0040_hms_incidents_org_guard_down.sql`, which must be applied **before** this
-- file. This is **destructive**: every incident and corrective-action row is
-- lost, so take a backup or export first if the tables hold data.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0040_hms_incidents_down.sql
BEGIN;

DROP TABLE IF EXISTS "corrective_action";
DROP TABLE IF EXISTS "hms_incident";

COMMIT;
