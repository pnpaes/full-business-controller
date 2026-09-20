-- Down path for 0018_stock_movement_org_idempotency_key.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Restores the pre-0018 global unique on `idempotency_key`: drops the
-- per-organization composite unique and re-adds
-- `stock_movement_idempotency_key_key`. No table, but the re-add validates
-- existing rows, so it fails (and rolls back, leaving 0018 in place) if two
-- organizations already share an idempotency key. Resolve those duplicates
-- first. Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0018_stock_movement_org_idempotency_key_down.sql
BEGIN;

ALTER TABLE "stock_movement"
  DROP CONSTRAINT IF EXISTS "stock_movement_org_idempotency_key_key";
ALTER TABLE "stock_movement"
  ADD CONSTRAINT "stock_movement_idempotency_key_key" UNIQUE ("idempotency_key");

COMMIT;
