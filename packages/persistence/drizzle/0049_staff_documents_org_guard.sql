-- Hand-written cross-organization coherence guards for the `DEC-088`
-- (`DOC-001`…`DOC-004`) staff document library, closing its org-coherence gap:
-- `document_version.document_id`, `document_version.file_object_id` and
-- `document_acknowledgement.document_version_id` are organization-scoped
-- references, but their single-column FKs cannot express that the referenced
-- row belongs to the same organization (`document`, `document_version` and
-- `file_object` each carry their own `organization_id`). Mirrors
-- `0047_workforce_org_guard.sql` (the `DEC-079`/`DEC-089` precedent): the FKs
-- are authored normally, but the organization match stays a hand-written
-- `BEFORE INSERT OR UPDATE` trigger so `drizzle-kit generate` never sees or
-- fights it.
--
-- All three guards are **forward-only**: they validate new writes, they do not
-- re-validate rows already present, and existence of the referenced row (as
-- opposed to its organization) stays the FK's job — a missing row falls through
-- to the FK error rather than the guard, and a null reference
-- (`document_version.file_object_id`) is skipped. The application remains the
-- friendly-error layer.
--
-- The down companion `0049_staff_documents_org_guard_down.sql` drops the
-- triggers and their functions; like the other down files it is not journaled.

BEGIN;
--> statement-breakpoint

-- `document_version`: its `document_id` (not null) must name a document row in
-- the version's own organization.
CREATE OR REPLACE FUNCTION "document_version_document_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  document_org uuid;
BEGIN
  SELECT d."organization_id" INTO document_org
  FROM "document" d
  WHERE d."id" = NEW."document_id";

  IF FOUND AND document_org IS DISTINCT FROM NEW."organization_id" THEN
    RAISE EXCEPTION
      'document_version.document_id % belongs to organization %, but its document_version % belongs to organization %',
      NEW."document_id", document_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "document_version_document_org_guard"
  BEFORE INSERT OR UPDATE ON "document_version"
  FOR EACH ROW
  EXECUTE FUNCTION "document_version_document_org_guard"();
--> statement-breakpoint

-- `document_version`: a non-null `file_object_id` must name a file object in
-- the version's own organization. A null reference returns untouched.
CREATE OR REPLACE FUNCTION "document_version_file_object_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  file_object_org uuid;
BEGIN
  IF NEW."file_object_id" IS NOT NULL THEN
    SELECT f."organization_id" INTO file_object_org
    FROM "file_object" f
    WHERE f."id" = NEW."file_object_id";

    IF FOUND AND file_object_org IS DISTINCT FROM NEW."organization_id" THEN
      RAISE EXCEPTION
        'document_version.file_object_id % belongs to organization %, but its document_version % belongs to organization %',
        NEW."file_object_id", file_object_org, NEW."id", NEW."organization_id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "document_version_file_object_org_guard"
  BEFORE INSERT OR UPDATE ON "document_version"
  FOR EACH ROW
  EXECUTE FUNCTION "document_version_file_object_org_guard"();
--> statement-breakpoint

-- `document_acknowledgement`: its `document_version_id` (not null) must name a
-- version row in the acknowledgement's own organization.
CREATE OR REPLACE FUNCTION "document_acknowledgement_document_version_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  document_version_org uuid;
BEGIN
  SELECT v."organization_id" INTO document_version_org
  FROM "document_version" v
  WHERE v."id" = NEW."document_version_id";

  IF FOUND AND document_version_org IS DISTINCT FROM NEW."organization_id" THEN
    RAISE EXCEPTION
      'document_acknowledgement.document_version_id % belongs to organization %, but its document_acknowledgement % belongs to organization %',
      NEW."document_version_id", document_version_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "document_acknowledgement_document_version_org_guard"
  BEFORE INSERT OR UPDATE ON "document_acknowledgement"
  FOR EACH ROW
  EXECUTE FUNCTION "document_acknowledgement_document_version_org_guard"();
--> statement-breakpoint

COMMIT;
