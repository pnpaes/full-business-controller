-- Down path for 0070_forecast_snapshot_forecast_override.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md, "Down migrations").
--
-- Drops the `DEC-011` append-only `forecast_override` triggers, then the
-- `forecast_override` and `forecast_snapshot` tables (their checks, uniques,
-- indexes and FKs go with them). The shared `reject_immutable_change()` function
-- from `0002_invariants.sql` is deliberately **not** dropped: other append-only
-- tables still use it.
--
-- Both tables hold only recorded model output and advisory human overrides, not
-- financial or stock facts, but the snapshot/override rows are still lost, so
-- take a backup before running the drop (AGENTS.md Rule 2). Apply it manually
-- with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0070_forecast_snapshot_forecast_override_down.sql
--
-- Rehearsed 2026-09-25 on a scratch database (never the dev database): created,
-- all migrations applied, both tables confirmed present, this down applied, both
-- tables confirmed absent, scratch database dropped.
BEGIN;

DROP TRIGGER IF EXISTS "forecast_override_immutable" ON "forecast_override";
DROP TRIGGER IF EXISTS "forecast_override_no_truncate" ON "forecast_override";
DROP TABLE IF EXISTS "forecast_override";
DROP TABLE IF EXISTS "forecast_snapshot";

COMMIT;
