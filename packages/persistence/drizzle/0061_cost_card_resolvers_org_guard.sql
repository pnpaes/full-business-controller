-- Hand-written cross-organization coherence guards for the `DEC-112` cost-card
-- component-resolver slice, closing its org-coherence gap:
-- `recipe_version.labor_cost_center_id` and `operating_cost.cost_pool_id` are
-- organization-scoped references, but their single-column FKs cannot express
-- that the referenced row belongs to the same organization (`cost_center` and
-- `cost_pool` each carry their own `organization_id`). `recipe_version` has no
-- `organization_id` of its own — its organization comes from `recipe` via
-- `recipe_version.recipe_id` — so that guard reads the owner through `recipe`;
-- `operating_cost` carries its own `organization_id`. Mirrors
-- `0052_shift_scheduling_org_guard.sql` (the `DEC-079`/`DEC-089` precedent): the
-- FKs are authored normally, but the organization match stays a hand-written
-- `BEFORE INSERT OR UPDATE` trigger so `drizzle-kit generate` never sees or
-- fights it.
--
-- Both guards are **forward-only**: they validate new writes, they do not
-- re-validate rows already present, and existence of the referenced row (as
-- opposed to its organization) stays the FK's job — a missing row falls through
-- to the FK error rather than the guard. Both columns are nullable, so the
-- guards skip a null reference (return NEW) and, in the `recipe_version` case,
-- also skip when either the `recipe` or the `cost_center` row is missing (the
-- org comparison is only meaningful when both rows are found). The application
-- remains the friendly-error layer.
--
-- The down companion `0061_cost_card_resolvers_org_guard_down.sql` drops the
-- triggers and their functions; like the other down files it is not journaled.

BEGIN;
--> statement-breakpoint

-- `recipe_version`: a non-null `labor_cost_center_id` must name a cost centre
-- row in the version's own organization. The version's organization is not on
-- this table — it is read from `recipe` via `NEW.recipe_id`. A null reference
-- returns untouched; a missing `recipe` or `cost_center` row is left to the FK.
CREATE OR REPLACE FUNCTION "recipe_version_labor_cost_center_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  recipe_org uuid;
  cost_center_org uuid;
BEGIN
  IF NEW."labor_cost_center_id" IS NOT NULL THEN
    SELECT r."organization_id" INTO recipe_org
    FROM "recipe" r
    WHERE r."id" = NEW."recipe_id";

    IF FOUND THEN
      SELECT cc."organization_id" INTO cost_center_org
      FROM "cost_center" cc
      WHERE cc."id" = NEW."labor_cost_center_id";

      IF FOUND AND cost_center_org IS DISTINCT FROM recipe_org THEN
        RAISE EXCEPTION
          'recipe_version.labor_cost_center_id % belongs to organization %, but its recipe % belongs to organization %',
          NEW."labor_cost_center_id", cost_center_org, NEW."recipe_id", recipe_org
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "recipe_version_labor_cost_center_org_guard"
  BEFORE INSERT OR UPDATE ON "recipe_version"
  FOR EACH ROW
  EXECUTE FUNCTION "recipe_version_labor_cost_center_org_guard"();
--> statement-breakpoint

-- `operating_cost`: a non-null `cost_pool_id` must name a cost pool row in the
-- operating cost's own organization. A null reference returns untouched; a
-- missing `cost_pool` row is left to the FK.
CREATE OR REPLACE FUNCTION "operating_cost_cost_pool_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cost_pool_org uuid;
BEGIN
  IF NEW."cost_pool_id" IS NOT NULL THEN
    SELECT cp."organization_id" INTO cost_pool_org
    FROM "cost_pool" cp
    WHERE cp."id" = NEW."cost_pool_id";

    IF FOUND AND cost_pool_org IS DISTINCT FROM NEW."organization_id" THEN
      RAISE EXCEPTION
        'operating_cost.cost_pool_id % belongs to organization %, but its operating_cost % belongs to organization %',
        NEW."cost_pool_id", cost_pool_org, NEW."id", NEW."organization_id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "operating_cost_cost_pool_org_guard"
  BEFORE INSERT OR UPDATE ON "operating_cost"
  FOR EACH ROW
  EXECUTE FUNCTION "operating_cost_cost_pool_org_guard"();
--> statement-breakpoint

COMMIT;
