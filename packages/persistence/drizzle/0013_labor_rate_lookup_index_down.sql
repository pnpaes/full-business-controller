-- Down path for 0013_labor_rate_lookup_index.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the index only; no table and no row, so it is safe to run whenever the
-- lookup index must be removed (for example before a data repair).
DROP INDEX IF EXISTS "labor_rate_lookup_idx";
