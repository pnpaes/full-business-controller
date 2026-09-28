-- `DEC-150` (accepted 2026-09-28): stock-item **purpose** — `for_sale` vs
-- `for_use`. Every stock item is either for-sale (a stocked item a sellable is
-- fulfilled from — today's `finished_good`; one or more product variants may
-- draw it down) or for-use (an input consumed by production/operations that **no
-- variant may reference**). Stocking/tracking is not the axis; purpose is. The
-- value is stored as **data**, not a type mapping: it is backfilled from
-- `item_type` here and editable afterwards (`item_type` stops deciding it).
--
-- Expand → backfill → constrain, so the apply is safe on a live `item` table:
-- the column is added nullable, every existing row is classified from
-- `item_type`, and only then are `NOT NULL`, the default, the `check` and the
-- purpose index applied. `ADD COLUMN ... NOT NULL DEFAULT` in one statement
-- would classify every existing `finished_good` as `for_use`, which is wrong.
--
-- The hand-written `product_variant` edge guard (the `0047`/`0077` precedent)
-- enforces the cross-entity half of the decision: `DEC-030`'s sellable identity
-- is `Product`/`ProductVariant`, and a variant's nullable `finished_good_item_id`
-- may reference only a **for-sale** item in its own organization. The
-- application commands (`registerProductVariant`/`updateProductVariant`) are the
-- friendly-error layer over this trigger. The down companion
-- `0079_item_purpose_down.sql` is hand-written and not journaled
-- (`drizzle-kit migrate` applies journal entries only), so a rollback is an
-- explicit operator action (docs/runbooks/persistence-migrations.md).
ALTER TABLE "item" ADD COLUMN "purpose" text;--> statement-breakpoint
UPDATE "item"
SET "purpose" = CASE WHEN "item_type" = 'finished_good' THEN 'for_sale' ELSE 'for_use' END
WHERE "purpose" IS NULL;--> statement-breakpoint
ALTER TABLE "item" ALTER COLUMN "purpose" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "item" ALTER COLUMN "purpose" SET DEFAULT 'for_use';--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_purpose_check" CHECK ("item"."purpose" in ('for_sale', 'for_use'));--> statement-breakpoint
CREATE INDEX "item_organization_id_purpose_idx" ON "item" USING btree ("organization_id","purpose");--> statement-breakpoint
-- Hand-written edge guard: a non-null `product_variant.finished_good_item_id`
-- must name a **for-sale** item, and that item must belong to the variant's own
-- organization (no other trigger covers `product_variant`, unlike the `0047`
-- tables). Forward-only: it validates new writes, it does not re-validate rows
-- already present, it skips when `finished_good_item_id` is unchanged on UPDATE
-- (`DEC-030` identity updates must not be blocked by historical data), and it
-- skips a missing item so the single-column FK keeps owning existence.
CREATE OR REPLACE FUNCTION "product_variant_finished_good_purpose_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item_org uuid;
  item_purpose text;
BEGIN
  IF NEW."finished_good_item_id" IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW."finished_good_item_id" IS NOT DISTINCT FROM OLD."finished_good_item_id" THEN
    RETURN NEW;
  END IF;

  SELECT i."organization_id", i."purpose" INTO item_org, item_purpose
  FROM "item" i
  WHERE i."id" = NEW."finished_good_item_id";

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF item_org IS DISTINCT FROM NEW."organization_id" THEN
    RAISE EXCEPTION
      'product_variant.finished_good_item_id % belongs to organization %, but its product_variant % belongs to organization %',
      NEW."finished_good_item_id", item_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  IF item_purpose <> 'for_sale' THEN
    RAISE EXCEPTION
      'product_variant.finished_good_item_id % is a for-use item (purpose = %); only a for-sale item may back a variant',
      NEW."finished_good_item_id", item_purpose
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "product_variant_finished_good_purpose_guard"
  BEFORE INSERT OR UPDATE ON "product_variant"
  FOR EACH ROW
  EXECUTE FUNCTION "product_variant_finished_good_purpose_guard"();
