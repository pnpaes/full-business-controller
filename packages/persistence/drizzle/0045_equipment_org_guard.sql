-- Hand-written cross-organization coherence guards for the `DEC-092`
-- (`HMS-006`) equipment/maintenance slice, closing its org-coherence gap:
-- `equipment.location_id`, `maintenance_log.equipment_id` and
-- `maintenance_log.file_object_id` are organization-scoped references, but their
-- single-column FKs cannot express that the referenced row belongs to the same
-- organization (`location`, `equipment` and `file_object` each carry their own
-- `organization_id`). Mirrors `0043_checklists_org_guard.sql` (the
-- `DEC-079`/`DEC-089` precedent): the FKs are authored normally, but the
-- organization match stays a hand-written `BEFORE INSERT OR UPDATE` trigger so
-- `drizzle-kit generate` never sees or fights it.
--
-- All three guards are **forward-only**: they validate new writes, they do not
-- re-validate rows already present, and existence of the referenced row (as
-- opposed to its organization) stays the FK's job — a missing row falls through
-- to the FK error rather than the guard, and a null reference (`file_object_id`
-- is nullable) is skipped. The application remains the friendly-error layer.
--
-- The down companion `0045_equipment_org_guard_down.sql` drops the triggers and
-- their functions; like the other down files it is not journaled.

BEGIN;
--> statement-breakpoint

-- `equipment`: its `location_id` (not null) must name a location in the
-- equipment row's own organization.
CREATE OR REPLACE FUNCTION "equipment_location_org_guard"()
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
      'equipment.location_id % belongs to organization %, but its equipment % belongs to organization %',
      NEW."location_id", location_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "equipment_location_org_guard"
  BEFORE INSERT OR UPDATE ON "equipment"
  FOR EACH ROW
  EXECUTE FUNCTION "equipment_location_org_guard"();
--> statement-breakpoint

-- `maintenance_log`: its `equipment_id` (not null) must name an equipment row
-- in the log's own organization.
CREATE OR REPLACE FUNCTION "maintenance_log_equipment_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  equipment_org uuid;
BEGIN
  SELECT e."organization_id" INTO equipment_org
  FROM "equipment" e
  WHERE e."id" = NEW."equipment_id";

  IF FOUND AND equipment_org IS DISTINCT FROM NEW."organization_id" THEN
    RAISE EXCEPTION
      'maintenance_log.equipment_id % belongs to organization %, but its maintenance_log % belongs to organization %',
      NEW."equipment_id", equipment_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "maintenance_log_equipment_org_guard"
  BEFORE INSERT OR UPDATE ON "maintenance_log"
  FOR EACH ROW
  EXECUTE FUNCTION "maintenance_log_equipment_org_guard"();
--> statement-breakpoint

-- `maintenance_log`: a non-null `file_object_id` must name a file object in the
-- log's own organization. A null reference returns untouched.
CREATE OR REPLACE FUNCTION "maintenance_log_file_object_org_guard"()
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
        'maintenance_log.file_object_id % belongs to organization %, but its maintenance_log % belongs to organization %',
        NEW."file_object_id", file_object_org, NEW."id", NEW."organization_id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "maintenance_log_file_object_org_guard"
  BEFORE INSERT OR UPDATE ON "maintenance_log"
  FOR EACH ROW
  EXECUTE FUNCTION "maintenance_log_file_object_org_guard"();
--> statement-breakpoint

COMMIT;
