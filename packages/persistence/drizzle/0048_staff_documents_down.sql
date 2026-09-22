-- Down path for 0048_staff_documents.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-088` (`DOC-001`…`DOC-004`) staff document library tables:
-- `document_acknowledgement` first, because it FKs `document_version`, then
-- `document_version` (which FKs `document` and `file_object`), then `document`.
-- The indexes and the single-column FKs go with the tables; the
-- cross-organization guard triggers and functions are dropped by the companion
-- `0049_staff_documents_org_guard_down.sql`, which must be applied **before**
-- this file. This is **destructive**: every document, version and
-- acknowledgement row is lost, so take a backup or export first if the tables
-- hold data.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0048_staff_documents_down.sql
BEGIN;

DROP TABLE IF EXISTS "document_acknowledgement";
DROP TABLE IF EXISTS "document_version";
DROP TABLE IF EXISTS "document";

COMMIT;
