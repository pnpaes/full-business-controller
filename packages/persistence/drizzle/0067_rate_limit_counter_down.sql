-- Down path for 0067_rate_limit_counter.sql. Not listed in meta/_journal.json
-- on purpose: `drizzle-kit migrate` only applies journal entries, so a rollback
-- is an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-135` `rate_limit_counter` table (its `(namespace, key)` unique
-- goes with it). The drop is **destructive**: every in-flight window is lost, so
-- the next request in each limit namespace starts a fresh window. That is only
-- traffic-throttling state, not a business fact, so the loss is bounded and the
-- table can be recreated by re-applying `0067`; take no backup. Apply it
-- manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0067_rate_limit_counter_down.sql
BEGIN;

DROP TABLE IF EXISTS "rate_limit_counter";

COMMIT;
