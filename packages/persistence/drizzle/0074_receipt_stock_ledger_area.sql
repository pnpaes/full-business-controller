ALTER TABLE "location" ADD COLUMN "default_storage_area_id" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD COLUMN "storage_area_id" uuid;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_default_storage_area_id_storage_area_id_fk" FOREIGN KEY ("default_storage_area_id") REFERENCES "public"."storage_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_storage_area_id_storage_area_id_fk" FOREIGN KEY ("storage_area_id") REFERENCES "public"."storage_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-written coherence guards for DEC-145 (a receipt's destination storage
-- area resolves to the receiving location's default storage area, with an
-- explicit per-receipt override, and posting fails closed when neither
-- resolves). drizzle-kit cannot express a cross-row/cross-table coherence rule,
-- so both are hand-written `BEFORE INSERT OR UPDATE` triggers (mirrors
-- `0045`/`0056`/`0058`). They are forward-only: they validate new writes, not
-- rows already present, and on an UPDATE that leaves the guarded columns
-- unchanged they skip the lookup entirely.
--
-- (1) A location's `default_storage_area_id` must name a `storage_area` that
--     belongs to that same location and organization. The single-column FK only
--     catches a missing row; this catches a foreign location's area.
--
-- (2) A receipt's `storage_area_id` override must name a `storage_area` that
--     belongs to the receipt's own `location_id` and organization.
--
-- The down companion `0074_receipt_stock_ledger_area_down.sql` drops both
-- triggers and their functions and then the two columns; like the other down
-- files it is not journaled.

CREATE OR REPLACE FUNCTION "location_default_storage_area_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  area_location uuid;
  area_org uuid;
BEGIN
  IF NEW."default_storage_area_id" IS NOT NULL
    AND (
      TG_OP = 'INSERT'
      OR NEW."default_storage_area_id" IS DISTINCT FROM OLD."default_storage_area_id"
      OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
    )
  THEN
    SELECT sa."location_id", sa."organization_id"
      INTO area_location, area_org
      FROM "storage_area" sa
      WHERE sa."id" = NEW."default_storage_area_id";

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'location.default_storage_area_id % is not a storage_area (location %)',
        NEW."default_storage_area_id", NEW."id"
        USING ERRCODE = '23514';
    END IF;

    IF area_location IS DISTINCT FROM NEW."id" THEN
      RAISE EXCEPTION
        'location.default_storage_area_id % belongs to location %, but the default is set on location %',
        NEW."default_storage_area_id", area_location, NEW."id"
        USING ERRCODE = '23514';
    END IF;

    IF area_org IS DISTINCT FROM NEW."organization_id" THEN
      RAISE EXCEPTION
        'location.default_storage_area_id % belongs to organization %, but the location % belongs to organization %',
        NEW."default_storage_area_id", area_org, NEW."id", NEW."organization_id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "location_default_storage_area_guard"
  BEFORE INSERT OR UPDATE ON "location"
  FOR EACH ROW
  EXECUTE FUNCTION "location_default_storage_area_guard"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "goods_receipt_storage_area_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  area_location uuid;
  area_org uuid;
BEGIN
  IF NEW."storage_area_id" IS NOT NULL
    AND (
      TG_OP = 'INSERT'
      OR NEW."storage_area_id" IS DISTINCT FROM OLD."storage_area_id"
      OR NEW."location_id" IS DISTINCT FROM OLD."location_id"
      OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
    )
  THEN
    SELECT sa."location_id", sa."organization_id"
      INTO area_location, area_org
      FROM "storage_area" sa
      WHERE sa."id" = NEW."storage_area_id";

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'goods_receipt.storage_area_id % is not a storage_area (receipt %)',
        NEW."storage_area_id", NEW."id"
        USING ERRCODE = '23514';
    END IF;

    IF area_location IS DISTINCT FROM NEW."location_id" THEN
      RAISE EXCEPTION
        'goods_receipt.storage_area_id % belongs to location %, but receipt % is received at location %',
        NEW."storage_area_id", area_location, NEW."id", NEW."location_id"
        USING ERRCODE = '23514';
    END IF;

    IF area_org IS DISTINCT FROM NEW."organization_id" THEN
      RAISE EXCEPTION
        'goods_receipt.storage_area_id % belongs to organization %, but receipt % belongs to organization %',
        NEW."storage_area_id", area_org, NEW."id", NEW."organization_id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "goods_receipt_storage_area_guard"
  BEFORE INSERT OR UPDATE ON "goods_receipt"
  FOR EACH ROW
  EXECUTE FUNCTION "goods_receipt_storage_area_guard"();