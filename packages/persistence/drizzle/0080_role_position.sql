-- `DEC-151` (owner, 2026-09-28): the **employee role as a fixed scoped entity**
-- and the **position catalogue matched to shifts**.
--
-- 1. `role` is the existing fixed, org-scoped access vocabulary
--    (`role(organization_id, code)`, `code` checked against `ROLE_CODE`) — the
--    same rows `user_role` grants access with. `employee.role_code` becomes a
--    **validated reference** to it (composite `(organization_id, role_code)`),
--    so an employee's role *is* their access level. The column name and its
--    value family are unchanged: the costing labour-rate paths and the
--    payroll/worked-hours reads that key on the role code keep working.
-- 2. `position` is a new **open** org-scoped catalogue (`barista`, `cook`,
--    `helper`, `cleaner`, …) with `employee_position` (the many per employee)
--    and `shift.position_id` (the staffing match). Existing shifts are
--    backfilled from `shift.role_code` so no shift loses its match;
--    `shift.role_code` stays in place (contract later — expand-only here).
--
-- Apply order matters on a live database: expand (tables/column) → backfill →
-- constrain. The employee FK is added `NOT VALID` (the `0021`/`0029`/`0035`
-- `DEC-079` precedent) and only `VALIDATE`d when no unmapped row remains, so
-- this migration applies over the owner's current free-text employees without
-- guessing a mapping.
--
-- The hand-written org-coherence triggers mirror `0047`/`0052`: single-column
-- FKs cannot express that `employee_position.employee_id`/`position_id` and
-- `shift.position_id` point at a row in the same organization.
CREATE TABLE "position" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "active_from" date NOT NULL,
  "active_to" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  "updated_at" timestamp with time zone,
  "updated_by" uuid,
  "version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "position_organization_id_code_key" UNIQUE("organization_id","code"),
  CONSTRAINT "position_active_range_check" CHECK ("position"."active_to" is null or "position"."active_to" > "position"."active_from")
);--> statement-breakpoint
CREATE TABLE "employee_position" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "position_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  "updated_at" timestamp with time zone,
  "updated_by" uuid,
  "version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "employee_position_employee_id_position_id_key" UNIQUE("employee_id","position_id")
);--> statement-breakpoint
ALTER TABLE "shift" ADD COLUMN "position_id" uuid;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Backfill positions from the existing shift employment role
-- ---------------------------------------------------------------------------
-- Each distinct `shift.role_code` becomes one position in the shift's own
-- organization (`code` = lower/trimmed role with whitespace collapsed to `_`).
-- The employee alias map (`kitchen staff`→`kitchen`, `coffee shop
-- staff`/`barista`→`front_of_house`, `manager`→`general_manager`) is a
-- **role** map to `ROLE_CODE` values; a position is the open employment
-- catalogue the owner names (`barista`, `cook`, …), so `barista` stays its own
-- position rather than collapsing into the `front_of_house` role. Only
-- `shift.role_code`'s own value is normalised, so no shift loses its match.
INSERT INTO "position" ("organization_id", "code", "name", "active_from")
SELECT s."organization_id",
       regexp_replace(lower(btrim(s."role_code")), '\s+', '_', 'g'),
       min(btrim(s."role_code")),
       current_date
FROM "shift" s
WHERE s."role_code" IS NOT NULL
  AND btrim(s."role_code") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "position" p
    WHERE p."organization_id" = s."organization_id"
      AND p."code" = regexp_replace(lower(btrim(s."role_code")), '\s+', '_', 'g')
  )
GROUP BY s."organization_id",
         regexp_replace(lower(btrim(s."role_code")), '\s+', '_', 'g');--> statement-breakpoint
UPDATE "shift" s
SET "position_id" = p."id"
FROM "position" p
WHERE s."role_code" IS NOT NULL
  AND btrim(s."role_code") <> ''
  AND p."organization_id" = s."organization_id"
  AND p."code" = regexp_replace(lower(btrim(s."role_code")), '\s+', '_', 'g')
  AND s."position_id" IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Normalise the employee role aliases, then close the reference
-- ---------------------------------------------------------------------------
-- Obvious free-text employment-language aliases → their `ROLE_CODE`, matched
-- case-insensitively and trimmed. Anything else is reported by leaving the
-- constraint `NOT VALID` (below) rather than guessed.
UPDATE "employee" SET "role_code" = 'kitchen'
WHERE btrim("role_code") <> 'kitchen'
  AND lower(btrim("role_code")) = 'kitchen staff';--> statement-breakpoint
