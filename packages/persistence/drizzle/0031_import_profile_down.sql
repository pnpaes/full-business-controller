-- Down path for 0031_import_profile.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Reverses the `DEC-081` import-profile slice inside one transaction: drops the
-- nullable `import_run.import_profile_id` FK/column first, then the
-- `import_profile` table (the column must go first because its FK references the
-- table). Both use `IF EXISTS` so a half-applied manual run cannot wedge. This is
-- **destructive**: every stored per-source profile (posting policy and
-- validation rules) is lost and existing runs lose their profile link, so run it
-- only while those profiles need not be preserved (AGENTS.md Rule 2). Apply it
-- manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0031_import_profile_down.sql
BEGIN;

ALTER TABLE "import_run" DROP COLUMN IF EXISTS "import_profile_id";

DROP TABLE IF EXISTS "import_profile";

COMMIT;
