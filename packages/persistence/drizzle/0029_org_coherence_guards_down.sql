-- Down path for 0029_org_coherence_guards.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the three `DEC-079` org-coherence guard triggers and their functions and
-- the `goods_receipt_line.supplier_item_id` existence FK. No table and no row is
-- touched, so it is safe to run whenever the cross-organization invariants must
-- be removed (for example before a data repair). Once the raw objects are
-- dropped, the organization coherence of `recipe_allergen.allergen_id`,
-- `recipe_line.item_id`/`sub_recipe_id` and the receipt line's
-- `item_id`/`supplier_item_id` is validated only by the application again, and
-- the `supplier_item_id` link is unenforced until the migration is re-applied.
BEGIN;

DROP TRIGGER IF EXISTS "recipe_allergen_org_guard" ON "recipe_allergen";
DROP FUNCTION IF EXISTS "recipe_allergen_org_guard"();
DROP TRIGGER IF EXISTS "recipe_line_org_guard" ON "recipe_line";
DROP FUNCTION IF EXISTS "recipe_line_org_guard"();
DROP TRIGGER IF EXISTS "goods_receipt_line_org_guard" ON "goods_receipt_line";
DROP FUNCTION IF EXISTS "goods_receipt_line_org_guard"();
ALTER TABLE "goods_receipt_line" DROP CONSTRAINT IF EXISTS "goods_receipt_line_supplier_item_id_supplier_item_id_fk";

COMMIT;
