# 084 — 2026-09-26 — Jobs runtime: pg-boss worker wiring and scheduler cron (ADR-0004, DEC-139)

On branch `main` at HEAD `3348e78`; the whole slice is **uncommitted** in the
working tree (nothing staged, nothing pushed, nothing applied to
DigitalOcean).

## What was decided and what was built.

`ADR-0004` was accepted on 2026-09-26 (`DEC-139`, owner/tech-lead; runner
pg-boss pinned `12.33.2`, delivery shape **P2**). The prior session landed the
P2 platform core (`c66eb27`: migration `0071` `job` projection, the outbox
write path, `enqueueOutboxEvent`). This session delivered `DEC-139` item 9's
remaining work: the pg-boss worker wiring and the scheduler cron, proven with
a non-external consumer and a scheduled maintenance job. New workspace package
`packages/jobs-runtime` (`@aquarela/jobs-runtime`):

- the boss factory (`schema:"pgboss"`, `migrate:false`, `createSchema:false`,
  `useListenNotify:false` — the migrator owns the `pgboss` DDL and the `app`
  role is DML-only);
- the queue config (each event type is its own queue `outbox.<eventType>`; DLQ
  `outbox-dead-letter`; `retryLimit 5` + exponential backoff +
  `retryDelayMax 3600`; outbox queue retention 14 d / delete 7 d; DLQ
  retention/delete 30 d; `partition:false`);
- `createPgBossDispatcher` — binds pg-boss `send` to the caller's transaction
  via `fromDrizzle(tx, sql)` with `id = outboxEvent.id` (a duplicate resolves
  `null` → idempotent no-op; a throw rolls the outbox row and the projection
  back with it);
- `createOutboxConsumer` (array handler; idempotent skip for settled
  `succeeded`/`dead_lettered`; marks running → succeeded + outbox
  `published_at` + an audit fact; on failure records the attempt + failed,
  dead-letters at max attempts, and rethrows so pg-boss retries);
- a non-external proof consumer `platform.smoke`, writing an append-only
  `audit_event`; and
- the scheduled maintenance job that **replays unpublished outbox rows** — the
  P2 disposable-queue recovery (`listUnpublished` → `send` with `id`,
  tolerating `null`).

`startWorker` sets `schedule:false` and `startScheduler` sets `schedule:true`;
both attach pg-boss `error`/`warning` listeners and use `batchSize: 1`.
Additive core change: `OutboxDispatchEvent` gained `queue`, and
`jobs.job.consumed` was added to the audit actions. `apps/worker/src/main.ts`
and `apps/scheduler/src/main.ts` are now thin wrappers (smoke env preserved:
`WORKER_TICKS`, `WORKER_HEARTBEAT_MS`, `SCHEDULER_TICKS`,
`SCHEDULER_INTERVAL_MS`; the scheduler additionally reads `ORGANIZATION_ID`
and `MAINTENANCE_CRON`, default `*/15 * * * *`).

The pre-deploy migrator (`packages/persistence/scripts/migrate.mjs`), under
advisory lock `8675309`, now provisions/migrates the `pgboss` schema from the
pinned package's own `getConstructionPlans`/`getMigrationPlans` (installed
version read from `pgboss.version`, expected `schemaVersion` 42), fail-closed,
with no `_journal.json` entry and no numbered migration; a new
`infra/bootstrap/pgboss-grants.sql` grants `migrator` `USAGE, CREATE` and
`app` DML + sequences + `EXECUTE` (no `CREATE`), idempotently. Root
`engines.node` → `">=22.12.0 <23"` (pg-boss requires it).

## Commit basis (uncommitted).

Suggested layering — each commit reverts independently once committed:

1. `feat(jobs): add the pg-boss outbox runtime and worker/scheduler wiring` —
   `packages/jobs-runtime/**`, the `packages/application/src/jobs/**` additive
   change, `apps/worker|scheduler`, root
   `package.json`/`tsconfig.json`/`vitest.config.ts`/`package-lock.json`.
2. `feat(persistence): provision the pgboss schema from the pre-deploy
   migrator` — `packages/persistence/scripts/migrate.mjs`,
   `infra/bootstrap/pgboss-grants.sql`, `packages/persistence/package.json`.
3. `test(jobs): add the disposable-schema pg-boss integration test` (or fold
   into 1).
4. `docs: close the jobs-runtime slice`.

## Verification.

`npm run typecheck`, `npm run lint` and `npm run format:check` clean;
`npm run build` exit 0;
`DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela npm run test`
→ **4913/4913 (357 files)**; `npm run db:migrate` → drizzle no-op plus
`pgboss schema up to date (pg-boss 42)` (dev run 1 created `pgboss`, run 2
no-op). The scratch-DB down rehearsal `DROP SCHEMA pgboss CASCADE` left
`public.job`/`public.outbox_event` and the 98 public tables intact (never
rehearsed on the dev DB). The new integration test
`packages/jobs-runtime/src/jobs-runtime.postgres.test.ts` passes 5/5 and
proves: (i) enqueue + dispatch commit atomically, with the queue job id ===
outbox event id; (ii) a rolled-back transaction leaves no outbox row, no
projection and no queue row; (iii) a real `boss.work` consumption marks the
projection `succeeded`, stamps outbox `published_at` and writes the audit;
(iv) redelivery is idempotent (the handler runs once); (v) replay re-creates
a lost queue job and is idempotent.

## Review reconciliation.

- `reviewer-qwen`: two blockers accepted and fixed — the `pgboss` GRANTs gap
  (now `infra/bootstrap/pgboss-grants.sql`) and "the runtime must never run
  DDL" (now `migrate:false, createSchema:false`).
- `reviewer-minimax`: the dedicated migrator step under the existing lock is
  the correct call over a frozen numbered migration; verified
  `DROP SCHEMA pgboss CASCADE` cannot reach `public`; the hard `DELETE`
  posture for the operational `job` table matches the `rate_limit_counter`
  (DEC-135) precedent.
- `reviewer-glm`: core P2 claims verified (the `send` with `options.db` path
  runs inline on the caller's transaction with no `BEGIN/COMMIT`; duplicate
  id → `null`; the consumer transitions match the DB guards); accepted fixes
  applied — pg-boss `error`/`warning` listeners, explicit `batchSize: 1`,
  dead-code removal, a `JobStatus`-typed settled set, and documented
  arithmetic for `retryLimit 5` vs `maxAttempts 5` and for the dead-letter
  `published_at` stamp.
- `qa-verifier`: **ACCEPT** on all ten acceptance criteria with no
  counterexamples.

## Deferred / recorded (not silently dropped).

- The 90-day `job` projection retention prune (`DEC-139` item 5) is not
  implemented.
- The `DEC-139` item-8 alert wiring (any dead-letter; oldest queued age >
  10 min; queue depth > 100; worker heartbeat missing > 2 min) is not
  implemented — the runtime exposes the pg-boss surfaces for it.
- No DLQ weekly-review runbook yet.
- No producer and no HTTP `202` job URL/progress route (nothing constructs
  `createPgBossDispatcher` outside the integration test); the producing
  process must not enqueue before the worker/scheduler has created the
  queues; partitioned queues would need migrator pre-creation because `app`
  lacks DDL.
- External publishing / `INTG-002` stays gated on the per-source write terms
  I15/I18 under `DEC-015`.

## Rollback.

Revert the commits (or `git checkout` the uncommitted tree), then
`DROP SCHEMA pgboss CASCADE` (the facts are retained in `outbox_event`).
Migration `0071_job` is unchanged and its own down file is untouched; no
posted money or stock fact is touched.
