-- Down path for 0039_hms_monitoring_org_guard.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-089` cross-organization coherence guards: the
-- `monitoring_point_org_guard` and `monitoring_reading_org_guard` triggers and
-- their functions. No table and no row is touched, so it is safe to run whenever
-- the cross-organization invariant must be removed (for example before a data
-- repair). While dropped, the organization coherence of a point's
-- `location_id`/`storage_area_id` and of a reading's `monitoring_point_id` is
-- validated only by the application until the migration is re-applied. Apply
-- `0039`'s down **before** `0037`'s down, because its triggers live on the
-- tables `0037`'s down drops.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0039_hms_monitoring_org_guard_down.sql
BEGIN;

DROP TRIGGER IF EXISTS "monitoring_point_org_guard" ON "monitoring_point";
DROP TRIGGER IF EXISTS "monitoring_reading_org_guard" ON "monitoring_reading";
DROP FUNCTION IF EXISTS "monitoring_point_org_guard"();
DROP FUNCTION IF EXISTS "monitoring_reading_org_guard"();

COMMIT;
