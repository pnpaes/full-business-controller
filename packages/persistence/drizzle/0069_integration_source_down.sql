-- Down path for 0069_integration_source.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md, "Down migrations").
--
-- Drops the expand-only `integration_source` table created by 0069 (its checks,
-- unique, index and organization FK go with it). The table holds integration
-- configuration only, not financial or stock facts, but the registry rows are
-- still lost, so take a backup before running the drop (AGENTS.md Rule 2).
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0069_integration_source_down.sql
--
-- Rehearsed 2026-09-25 on a scratch database (never the dev database): created,
-- all migrations applied, `integration_source` confirmed present, this down
-- applied, table confirmed absent, scratch database dropped.
BEGIN;

DROP TABLE IF EXISTS "integration_source";

COMMIT;
