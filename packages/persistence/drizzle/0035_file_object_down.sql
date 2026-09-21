-- Down path for 0035_file_object.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Reverses the `ADR-0006`/`DEC-085` file-object slice inside one transaction:
-- drops the `import_run.file_object_id` FK first, then the `file_object` table
-- (the FK must go first because it references the table). Both use `IF EXISTS`
-- so a half-applied manual run cannot wedge. This is **destructive**: every
-- stored file's metadata (storage key, checksum, links) is lost, and existing
-- runs lose their file link (the `import_run.file_object_id` column itself stays
-- a plain uuid, as it was before 0035), so run it only while those files need
-- not be preserved (AGENTS.md Rule 2). Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0035_file_object_down.sql
BEGIN;

ALTER TABLE "import_run" DROP CONSTRAINT IF EXISTS "import_run_file_object_id_file_object_id_fk";

DROP TABLE IF EXISTS "file_object";

COMMIT;
