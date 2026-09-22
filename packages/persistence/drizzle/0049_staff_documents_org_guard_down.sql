-- Down path for 0049_staff_documents_org_guard.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-088` cross-organization coherence guards: the
-- `document_version_document_org_guard`,
-- `document_version_file_object_org_guard` and
-- `document_acknowledgement_document_version_org_guard` triggers and their
-- functions. No table and no row is touched, so it is safe to run whenever the
-- cross-organization invariant must be removed (for example before a data
-- repair). While dropped, the organization coherence of a version's
-- `document_id`/`file_object_id` and an acknowledgement's
-- `document_version_id` is validated only by the application until the
-- migration is re-applied. Apply `0049`'s org-guard down **before**
-- `0048_staff_documents_down.sql`, because its triggers live on the tables that
-- down drops.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0049_staff_documents_org_guard_down.sql
BEGIN;

DROP TRIGGER IF EXISTS "document_acknowledgement_document_version_org_guard" ON "document_acknowledgement";
DROP TRIGGER IF EXISTS "document_version_file_object_org_guard" ON "document_version";
DROP TRIGGER IF EXISTS "document_version_document_org_guard" ON "document_version";
DROP FUNCTION IF EXISTS "document_acknowledgement_document_version_org_guard"();
DROP FUNCTION IF EXISTS "document_version_file_object_org_guard"();
DROP FUNCTION IF EXISTS "document_version_document_org_guard"();

COMMIT;
