-- Hand-written cross-organization coherence guards for the `DEC-091`
-- (`HMS-005`) IK-mat checklist slice, closing its org-coherence gap:
-- `checklist_run.template_id`, `checklist_run.location_id` and
-- `checklist_template.supersedes_id` are organization-scoped references, but
-- their single-column FKs cannot express that the referenced row belongs to the
-- same organization (`checklist_template` and `location` each carry their own
-- `organization_id`). Mirrors `0041_hms_incidents_org_guard.sql` (the
-- `DEC-079`/`DEC-089` precedent): the FKs are authored normally, but the
-- organization match stays a hand-written `BEFORE INSERT OR UPDATE` trigger so
-- `drizzle-kit generate` never sees or fights it.
--
-- All three guards are **forward-only**: they validate new writes, they do not
-- re-validate rows already present, and existence of the referenced row (as
-- opposed to its organization) stays the FK's job — a missing row falls through
-- to the FK error rather than the guard, and a null reference (`supersedes_id`
-- is nullable) is skipped. The application remains the friendly-error layer.
--
-- The down companion `0043_checklists_org_guard_down.sql` drops the triggers
-- and their functions; like the other down files it is not journaled.

BEGIN;
--> statement-breakpoint

-- `checklist_run`: its `template_id` (not null) must name a checklist template
-- in the run's own organization.
CREATE OR REPLACE FUNCTION "checklist_run_template_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  template_org uuid;
BEGIN
  SELECT t."organization_id" INTO template_org
  FROM "checklist_template" t
  WHERE t."id" = NEW."template_id";

  IF FOUND AND template_org IS DISTINCT FROM NEW."organization_id" THEN
    RAISE EXCEPTION
      'checklist_run.template_id % belongs to organization %, but its checklist_run % belongs to organization %',
      NEW."template_id", template_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "checklist_run_template_org_guard"
  BEFORE INSERT OR UPDATE ON "checklist_run"
  FOR EACH ROW
  EXECUTE FUNCTION "checklist_run_template_org_guard"();
--> statement-breakpoint

-- `checklist_run`: its `location_id` (not null) must name a location in the
-- run's own organization.
CREATE OR REPLACE FUNCTION "checklist_run_location_org_guard"()
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
      'checklist_run.location_id % belongs to organization %, but its checklist_run % belongs to organization %',
      NEW."location_id", location_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "checklist_run_location_org_guard"
  BEFORE INSERT OR UPDATE ON "checklist_run"
  FOR EACH ROW
  EXECUTE FUNCTION "checklist_run_location_org_guard"();
--> statement-breakpoint

-- `checklist_template`: a non-null `supersedes_id` must name a template in its
-- own organization. A null reference returns untouched.
CREATE OR REPLACE FUNCTION "checklist_template_supersedes_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  superseded_org uuid;
BEGIN
  IF NEW."supersedes_id" IS NOT NULL THEN
    SELECT t."organization_id" INTO superseded_org
    FROM "checklist_template" t
    WHERE t."id" = NEW."supersedes_id";

    IF FOUND AND superseded_org IS DISTINCT FROM NEW."organization_id" THEN
      RAISE EXCEPTION
        'checklist_template.supersedes_id % belongs to organization %, but its checklist_template % belongs to organization %',
        NEW."supersedes_id", superseded_org, NEW."id", NEW."organization_id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "checklist_template_supersedes_org_guard"
  BEFORE INSERT OR UPDATE ON "checklist_template"
  FOR EACH ROW
  EXECUTE FUNCTION "checklist_template_supersedes_org_guard"();
--> statement-breakpoint

COMMIT;
