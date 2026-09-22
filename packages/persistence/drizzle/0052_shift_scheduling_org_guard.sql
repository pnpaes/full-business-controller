-- Hand-written cross-organization coherence guards for the `DEC-037`/`DEC-038`
-- (`WF-002`, `WF-003`) shift-scheduling slice, closing its org-coherence gap:
-- `shift.location_id`, `shift_assignment.shift_id` and
-- `shift_assignment.employee_id` are organization-scoped references, but their
-- single-column FKs cannot express that the referenced row belongs to the same
-- organization (`location`, `shift` and `employee` each carry their own
-- `organization_id`). Mirrors `0049_staff_documents_org_guard.sql` (the
-- `DEC-079`/`DEC-089` precedent): the FKs are authored normally, but the
-- organization match stays a hand-written `BEFORE INSERT OR UPDATE` trigger so
-- `drizzle-kit generate` never sees or fights it.
--
-- All three guards are **forward-only**: they validate new writes, they do not
-- re-validate rows already present, and existence of the referenced row (as
-- opposed to its organization) stays the FK's job — a missing row falls through
-- to the FK error rather than the guard. All three columns are NOT NULL, so the
-- guards are unconditional (no null-reference skip, unlike `0049`). The
-- application remains the friendly-error layer.
--
-- The down companion `0052_shift_scheduling_org_guard_down.sql` drops the
-- triggers and their functions; like the other down files it is not journaled.

BEGIN;
--> statement-breakpoint

-- `shift`: its `location_id` (not null) must name a location row in the
-- shift's own organization.
CREATE OR REPLACE FUNCTION "shift_location_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  location_org uuid;
BEGIN
  SELECT l."organization_id" INTO location_org
  FROM "location" l
  WHERE l."id" = NEW."location_id";

  IF FOUND AND location_org IS DISTINCT FROM NEW."organization_id" THEN
    RAISE EXCEPTION
      'shift.location_id % belongs to organization %, but its shift % belongs to organization %',
      NEW."location_id", location_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "shift_location_org_guard"
  BEFORE INSERT OR UPDATE ON "shift"
  FOR EACH ROW
  EXECUTE FUNCTION "shift_location_org_guard"();
--> statement-breakpoint

-- `shift_assignment`: its `shift_id` (not null) must name a shift row in the
-- assignment's own organization.
CREATE OR REPLACE FUNCTION "shift_assignment_shift_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  shift_org uuid;
BEGIN
  SELECT s."organization_id" INTO shift_org
  FROM "shift" s
  WHERE s."id" = NEW."shift_id";

  IF FOUND AND shift_org IS DISTINCT FROM NEW."organization_id" THEN
    RAISE EXCEPTION
      'shift_assignment.shift_id % belongs to organization %, but its shift_assignment % belongs to organization %',
      NEW."shift_id", shift_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "shift_assignment_shift_org_guard"
  BEFORE INSERT OR UPDATE ON "shift_assignment"
  FOR EACH ROW
  EXECUTE FUNCTION "shift_assignment_shift_org_guard"();
--> statement-breakpoint

-- `shift_assignment`: its `employee_id` (not null) must name an employee row in
-- the assignment's own organization.
CREATE OR REPLACE FUNCTION "shift_assignment_employee_org_guard"()
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
      'shift_assignment.employee_id % belongs to organization %, but its shift_assignment % belongs to organization %',
      NEW."employee_id", employee_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "shift_assignment_employee_org_guard"
  BEFORE INSERT OR UPDATE ON "shift_assignment"
  FOR EACH ROW
  EXECUTE FUNCTION "shift_assignment_employee_org_guard"();
--> statement-breakpoint

COMMIT;
