-- Hand-written cross-organization coherence guards for the `DEC-087`
-- (`WF-007`) workforce personnel slice, closing its org-coherence gap:
-- `employee.primary_location_id`, `employee.user_id`,
-- `employee_document.employee_id` and `employee_document.file_object_id` are
-- organization-scoped references, but their single-column FKs cannot express
-- that the referenced row belongs to the same organization (`location`,
-- `app_user`, `employee` and `file_object` each carry their own
-- `organization_id` — `app_user.organization_id` is NOT NULL, `identity.ts`).
-- Mirrors `0045_equipment_org_guard.sql` (the `DEC-079`/`DEC-089` precedent):
-- the FKs are authored normally, but the organization match stays a
-- hand-written `BEFORE INSERT OR UPDATE` trigger so `drizzle-kit generate`
-- never sees or fights it.
--
-- All four guards are **forward-only**: they validate new writes, they do not
-- re-validate rows already present, and existence of the referenced row (as
-- opposed to its organization) stays the FK's job — a missing row falls through
-- to the FK error rather than the guard, and a null reference
-- (`primary_location_id`, `user_id`, `file_object_id`) is skipped. The
-- application remains the friendly-error layer.
--
-- The down companion `0047_workforce_org_guard_down.sql` drops the triggers and
-- their functions; like the other down files it is not journaled.

BEGIN;
--> statement-breakpoint

-- `employee`: a non-null `primary_location_id` must name a location in the
-- employee row's own organization. A null reference returns untouched.
CREATE OR REPLACE FUNCTION "employee_primary_location_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  location_org uuid;
BEGIN
  IF NEW."primary_location_id" IS NOT NULL THEN
    SELECT l."organization_id" INTO location_org
    FROM "location" l
    WHERE l."id" = NEW."primary_location_id";

    IF FOUND AND location_org IS DISTINCT FROM NEW."organization_id" THEN
      RAISE EXCEPTION
        'employee.primary_location_id % belongs to organization %, but its employee % belongs to organization %',
        NEW."primary_location_id", location_org, NEW."id", NEW."organization_id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "employee_primary_location_org_guard"
  BEFORE INSERT OR UPDATE ON "employee"
  FOR EACH ROW
  EXECUTE FUNCTION "employee_primary_location_org_guard"();
--> statement-breakpoint

-- `employee`: a non-null `user_id` must name an `app_user` in the employee
-- row's own organization. A null reference returns untouched.
CREATE OR REPLACE FUNCTION "employee_user_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  user_org uuid;
BEGIN
  IF NEW."user_id" IS NOT NULL THEN
    SELECT u."organization_id" INTO user_org
    FROM "app_user" u
    WHERE u."id" = NEW."user_id";

    IF FOUND AND user_org IS DISTINCT FROM NEW."organization_id" THEN
      RAISE EXCEPTION
        'employee.user_id % belongs to organization %, but its employee % belongs to organization %',
        NEW."user_id", user_org, NEW."id", NEW."organization_id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "employee_user_org_guard"
  BEFORE INSERT OR UPDATE ON "employee"
  FOR EACH ROW
  EXECUTE FUNCTION "employee_user_org_guard"();
--> statement-breakpoint

-- `employee_document`: its `employee_id` (not null) must name an employee row
-- in the document's own organization.
CREATE OR REPLACE FUNCTION "employee_document_employee_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  employee_org uuid;
BEGIN
  SELECT e."organization_id" INTO employee_org
  FROM "employee" e
  WHERE e."id" = NEW."employee_id";

  IF FOUND AND employee_org IS DISTINCT FROM NEW."organization_id" THEN
    RAISE EXCEPTION
      'employee_document.employee_id % belongs to organization %, but its employee_document % belongs to organization %',
      NEW."employee_id", employee_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "employee_document_employee_org_guard"
  BEFORE INSERT OR UPDATE ON "employee_document"
  FOR EACH ROW
  EXECUTE FUNCTION "employee_document_employee_org_guard"();
--> statement-breakpoint

-- `employee_document`: a non-null `file_object_id` must name a file object in
-- the document's own organization. A null reference returns untouched.
CREATE OR REPLACE FUNCTION "employee_document_file_object_org_guard"()
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
        'employee_document.file_object_id % belongs to organization %, but its employee_document % belongs to organization %',
        NEW."file_object_id", file_object_org, NEW."id", NEW."organization_id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "employee_document_file_object_org_guard"
  BEFORE INSERT OR UPDATE ON "employee_document"
  FOR EACH ROW
  EXECUTE FUNCTION "employee_document_file_object_org_guard"();
--> statement-breakpoint

COMMIT;
