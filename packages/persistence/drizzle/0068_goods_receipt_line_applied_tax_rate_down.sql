-- Down path for 0068_goods_receipt_line_applied_tax_rate.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md, "Down migrations").
--
-- Drops the expand-only `goods_receipt_line.applied_tax_rate` column; its
-- `goods_receipt_line_applied_tax_rate_check` goes with it (the check is on that
-- column alone). The drop is **destructive to the captured provenance**: a line
-- recorded after 0068 loses the rate that produced its recoverable tax, so its
-- `landed_base_unit_cost` can no longer be re-derived from the row (the very gap
-- 0068 closed). No money figure, stock fact or other column is touched, and the
-- column can be re-created by re-applying 0068 — but the dropped values cannot
-- be recovered from the schema, so take a backup before running the drop.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0068_goods_receipt_line_applied_tax_rate_down.sql
BEGIN;

ALTER TABLE "goods_receipt_line" DROP COLUMN IF EXISTS "applied_tax_rate";

COMMIT;
