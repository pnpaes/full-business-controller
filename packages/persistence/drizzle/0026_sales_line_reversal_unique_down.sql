-- Down path for 0026_sales_line_reversal_unique.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the `sales_line_reversal_of_id_key` partial unique index inside one
-- transaction. It touches no table and no row (the index is metadata only), so
-- it is safe to run whenever the invariant must be removed (for example before a
-- data repair); while dropped, two lines in one organization may share a
-- non-null `reversal_of_id`, and only `reverseSalesLine`'s pre-check remains as
-- the guard. Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0026_sales_line_reversal_unique_down.sql
BEGIN;

DROP INDEX IF EXISTS "sales_line_reversal_of_id_key";

COMMIT;
