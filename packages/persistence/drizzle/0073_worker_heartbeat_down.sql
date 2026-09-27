-- Down path for 0073_worker_heartbeat.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md, "Down migrations").
--
-- Drops the `worker_heartbeat` operational table (its role check and text
-- primary key go with it). No business, money or stock fact is stored there:
-- the table only records the last-seen instant of each live worker/scheduler
-- process, so dropping it stops in-app dead-worker detection until the table is
-- recreated and the processes write their next heartbeat (the platform-log
-- alert remains as the secondary signal). Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0073_worker_heartbeat_down.sql
--
-- Rehearsed 2026-09-27 on a scratch database (never the dev database): created,
-- all migrations applied through 0073, `worker_heartbeat` confirmed present,
-- this down applied, the table confirmed absent, scratch database dropped.
BEGIN;

DROP TABLE IF EXISTS "worker_heartbeat";

COMMIT;
