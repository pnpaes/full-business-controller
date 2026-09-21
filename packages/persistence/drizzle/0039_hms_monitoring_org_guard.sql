-- Hand-written cross-organization coherence guards for the `DEC-089` HMS
-- monitoring slice, closing its org-coherence gap: `monitoring_point.location_id`
-- / `monitoring_point.storage_area_id` and
-- `monitoring_reading.monitoring_point_id` are organization-scoped references,
-- but their single-column FKs cannot express that the referenced row belongs to
-- the same organization (`location`, `storage_area` and `monitoring_point` each
-- carry their own `organization_id`). Mirrors `0036_file_object_org_guard.sql` /
-- `0032_import_run_profile_org_guard.sql` (the `DEC-079`/`DEC-081` precedent):
-- the FKs are authored normally, but the organization match stays a hand-written
-- `BEFORE INSERT OR UPDATE` trigger so `drizzle-kit generate` never sees or
-- fights it.
--
-- Both guards are **forward-only**: they validate new writes, they do not
-- re-validate rows already present, and existence of the referenced row (as
-- opposed to its organization) stays the FK's job — a missing row falls through
-- to the FK error rather than the guard. The application remains the
-- friendly-error layer.
--
-- The down companion `0039_hms_monitoring_org_guard_down.sql` drops the triggers
-- and their functions; like the other down files it is not journaled.

BEGIN;
--> statement-breakpoint

-- `monitoring_point`: a `location_id` (not null) or a non-null `storage_area_id`
-- must name a row in the point's own organization. Raise with the offending
-- column named; a null reference returns/continues untouched (a missing row
-- falls through to the FK error).
CREATE OR REPLACE FUNCTION "monitoring_point_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  location_org uuid;
  storage_area_org uuid;
BEGIN
  IF NEW."location_id" IS NOT NULL THEN
    SELECT l."organization_id" INTO location_org
    FROM "location" l
    WHERE l."id" = NEW."location_id";

    IF FOUND AND location_org IS DISTINCT FROM NEW."organization_id" THEN
      RAISE EXCEPTION
        'monitoring_point.location_id % belongs to organization %, but its monitoring_point % belongs to organization %',
        NEW."location_id", location_org, NEW."id", NEW."organization_id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."storage_area_id" IS NOT NULL THEN
    SELECT s."organization_id" INTO storage_area_org
    FROM "storage_area" s
    WHERE s."id" = NEW."storage_area_id";

    IF FOUND AND storage_area_org IS DISTINCT FROM NEW."organization_id" THEN
      RAISE EXCEPTION
        'monitoring_point.storage_area_id % belongs to organization %, but its monitoring_point % belongs to organization %',
        NEW."storage_area_id", storage_area_org, NEW."id", NEW."organization_id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "monitoring_point_org_guard"
  BEFORE INSERT OR UPDATE ON "monitoring_point"
  FOR EACH ROW
  EXECUTE FUNCTION "monitoring_point_org_guard"();
--> statement-breakpoint

-- `monitoring_reading`: the referenced monitoring point must belong to the
-- reading's own organization. The `0038` append-only trigger already makes
-- `monitoring_point_id`/`organization_id` immutable, so in practice this guard
-- validates the INSERT; it is a `BEFORE INSERT OR UPDATE` trigger for symmetry
-- with the other coherence guards.
CREATE OR REPLACE FUNCTION "monitoring_reading_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  point_org uuid;
BEGIN
  SELECT p."organization_id" INTO point_org
  FROM "monitoring_point" p
  WHERE p."id" = NEW."monitoring_point_id";

  IF FOUND AND point_org IS DISTINCT FROM NEW."organization_id" THEN
    RAISE EXCEPTION
      'monitoring_reading.monitoring_point_id % belongs to organization %, but its monitoring_reading % belongs to organization %',
      NEW."monitoring_point_id", point_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "monitoring_reading_org_guard"
  BEFORE INSERT OR UPDATE ON "monitoring_reading"
  FOR EACH ROW
  EXECUTE FUNCTION "monitoring_reading_org_guard"();
--> statement-breakpoint

COMMIT;
