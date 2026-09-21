-- Down path for 0043_checklists_org_guard.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-091` cross-organization coherence guards: the
-- `checklist_run_template_org_guard`, `checklist_run_location_org_guard` and
-- `checklist_template_supersedes_org_guard` triggers and their functions. No
-- table and no row is touched, so it is safe to run whenever the
-- cross-organization invariant must be removed (for example before a data
-- repair). While dropped, the organization coherence of a run's `template_id`/
-- `location_id` and a template's `supersedes_id` is validated only by the
-- application until the migration is re-applied. Apply `0043`'s org-guard down
-- **before** `0042_checklists_down.sql`, because its triggers live on the tables
-- that down drops.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0043_checklists_org_guard_down.sql
BEGIN;

DROP TRIGGER IF EXISTS "checklist_template_supersedes_org_guard" ON "checklist_template";
DROP TRIGGER IF EXISTS "checklist_run_location_org_guard" ON "checklist_run";
DROP TRIGGER IF EXISTS "checklist_run_template_org_guard" ON "checklist_run";
DROP FUNCTION IF EXISTS "checklist_template_supersedes_org_guard"();
DROP FUNCTION IF EXISTS "checklist_run_location_org_guard"();
DROP FUNCTION IF EXISTS "checklist_run_template_org_guard"();

COMMIT;
