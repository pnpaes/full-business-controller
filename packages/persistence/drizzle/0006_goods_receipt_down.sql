-- Down path for 0006_goods_receipt.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- These are the two slice-4 receiving tables only. `goods_receipt_line` is
-- dropped before `goods_receipt` because it references it (its `ON DELETE
-- cascade` and index drop with the table). The append-only `audit_event` rows
-- that recorded acceptance are deliberately left in place: audit is append-only
-- and a financial reversal is a new fact, not a deletion (AGENTS.md Rule 2).
-- `IF EXISTS` + a single transaction make a half-applied manual run idempotent.
BEGIN;
DROP TABLE IF EXISTS "goods_receipt_line";
DROP TABLE IF EXISTS "goods_receipt";
COMMIT;
