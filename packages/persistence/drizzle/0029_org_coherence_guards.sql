-- Hand-written cross-organization coherence guards (`DEC-079`, closing
-- `DEC-054`'s open point on the recipe FKs and the receipt-line supplier item).
-- Mirrors the `0017_stock_ledger_invariants.sql` / `0021_slice10_production.sql`
-- conventions: the columns stay plain in the TypeScript schema, so
-- `drizzle-kit generate` never sees or fights these objects.
--
-- Two obligations are closed here:
--
-- 1. `goods_receipt_line.supplier_item_id` was deferred (a plain `uuid` in the
--    TypeScript schema, like `supplier_price.supplier_item_id`) until the
--    supplier-item slice landed. It now gets its existence FK, added `NOT VALID`
--    then `VALIDATE` per this runbook's deferred-FK pattern, because the table
--    may already hold rows at apply time: `NOT VALID` is metadata-only and
--    validates new writes, `VALIDATE CONSTRAINT` proceeds in the same
--    transactional migration if the table is clean.
--
-- 2. `recipe_allergen.allergen_id`, `recipe_line.item_id`/`sub_recipe_id` and
--    `goods_receipt_line`'s `item_id`/`supplier_item_id` need **organization
--    coherence** with their parents, which a single-column FK cannot express
--    (the parent `id` is unique but its `organization_id` is not part of the
--    referenced key). `DEC-079` chose `BEFORE INSERT OR UPDATE` guard triggers
--    over denormalized composite FKs plus a backfill. Each trigger resolves the
--    parent organization through the existing FK path and raises when the
--    referenced row belongs to another organization; the receipt-line guard also
--    enforces the supplier match and the item match. Unit-matches-item remains
--    application-guarded (it needs the conversion graph).
--
-- The triggers are **forward-only**: they validate new writes, they do not
-- re-validate rows already present, and existence of the referenced row (as
-- opposed to its organization) stays the FK's job — a missing parent falls
-- through to the FK error rather than the guard. The application guards remain
-- the friendly-error layer.
--
-- The down companion `0029_org_coherence_guards_down.sql` drops the three
-- triggers, their functions and the FK; like the other down files it is not
-- journaled.

BEGIN;
--> statement-breakpoint

ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_supplier_item_id_supplier_item_id_fk"
  FOREIGN KEY ("supplier_item_id") REFERENCES "public"."supplier_item"("id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "goods_receipt_line" VALIDATE CONSTRAINT "goods_receipt_line_supplier_item_id_supplier_item_id_fk";
--> statement-breakpoint

-- `recipe_allergen`: the allergen and the recipe (reached via
-- `recipe_version.recipe_id`) must share one organization.
CREATE OR REPLACE FUNCTION "recipe_allergen_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  recipe_org uuid;
  allergen_org uuid;
BEGIN
  SELECT r."organization_id" INTO recipe_org
  FROM "recipe_version" rv
  JOIN "recipe" r ON r."id" = rv."recipe_id"
  WHERE rv."id" = NEW."recipe_version_id";

  SELECT a."organization_id" INTO allergen_org
  FROM "allergen" a
  WHERE a."id" = NEW."allergen_id";

  IF FOUND AND allergen_org IS DISTINCT FROM recipe_org THEN
    RAISE EXCEPTION
      'recipe_allergen.allergen_id % belongs to organization %, but its recipe_version % belongs to organization %',
      NEW."allergen_id", allergen_org, NEW."recipe_version_id", recipe_org
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "recipe_allergen_org_guard"
  BEFORE INSERT OR UPDATE ON "recipe_allergen"
  FOR EACH ROW
  EXECUTE FUNCTION "recipe_allergen_org_guard"();
--> statement-breakpoint

-- `recipe_line`: the recipe organization is resolved once from
-- `recipe_version -> recipe`; a direct item and a sub-recipe (whichever is set)
-- must each share it.
CREATE OR REPLACE FUNCTION "recipe_line_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  recipe_org uuid;
  ref_org uuid;
BEGIN
  SELECT r."organization_id" INTO recipe_org
  FROM "recipe_version" rv
  JOIN "recipe" r ON r."id" = rv."recipe_id"
  WHERE rv."id" = NEW."recipe_version_id";

  IF NEW."item_id" IS NOT NULL THEN
    SELECT i."organization_id" INTO ref_org
    FROM "item" i
    WHERE i."id" = NEW."item_id";

    IF FOUND AND ref_org IS DISTINCT FROM recipe_org THEN
      RAISE EXCEPTION
        'recipe_line.item_id % belongs to organization %, but its recipe_version % belongs to organization %',
        NEW."item_id", ref_org, NEW."recipe_version_id", recipe_org
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."sub_recipe_id" IS NOT NULL THEN
    SELECT r."organization_id" INTO ref_org
    FROM "recipe" r
    WHERE r."id" = NEW."sub_recipe_id";

    IF FOUND AND ref_org IS DISTINCT FROM recipe_org THEN
      RAISE EXCEPTION
        'recipe_line.sub_recipe_id % belongs to organization %, but its recipe_version % belongs to organization %',
        NEW."sub_recipe_id", ref_org, NEW."recipe_version_id", recipe_org
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "recipe_line_org_guard"
  BEFORE INSERT OR UPDATE ON "recipe_line"
  FOR EACH ROW
  EXECUTE FUNCTION "recipe_line_org_guard"();
--> statement-breakpoint

-- `goods_receipt_line`: resolve the receipt's organization and supplier, then
-- (a) the line item must share the receipt organization, and (b) a non-null
-- `supplier_item_id` must be in the same organization, belong to the receipt's
-- supplier and match the line item. A receipt with no supplier (DEC-047 store
-- fallback) can never carry a supplier item, because `si.supplier_id` cannot
-- equal a null `receipt.supplier_id`.
CREATE OR REPLACE FUNCTION "goods_receipt_line_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  receipt_org uuid;
  receipt_supplier_id uuid;
  item_org uuid;
  si_org uuid;
  si_supplier_id uuid;
  si_item_id uuid;
BEGIN
  SELECT "organization_id", "supplier_id"
    INTO receipt_org, receipt_supplier_id
  FROM "goods_receipt"
  WHERE "id" = NEW."goods_receipt_id";

  SELECT i."organization_id" INTO item_org
  FROM "item" i
  WHERE i."id" = NEW."item_id";

  IF FOUND AND item_org IS DISTINCT FROM receipt_org THEN
    RAISE EXCEPTION
      'goods_receipt_line.item_id % belongs to organization %, but its receipt % belongs to organization %',
      NEW."item_id", item_org, NEW."goods_receipt_id", receipt_org
      USING ERRCODE = '23514';
  END IF;

  IF NEW."supplier_item_id" IS NOT NULL THEN
    SELECT si."organization_id", si."supplier_id", si."item_id"
      INTO si_org, si_supplier_id, si_item_id
    FROM "supplier_item" si
    WHERE si."id" = NEW."supplier_item_id";

    IF FOUND AND (
      si_org IS DISTINCT FROM receipt_org
      OR si_supplier_id IS DISTINCT FROM receipt_supplier_id
      OR si_item_id IS DISTINCT FROM NEW."item_id"
    ) THEN
      RAISE EXCEPTION
        'goods_receipt_line.supplier_item_id % (organization %, supplier %, item %) does not match receipt % (organization %, supplier %) and item %',
        NEW."supplier_item_id", si_org, si_supplier_id, si_item_id,
        NEW."goods_receipt_id", receipt_org, receipt_supplier_id, NEW."item_id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "goods_receipt_line_org_guard"
  BEFORE INSERT OR UPDATE ON "goods_receipt_line"
  FOR EACH ROW
  EXECUTE FUNCTION "goods_receipt_line_org_guard"();
--> statement-breakpoint

COMMIT;
