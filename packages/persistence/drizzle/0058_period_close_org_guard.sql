-- Hand-written guards for the `REC-003`/`REC-006`/`DEC-027` (row 13a) close/lock
-- table `period_close`, closing three gaps `drizzle-kit generate` cannot express.
--
-- (1) **Scope coherence.** `period_close.scope_id` is a plain uuid because its
-- target varies by `scope_type` (a `location` id or the organization's own id),
-- so the single-column FK cannot express that a `location` scope must name a
-- `location` row in the same organization. Because there is no FK on `scope_id`,
-- the guard checks **both** existence and organization (unlike the `0045`/`0056`
-- guards, whose columns carry an FK that still catches a missing row). Mirrors
-- `0045`/`0056` otherwise (the `DEC-079`/`DEC-085` precedent): a hand-written
-- `BEFORE INSERT OR UPDATE` trigger so `drizzle-kit generate` never sees or
-- fights it. It is **forward-only** (it validates new writes, not rows already
-- present), skips a `company` scope (whose `scope_id` is the organization id
-- itself) and, on an UPDATE that leaves `scope_type`/`scope_id`/`organization_id`
-- unchanged, skips the lookup entirely.
--
-- (2) **Locked-snapshot immutability (`REC-006`).** Once a row is `locked`, its
-- `snapshot`, period, scope, tenancy (`organization_id`) and lock actor
-- (`locked_by`/`locked_at`) are immutable and its status may only stay `locked`
-- or move to `reopened`; any other change is rejected (`23514`). The application
-- is the friendly-error layer, this trigger is the database backstop. The
-- status **transitions** themselves (`closing` → `locked` → `reopened`) are
-- application-enforced; the trigger backstops locked-row immutability only, and a
-- `reopened` row is intentionally editable so re-closing replaces the snapshot
-- (`DEC-105` item 3).
--
-- (3) **Locked rows cannot be deleted.** A `BEFORE DELETE` trigger rejects
-- deleting a `locked` row (`23514`); the repository exposes no delete command
-- either.
--
-- The down companion `0058_period_close_org_guard_down.sql` drops all three
-- triggers and their functions; like the other down files it is not journaled.

BEGIN;
--> statement-breakpoint

-- (1) A `location` scope must name a location in the row's own organization.
CREATE OR REPLACE FUNCTION "period_close_scope_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  location_org uuid;
BEGIN
  IF NEW."scope_type" = 'location' THEN
    IF TG_OP = 'INSERT'
      OR NEW."scope_id" IS DISTINCT FROM OLD."scope_id"
      OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
      OR NEW."scope_type" IS DISTINCT FROM OLD."scope_type"
    THEN
      SELECT l."organization_id" INTO location_org
      FROM "location" l
      WHERE l."id" = NEW."scope_id";

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'period_close.scope_id % is not a location (its period_close % belongs to organization %)',
          NEW."scope_id", NEW."id", NEW."organization_id"
          USING ERRCODE = '23514';
      END IF;

      IF location_org IS DISTINCT FROM NEW."organization_id" THEN
        RAISE EXCEPTION
          'period_close.scope_id % belongs to organization %, but its period_close % belongs to organization %',
          NEW."scope_id", location_org, NEW."id", NEW."organization_id"
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "period_close_scope_org_guard"
  BEFORE INSERT OR UPDATE ON "period_close"
  FOR EACH ROW
  EXECUTE FUNCTION "period_close_scope_org_guard"();
--> statement-breakpoint

-- (2) A locked row's snapshot, period and scope are immutable, and its status
-- may only stay `locked` or move to `reopened`.
CREATE OR REPLACE FUNCTION "period_close_locked_immutability"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'locked' THEN
    IF NEW."snapshot" IS DISTINCT FROM OLD."snapshot"
      OR NEW."period_start" IS DISTINCT FROM OLD."period_start"
      OR NEW."period_end" IS DISTINCT FROM OLD."period_end"
      OR NEW."scope_type" IS DISTINCT FROM OLD."scope_type"
      OR NEW."scope_id" IS DISTINCT FROM OLD."scope_id"
      OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
      OR NEW."locked_by" IS DISTINCT FROM OLD."locked_by"
      OR NEW."locked_at" IS DISTINCT FROM OLD."locked_at"
    THEN
      RAISE EXCEPTION
        'period_close % is locked; its snapshot, period, scope, tenancy and lock actor are immutable',
        OLD."id"
        USING ERRCODE = '23514';
    END IF;

    IF NEW."status" NOT IN ('locked', 'reopened') THEN
      RAISE EXCEPTION
        'period_close % is locked; status may only stay locked or move to reopened, not %',
        OLD."id", NEW."status"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "period_close_locked_immutability"
  BEFORE UPDATE ON "period_close"
  FOR EACH ROW
  EXECUTE FUNCTION "period_close_locked_immutability"();
--> statement-breakpoint

-- (3) A locked row cannot be deleted.
CREATE OR REPLACE FUNCTION "period_close_locked_delete_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'locked' THEN
    RAISE EXCEPTION
      'period_close % is locked and cannot be deleted',
      OLD."id"
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "period_close_locked_delete_guard"
  BEFORE DELETE ON "period_close"
  FOR EACH ROW
  EXECUTE FUNCTION "period_close_locked_delete_guard"();
--> statement-breakpoint

COMMIT;
