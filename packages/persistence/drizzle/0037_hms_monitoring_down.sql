-- Down path for 0037_hms_monitoring.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Reverses the `DEC-089` (`HMS-002`) monitoring slice inside one transaction:
-- drops the `monitoring_reading_org_point_measured_idx` index first, then
-- `monitoring_reading`, then `monitoring_point` (FK-safe order: the reading FK
-- references the point, so the child goes first). All use `IF EXISTS` so a
-- half-applied manual run cannot wedge. This is **destructive**: every
-- monitoring point and every recorded reading is lost, so run it only while
-- those rows need not be preserved (AGENTS.md Rule 2). Apply 0038's down first
-- (it drops the append-only triggers on `monitoring_reading`, which this file
-- drops). Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0037_hms_monitoring_down.sql
BEGIN;

DROP INDEX IF EXISTS "monitoring_reading_org_point_measured_idx";
DROP TABLE IF EXISTS "monitoring_reading";
DROP TABLE IF EXISTS "monitoring_point";

COMMIT;
