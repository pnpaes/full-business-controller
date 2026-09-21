-- Down path for 0038_hms_monitoring_append_only.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-089` `monitoring_reading` append-only triggers and their
-- function. No table and no row is touched, so it is safe to run whenever the
-- invariant must be removed (for example before a data repair); while dropped,
-- a reading's immutability rests only on the application until the migration is
-- re-applied. Apply 0037's down after this one (that file drops the table the
-- triggers live on). Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0038_hms_monitoring_append_only_down.sql
BEGIN;

DROP TRIGGER IF EXISTS "monitoring_reading_immutable" ON "monitoring_reading";
DROP TRIGGER IF EXISTS "monitoring_reading_no_delete" ON "monitoring_reading";
DROP TRIGGER IF EXISTS "monitoring_reading_no_truncate" ON "monitoring_reading";
DROP FUNCTION IF EXISTS "monitoring_reading_append_only"();

COMMIT;
