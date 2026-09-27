# 085 — 2026-09-26 — Payroll schedule: the first real async producer/consumer and the job-progress route (ADR-0004, DEC-139 item 5, DEC-104)

On branch `main` at HEAD `3348e78`; the whole slice is **uncommitted** in the
working tree, on top of the also-uncommitted pg-boss wiring slice (handoff
084). Nothing staged, nothing pushed, nothing applied to DigitalOcean. No
migration.

## What was decided and what was built.

`DEC-139` item 5 (`ADR-0004`) plus `DEC-104`: the producer/consumer pair that
makes the job runtime real — a pg-boss cron on the scheduler that evaluates
and enqueues the monthly payroll-report generation, and the consumer handler
that generates it, plus an authenticated HTTP route for job progress. The
slice touches no schema; the report writes ride the existing
`payroll_report` table and its `FOR UPDATE` lock.

- `packages/jobs-runtime/src/payroll-schedule.ts` (+ unit tests):
  `registerPayrollSchedule(boss, db, {organizationId, cron, logger})`
  registers a pg-boss cron (`PAYROLL_SCHEDULE_QUEUE =
  "outbox.maintenance.payroll_report"`, `missed:"once"`);
  `evaluatePayrollSchedule(store, org, now)` picks the candidate period —
  the current UTC month when `dayOfMonth >= lastDay-3`, else the previous
  UTC month when `dayOfMonth <= 5` (catch-up for a scheduler outage
  spanning the lead window), else `before-lead-window` — and skips with
  `report-already-exists` when a live (non-`superseded`) report exists;
  `enqueuePayrollReportGeneration(db, boss, org, period)` enqueues
  atomically (outbox row + `job` projection + pg-boss send + audit fact in
  ONE transaction via `createPgBossDispatcher(boss, tx, sql)`/`fromDrizzle`)
  with event type `workforce.payroll_report.generate`,
  `aggregateType "payroll_report"`, `aggregateId = organizationId`.
  `currentUtcPayrollPeriod`/`previousUtcPayrollPeriod` are pure UTC and
  reuse `lastDayOfUtcMonth`.
- `packages/jobs-runtime/src/handlers.ts`:
  `payrollReportGenerateHandler` reads `{periodStart, periodEnd}` from the
  **durable `job` projection** (not the pg-boss delivery), then inside one
  transaction holding `lockPayrollReportForPeriod`'s `FOR UPDATE` lock it
  refuses (throws `DomainError`) when the live report is `exported`,
  otherwise calls `generatePayrollReport(tx, {organizationId, periodStart,
  periodEnd, actorId: null})`. `DEC-104` items 5/9/10 (may an `exported`
  report be superseded?) stay OPEN — the guard is the conservative posture;
  a refusal fails the job (retries, then dead-letters to human review).
- `packages/jobs-runtime/src/{queues,consumer,worker,scheduler,index}.ts`:
  the cron queue + retry policy; `OutboxJobContext` gained an optional
  `db`, which the worker passes as `client.db`; `startScheduler` now
  registers the payroll cron (`SchedulerOptions.payrollCron`, default
  `0 5 * * *`).
- `apps/scheduler/src/main.ts`: `PAYROLL_CRON` env (default `0 5 * * *`);
  still requires `ORGANIZATION_ID`.
- `packages/application/src/scheduling/generate-payroll-report.ts`:
  `actorId` widened to `string | null` (system-initiated; `generated_by` is
  a plain nullable uuid).
- `packages/domain/src/period-close.ts` + `index.ts`: exported the existing
  pure `lastDayOfUtcMonth` (visibility only, no behaviour change).
