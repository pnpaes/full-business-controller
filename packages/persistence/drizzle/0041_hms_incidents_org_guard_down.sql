-- Down path for 0041_hms_incidents_org_guard.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-090`/`DEC-095` cross-organization coherence guards: the
-- `hms_incident_org_guard` and `corrective_action_org_guard` triggers and their
-- functions. No table and no row is touched, so it is safe to run whenever the
-- cross-organization invariant must be removed (for example before a data
-- repair). While dropped, the organization coherence of an incident's
-- `location_id` and of a corrective action's `incident_id`/
-- `monitoring_reading_id` is validated only by the application until the
-- migration is re-applied. Apply `0041`'s org-guard down **before**
-- `0040_hms_incidents_down.sql`, because its triggers live on the tables that
-- down drops.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0041_hms_incidents_org_guard_down.sql
BEGIN;

DROP TRIGGER IF EXISTS "corrective_action_org_guard" ON "corrective_action";
DROP TRIGGER IF EXISTS "hms_incident_org_guard" ON "hms_incident";
DROP FUNCTION IF EXISTS "corrective_action_org_guard"();
DROP FUNCTION IF EXISTS "hms_incident_org_guard"();

COMMIT;
