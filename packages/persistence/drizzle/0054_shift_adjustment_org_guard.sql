-- Hand-written cross-organization coherence guard for the `DEC-038` (`WF-004`)
-- worked-hours correction, closing its org-coherence gap:
-- `shift_adjustment.shift_assignment_id` is an organization-scoped reference,
-- but its single-column FK cannot express that the referenced
-- `shift_assignment` belongs to the same organization (`shift_assignment`
-- carries its own `organization_id`). Mirrors `0052_shift_scheduling_org_guard.sql`
-- (the `DEC-079` precedent): the FK is authored normally, but the organization
-- match stays a hand-written `BEFORE INSERT OR UPDATE` trigger so
-- `drizzle-kit generate` never sees or fights it.
--
-- The guard is **forward-only**: it validates new writes, it does not re-validate
-- rows already present, and existence of the referenced row (as opposed to its
-- organization) stays the FK's job — a missing row falls through to the FK error
-- rather than the guard. `shift_assignment_id` is NOT NULL, so the guard is
-- unconditional. The application remains the friendly-error layer.
--
-- The down companion `0054_shift_adjustment_org_guard_down.sql` drops the trigger
-- and its function; like the other down files it is not journaled.

BEGIN;
--> statement-breakpoint

-- `shift_adjustment`: its `shift_assignment_id` (not null) must name a
-- shift-assignment row in the adjustment's own organization.
CREATE OR REPLACE FUNCTION "shift_adjustment_shift_assignment_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  assignment_org uuid;
BEGIN
  SELECT sa."organization_id" INTO assignment_org
  FROM "shift_assignment" sa
  WHERE sa."id" = NEW."shift_assignment_id";

  IF FOUND AND assignment_org IS DISTINCT FROM NEW."organization_id" THEN
    RAISE EXCEPTION
      'shift_adjustment.shift_assignment_id % belongs to organization %, but its shift_adjustment % belongs to organization %',
      NEW."shift_assignment_id", assignment_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "shift_adjustment_shift_assignment_org_guard"
  BEFORE INSERT OR UPDATE ON "shift_adjustment"
  FOR EACH ROW
  EXECUTE FUNCTION "shift_adjustment_shift_assignment_org_guard"();
--> statement-breakpoint

COMMIT;
