-- Down path for 0011_cost_allocation.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- These are the four slice-6 cost-allocation tables only: dropping them drops
-- their checks, indexes and FKs with them. `allocation_rule` is dropped before
-- `cost_pool` because it references it (FK-safe order). No existing table is
-- touched, so no pre-existing data is removed. `IF EXISTS` + a single
-- transaction make a half-applied manual run idempotent instead of wedging on a
-- missing table.
--
-- The three `0012` exclusion constraints (`cost_pool_no_overlap`,
-- `labor_rate_no_overlap`, `allocation_rule_no_overlap`) live on these tables
-- and are dropped with them. Apply
-- `0012_cost_allocation_invariants_down.sql` first only if you want them
-- dropped explicitly (or are dropping the tables out of order); it is not
-- required when this file runs.
BEGIN;
DROP TABLE IF EXISTS "allocation_rule";
DROP TABLE IF EXISTS "cost_pool";
DROP TABLE IF EXISTS "labor_rate";
DROP TABLE IF EXISTS "operating_cost";
COMMIT;
