-- Down path for 0075_ai_advisory.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md,
-- "Down migrations").
--
-- Drops the append-only trigger on `ai_analysis_run`, then the two tables in
-- dependency order (`ai_suggestion` first, its FK to `ai_analysis_run` goes with
-- it). This is destructive only to AI advisory provenance and suggestion rows:
-- no posted money, stock or other business fact is touched, and nothing else
-- references either table. Take a backup before running the drop (AGENTS.md
-- Rule 2). Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0075_ai_advisory_down.sql
BEGIN;

DROP TRIGGER IF EXISTS "ai_analysis_run_immutable" ON "ai_analysis_run";
DROP TRIGGER IF EXISTS "ai_analysis_run_no_truncate" ON "ai_analysis_run";

DROP TABLE IF EXISTS "ai_suggestion";
DROP TABLE IF EXISTS "ai_analysis_run";

COMMIT;
