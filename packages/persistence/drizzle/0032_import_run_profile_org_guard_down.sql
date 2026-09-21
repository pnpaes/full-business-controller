-- Down path for 0032_import_run_profile_org_guard.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-081` `import_run_profile_org_guard` trigger and its function.
-- No table and no row is touched, so it is safe to run whenever the
-- cross-organization invariant must be removed (for example before a data
-- repair). Once the raw objects are dropped, the organization coherence of
-- `import_run.import_profile_id` is validated only by the application again
-- until the migration is re-applied.
BEGIN;

DROP TRIGGER IF EXISTS "import_run_profile_org_guard" ON "import_run";
DROP FUNCTION IF EXISTS "import_run_profile_org_guard"();

COMMIT;
