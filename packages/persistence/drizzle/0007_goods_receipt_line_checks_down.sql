-- Down path for 0007_goods_receipt_line_checks.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md). Dropping the trigger and its
-- function removes no table and no row, so no existing data is touched.
DROP TRIGGER IF EXISTS "goods_receipt_line_accept_qty_guard" ON "goods_receipt_line";
DROP FUNCTION IF EXISTS "goods_receipt_line_accept_qty_guard"();