UPDATE "employee" SET "role_code" = 'front_of_house'
WHERE btrim("role_code") <> 'front_of_house'
  AND lower(btrim("role_code")) IN ('coffee shop staff', 'barista', 'coffee shop');--> statement-breakpoint
UPDATE "employee" SET "role_code" = 'general_manager'
WHERE btrim("role_code") <> 'general_manager'
  AND lower(btrim("role_code")) IN ('manager', 'general manager');--> statement-breakpoint
-- Remaining values are lower-cased and trimmed so a case variant of a real
-- role code (`Kitchen`) satisfies the reference; a value outside `ROLE_CODE`
-- stays as-is and keeps the FK `NOT VALID`.
UPDATE "employee" SET "role_code" = lower(btrim("role_code"))
WHERE "role_code" <> lower(btrim("role_code"));--> statement-breakpoint
-- A mapped employee role must name a real role row. Create the fixed-vocabulary
-- role rows the organization is missing (never invent a non-`ROLE_CODE` code:
-- the `role_code_check` would reject it, and guessing is not allowed).
INSERT INTO "role" ("organization_id", "code", "name")
SELECT DISTINCT e."organization_id", e."role_code", e."role_code"
FROM "employee" e
LEFT JOIN "role" r
  ON r."organization_id" = e."organization_id" AND r."code" = e."role_code"
WHERE r."id" IS NULL
  AND e."role_code" IN (
    'owner', 'general_manager', 'location_manager', 'kitchen', 'front_of_house',
    'purchasing', 'finance', 'admin', 'analyst', 'product_owner',
    'technical_owner', 'data_owner'
  );--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_organization_id_role_code_fk"
  FOREIGN KEY ("organization_id","role_code")
  REFERENCES "public"."role"("organization_id","code")
  ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
-- Validate only when every employee role resolves to a role row in its own
-- organization; otherwise the constraint stays `NOT VALID` (new writes still
-- enforced) and the unmapped rows are for the operator to classify.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "employee" e
    LEFT JOIN "role" r
      ON r."organization_id" = e."organization_id" AND r."code" = e."role_code"
    WHERE r."id" IS NULL
  ) THEN
    ALTER TABLE "employee" VALIDATE CONSTRAINT "employee_organization_id_role_code_fk";
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "employee_position" ADD CONSTRAINT "employee_position_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_position" ADD CONSTRAINT "employee_position_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_position" ADD CONSTRAINT "employee_position_position_id_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."position"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_position_org_employee_idx" ON "employee_position" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "employee_position_org_position_idx" ON "employee_position" USING btree ("organization_id","position_id");--> statement-breakpoint
CREATE INDEX "position_org_active_idx" ON "position" USING btree ("organization_id","active_to");--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_position_id_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."position"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_org_role_code_idx" ON "employee" USING btree ("organization_id","role_code");--> statement-breakpoint
CREATE INDEX "shift_org_position_idx" ON "shift" USING btree ("organization_id","position_id");--> statement-breakpoint
-- Hand-written edge guards (the `0047`/`0052` precedent).
CREATE OR REPLACE FUNCTION "employee_position_employee_org_guard"()
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
      'employee_position.employee_id % belongs to organization %, but its employee_position % belongs to organization %',
      NEW."employee_id", employee_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "employee_position_employee_org_guard"
  BEFORE INSERT OR UPDATE ON "employee_position"
  FOR EACH ROW
  EXECUTE FUNCTION "employee_position_employee_org_guard"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "employee_position_position_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  position_org uuid;
BEGIN
  SELECT p."organization_id" INTO position_org
  FROM "position" p
  WHERE p."id" = NEW."position_id";

  IF FOUND AND position_org IS DISTINCT FROM NEW."organization_id" THEN
    RAISE EXCEPTION
      'employee_position.position_id % belongs to organization %, but its employee_position % belongs to organization %',
      NEW."position_id", position_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "employee_position_position_org_guard"
  BEFORE INSERT OR UPDATE ON "employee_position"
  FOR EACH ROW
  EXECUTE FUNCTION "employee_position_position_org_guard"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "shift_position_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  position_org uuid;
BEGIN
  IF NEW."position_id" IS NOT NULL THEN
    SELECT p."organization_id" INTO position_org
    FROM "position" p
    WHERE p."id" = NEW."position_id";

    IF FOUND AND position_org IS DISTINCT FROM NEW."organization_id" THEN
      RAISE EXCEPTION
        'shift.position_id % belongs to organization %, but its shift % belongs to organization %',
        NEW."position_id", position_org, NEW."id", NEW."organization_id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "shift_position_org_guard"
  BEFORE INSERT OR UPDATE ON "shift"
  FOR EACH ROW
  EXECUTE FUNCTION "shift_position_org_guard"();