- New `apps/web/app/api/v1/jobs/{access.ts,[id]/route.ts,[id]/route.test.ts}`:
  `GET /api/v1/jobs/[id]` — authenticated,
  `JOBS_READ_ROLES = ["owner","general_manager","finance","admin"]`
  (provisional per `DEC-101`), UUID validated before the DB, org-scoped
  `findJobById` (404 for an unknown id or another org's job), response
  `{ok, job:{id,status,kind,queue,attempts,maxAttempts,scheduledAt,
  startedAt,finishedAt,createdAt,updatedAt}}` — `payload` and `error` are
  deliberately omitted.
- `infra/modules/app-platform/main.tf`: the scheduler component's env now
  includes `ORGANIZATION_ID` (new `local.organization_env`, reused by
  `web_env`; `worker` unchanged) — this fixes the contradiction in the
  uncommitted tree where the deployed scheduler would exit 1.

## Commit basis (uncommitted).

Suggested layering — each commit reverts independently once committed:

1. `feat(jobs): schedule the monthly payroll report and expose job
   progress` — `packages/jobs-runtime/**` (schedule, handler, queues,
   consumer, worker, scheduler, index, tests),
   `packages/application/src/scheduling/generate-payroll-report.ts`,
   `packages/domain/src/{period-close.ts,index.ts}`,
   `apps/web/app/api/v1/jobs/**`, `apps/scheduler/src/main.ts`,
   `infra/modules/app-platform/main.tf`.
2. `docs: close the payroll-schedule slice` — this handoff, `CONTEXT.md`,
   the reversibility log.

## Verification.

`npm run typecheck`, `npm run lint` and `npm run format:check` clean;
`next build` exit 0; `npm run db:migrate` a no-op (`pgboss schema up to
date (pg-boss 42)`);
`DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela npm run
test` → **4954/4954 (361 files)** (post-review-fix: **4957/4957**, 361 files). The new integration test
`packages/jobs-runtime/src/payroll-schedule.postgres.test.ts` passes 5/5
and proves: (i) the atomic due enqueue with the queue job id === outbox
event id; (ii) dedup/idempotent skip; (iii) real consumption →
`payroll_report` `status='generated'` with `generated_by IS NULL`; (iv)
the exported-report refusal leaves the exported row unchanged and the
projection `failed`; (v) period derivation including leap February. The
jobs route test passes 13/13.

## Review reconciliation.

- `reviewer-qwen` (plan): accepted the blocker fix (never supersede an
  `exported` report) and the majors — the current-month period documented
  as provisional/under-counting, the route omitting `payload`/`error`, the
  infra scheduler env, `missed:'once'`, and the queue naming.
- `reviewer-glm` (diff): a **blocker** TOCTOU where the exported check
  happened outside the generation transaction, and a **major**
  month-boundary catch-up gap (an outage spanning the lead window
  silently lost the month). Both fixed in the fixer pass: the check and
  the generation now share one locked transaction, and the previous-month
  catch-up window covers the outage. Minors also fixed: a distinct
  missing-projection error, `NodeDatabase` typing, and a dropped unused
  `limit`.
- `qa-verifier`: **ACCEPT** on all nine acceptance criteria with
  falsification attempts, no counterexamples.

## Review-fix pass (`/review uncommitted`).

A `/review uncommitted` pass over the two uncommitted jobs slices reported
**six findings**; five fixed, one **declined with evidence**. Both slices
remain **uncommitted**. Post-fix verification: typecheck/lint/format:check
clean, `next build` exit 0, **4957/4957 tests (361 files)**, `db:migrate`
a no-op.

1. **Migrator-applied pgboss grants (fixed):** the pre-deploy migrator
   (`packages/persistence/scripts/migrate.mjs`) now applies the runtime
   grants itself after provisioning, under advisory lock `8675309` —
   `USAGE ON SCHEMA pgboss`, `SELECT/INSERT/UPDATE/DELETE ON ALL TABLES`,
   `USAGE,SELECT ON ALL SEQUENCES`, `EXECUTE ON ALL FUNCTIONS` and
   `ALTER DEFAULT PRIVILEGES FOR ROLE <current_user>` — to the
   `PGBOSS_APP_ROLE` (default `app`), **only when that role exists**
   (local dev logs `migrate: runtime role "app" absent; pgboss grants
   skipped (no-op)`). A grants failure throws (fail-closed).
   `infra/bootstrap/pgboss-grants.sql` is now belt-and-braces/recovery,
   not a required manual re-run (header updated).
2. **Recoverable downgrade error (fixed):** the `pgboss` downgrade refusal
   now names the recovery command `DROP SCHEMA pgboss CASCADE;`, and the
   `migrate.mjs` header notes a pg-boss schema bump blocks
   revert-by-redeploy until the schema is dropped.
3. **Terraform plan-time `check` (fixed):** `infra/modules/app-platform/
   main.tf` adds a non-blocking `check "organization_id_set"` warning at
   plan time when `organization_id` is empty (the scheduler exits 1 without
   it). Deliberately a `check`, not a `validation`/`precondition` — both
   tfvars keep `organization_id = ""` and the offline `plan` must keep
   working. (Terraform binary absent here — the HCL is unvalidated.)
4. **Narrowing `GRANT EXECUTE ON ALL FUNCTIONS` — DECLINED with evidence:**
   verified against the pinned pg-boss **12.33.2**: the only functions it
   defines in `pgboss` are `create_queue`, `delete_queue`, `job_now`,
   `job_table_format`, `job_table_run`, `job_table_run_async` — no
   `maintain`/`purge`/`archive`/`delete_jobs` — so the blanket grant covers
   exactly those; narrowing would risk the partition helpers for no gain.
5. **The payroll cron no longer trusts pg-boss-stored `job.data` (fixed):**
   it uses the configured `organizationId`; a stored-value mismatch logs a
   warning and is ignored.
6. **The maintenance cron likewise (fixed):** it uses the configured
   `organizationId` + `limit`; a stored-value mismatch logs a warning and
   is ignored.

## Deferred / recorded (not silently dropped).

- No HTTP producer returns `202` yet — the route is the progress
  endpoint; a real `202 + Location` producer follows (it would need a
  pg-boss instance in the web runtime or a manual-trigger route).
- The current-month report is provisional (under-counts the remaining
  days per `DEC-104`).
- `scheduledAt`/pg-boss `startAfter` delayed delivery is unimplemented
  (timing comes from the cron).
- The 90-day `job` retention prune, the `DEC-139` item-8 alert wiring and
  the DLQ weekly-review runbook remain open.
- The jobs access set is provisional (`DEC-101`).
- Terraform could not be validated here (binary absent) — the HCL must be
  `terraform validate`d in CI/before deploy.
- A post-success projection-write failure causes an extra supersede cycle
  (audit churn only, data consistent).

## Rollback.

Revert the commits (or `git checkout` the uncommitted tree). **No
migration in this slice** — nothing posted money or stock; the `pgboss`
schema drop (`DROP SCHEMA pgboss CASCADE`) is only needed when unwinding
the whole jobs stack, not this slice alone.
