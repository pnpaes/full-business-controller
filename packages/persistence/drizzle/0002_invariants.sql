-- Invariants the generated DDL cannot express. Extensions live in 0000.
-- Kept here so `drizzle-kit generate` never fights them: the columns involved
-- are modelled as plain `uuid` in the TypeScript schema.

-- 1. Case-insensitive, partial unique indexes for app_user identifiers
--    (drizzle-kit 0.30 cannot express `lower()` + partial unique indexes).
--    `btrim` (2026-09-18) also rejects whitespace-variant duplicates.
CREATE UNIQUE INDEX "app_user_username_key"
  ON "app_user" ("organization_id", lower(btrim("username"))) WHERE "username" IS NOT NULL;
CREATE UNIQUE INDEX "app_user_email_key"
  ON "app_user" ("organization_id", lower(btrim("email"))) WHERE "email" IS NOT NULL;

-- 2. Effective-dated windows must not overlap within their scope.
ALTER TABLE "channel_fee_rule" ADD CONSTRAINT "channel_fee_rule_no_overlap"
  EXCLUDE USING gist (
    "channel_id" WITH =,
    "fee_kind" WITH =,
    tstzrange("effective_from", "effective_to") WITH &&
  );
ALTER TABLE "supplier_price" ADD CONSTRAINT "supplier_price_no_overlap"
  EXCLUDE USING gist (
    "supplier_item_id" WITH =,
    tstzrange("effective_from", "effective_to") WITH &&
  );
ALTER TABLE "recipe_version" ADD CONSTRAINT "recipe_version_no_overlap"
  EXCLUDE USING gist (
    "recipe_id" WITH =,
    tstzrange("effective_from", "effective_to") WITH &&
  );
ALTER TABLE "product_recipe_assignment" ADD CONSTRAINT "pra_no_overlap"
  EXCLUDE USING gist (
    "product_variant_id" WITH =,
    "location_id" WITH =,
    tstzrange("effective_from", "effective_to") WITH &&
  );

-- 3. Mutually-referential deferrable FKs:
--    cost_card.snapshot_id <-> calculation_snapshot.cost_card_id.
ALTER TABLE "calculation_snapshot" ADD CONSTRAINT "calculation_snapshot_cost_card_fk"
  FOREIGN KEY ("cost_card_id") REFERENCES "cost_card"("id")
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "cost_card" ADD CONSTRAINT "cost_card_snapshot_fk"
  FOREIGN KEY ("snapshot_id") REFERENCES "calculation_snapshot"("id")
  DEFERRABLE INITIALLY DEFERRED;

-- 4. Append-only enforcement (row + statement triggers; TRUNCATE bypass closed).
CREATE OR REPLACE FUNCTION reject_posted_movement_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_movement is append-only; post a reversal/adjustment instead';
END $$;

CREATE TRIGGER stock_movement_immutable
  BEFORE UPDATE OR DELETE ON stock_movement
  FOR EACH ROW EXECUTE FUNCTION reject_posted_movement_change();

CREATE TRIGGER stock_movement_no_truncate
  BEFORE TRUNCATE ON stock_movement
  FOR EACH STATEMENT EXECUTE FUNCTION reject_posted_movement_change();

CREATE OR REPLACE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP;
END $$;

CREATE TRIGGER calculation_snapshot_immutable
  BEFORE UPDATE OR DELETE ON calculation_snapshot
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER calculation_snapshot_no_truncate
  BEFORE TRUNCATE ON calculation_snapshot
  FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change();

CREATE TRIGGER audit_event_immutable
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change();
