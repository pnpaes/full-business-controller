-- Hand-written cross-organization coherence guard for
-- `import_run.import_profile_id` (`DEC-081`, closing the `DEC-079` shape for the
-- import-profile FK). Mirrors `0029_org_coherence_guards.sql` /
-- `0017_stock_ledger_invariants.sql`: the column stays a plain `uuid` in the
-- TypeScript schema, so `drizzle-kit generate` never sees or fights this object.
--
-- `import_run.import_profile_id` references `import_profile(id)` through a
-- single-column FK. The parent `id` is unique, so that FK cannot express that the
-- profile must belong to the run's own organization: `import_profile` carries its
-- own `organization_id`, and a run could otherwise point at another
-- organization's profile. `DEC-079` chose `BEFORE INSERT OR UPDATE` guard
-- triggers for exactly this shape (`recipe_allergen.allergen_id`,
-- `recipe_line.item_id`/`sub_recipe_id`, `goods_receipt_line.supplier_item_id`),
-- and the `DEC-081` profile FK is the same shape.
--
-- The trigger is **forward-only**: it validates new writes, it does not
-- re-validate rows already present, and existence of the profile (as opposed to
-- its organization) stays the FK's job — a missing profile falls through to the
-- FK error rather than the guard. The application remains the friendly-error
-- layer.
--
-- The down companion `0032_import_run_profile_org_guard_down.sql` drops the
-- trigger and its function; like the other down files it is not journaled.

BEGIN;
--> statement-breakpoint

-- `import_run`: a non-null `import_profile_id` must name a profile in the run's
-- own organization. Legacy runs (and sources with no profile) keep a null link
-- and return immediately.
CREATE OR REPLACE FUNCTION "import_run_profile_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  profile_org uuid;
BEGIN
  IF NEW."import_profile_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p."organization_id" INTO profile_org
  FROM "import_profile" p
  WHERE p."id" = NEW."import_profile_id";

  IF FOUND AND profile_org IS DISTINCT FROM NEW."organization_id" THEN
    RAISE EXCEPTION
      'import_run.import_profile_id % belongs to organization %, but its import_run % belongs to organization %',
      NEW."import_profile_id", profile_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "import_run_profile_org_guard"
  BEFORE INSERT OR UPDATE ON "import_run"
  FOR EACH ROW
  EXECUTE FUNCTION "import_run_profile_org_guard"();
--> statement-breakpoint

COMMIT;
