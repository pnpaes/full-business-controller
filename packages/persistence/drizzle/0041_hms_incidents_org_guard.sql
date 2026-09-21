-- Hand-written cross-organization coherence guards for the `DEC-090` /
-- `DEC-095` HMS incident slice, closing its org-coherence gap:
-- `hms_incident.location_id`, `corrective_action.incident_id` and
-- `corrective_action.monitoring_reading_id` are organization-scoped references,
-- but their single-column FKs cannot express that the referenced row belongs to
-- the same organization (`location`, `hms_incident` and `monitoring_reading`
-- each carry their own `organization_id`). Mirrors
-- `0039_hms_monitoring_org_guard.sql` (the `DEC-079`/`DEC-089` precedent): the
-- FKs are authored normally, but the organization match stays a hand-written
-- `BEFORE INSERT OR UPDATE` trigger so `drizzle-kit generate` never sees or
-- fights it.
--
-- Both guards are **forward-only**: they validate new writes, they do not
-- re-validate rows already present, and existence of the referenced row (as
-- opposed to its organization) stays the FK's job — a missing row falls through
-- to the FK error rather than the guard, and a null reference (the
-- `corrective_action` links are nullable) is skipped. The application remains
-- the friendly-error layer.
--
-- The down companion `0040_hms_incidents_org_guard_down.sql` drops the triggers
-- and their functions; like the other down files it is not journaled.

BEGIN;
--> statement-breakpoint

-- `hms_incident`: its `location_id` (not null) must name a location in the
-- incident's own organization.
CREATE OR REPLACE FUNCTION "hms_incident_org_guard"()
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
      'hms_incident.location_id % belongs to organization %, but its hms_incident % belongs to organization %',
      NEW."location_id", location_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "hms_incident_org_guard"
  BEFORE INSERT OR UPDATE ON "hms_incident"
  FOR EACH ROW
  EXECUTE FUNCTION "hms_incident_org_guard"();
--> statement-breakpoint

-- `corrective_action`: each non-null link must name a row in the action's own
-- organization. Both links are nullable, so a null reference returns untouched
-- (a missing row falls through to the FK error).
CREATE OR REPLACE FUNCTION "corrective_action_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  incident_org uuid;
  reading_org uuid;
BEGIN
  IF NEW."incident_id" IS NOT NULL THEN
    SELECT i."organization_id" INTO incident_org
    FROM "hms_incident" i
    WHERE i."id" = NEW."incident_id";

    IF FOUND AND incident_org IS DISTINCT FROM NEW."organization_id" THEN
      RAISE EXCEPTION
        'corrective_action.incident_id % belongs to organization %, but its corrective_action % belongs to organization %',
        NEW."incident_id", incident_org, NEW."id", NEW."organization_id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."monitoring_reading_id" IS NOT NULL THEN
    SELECT r."organization_id" INTO reading_org
    FROM "monitoring_reading" r
    WHERE r."id" = NEW."monitoring_reading_id";

    IF FOUND AND reading_org IS DISTINCT FROM NEW."organization_id" THEN
      RAISE EXCEPTION
        'corrective_action.monitoring_reading_id % belongs to organization %, but its corrective_action % belongs to organization %',
        NEW."monitoring_reading_id", reading_org, NEW."id", NEW."organization_id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "corrective_action_org_guard"
  BEFORE INSERT OR UPDATE ON "corrective_action"
  FOR EACH ROW
  EXECUTE FUNCTION "corrective_action_org_guard"();
--> statement-breakpoint

COMMIT;
