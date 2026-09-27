-- Down path for 0072_job_org_created_at_idx.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md, "Down migrations").
--
-- Drops `job_org_created_at_idx`, the `(organization_id, created_at)` index added
-- by 0072 to support the `JobStore.deleteExpiredJobs` retention prune (the
-- recorded `DEC-139` follow-up). No table and no row is touched, so it is safe to
-- run whenever the index must be removed (for example before a data repair);
-- while dropped, the prune falls back to `job_org_status_scheduled_idx` (the
-- narrow org + terminal-status filter) plus a sort/filter on `created_at`. The
-- other two `job` indexes (`job_org_status_scheduled_idx`,
-- `job_org_outbox_event_idx`) and the table itself are left untouched. Apply it
-- manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0072_job_org_created_at_idx_down.sql
--
-- Rehearsed 2026-09-27 on a scratch database (never the dev database): created,
-- migrations applied through 0072, `job_org_created_at_idx` confirmed present and
-- `job` still carrying its other two indexes, this down applied, the index
-- confirmed absent and `job` still present, scratch database dropped.
BEGIN;

DROP INDEX IF EXISTS "job_org_created_at_idx";

COMMIT;
