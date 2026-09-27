# 086 — 2026-09-27 — Jobs: the real HTTP 202 producer + the 90-day retention and DEC-139 alerts (the jobs layer complete)

On branch `main`; the work was authored as uncommitted changes and is now
**committed** as `ba27b79` (the HTTP 202 producer) + `054355f` (the 90-day
retention prune + the alert surfaces) — working tree clean, nothing pushed,
nothing applied to DigitalOcean. No migration in either epic.

## What was decided and what was built.

`DEC-139` is now **fully delivered**: the two gaps open after handoff 085 —
a real HTTP `202` producer callable from the web runtime, and the item-8
alert surfaces together with the 90-day `job` retention — close the jobs
layer. No migration: the prune is org-scoped on the existing
`job_org_status_scheduled_idx` (single-tenant deployment), and the
`pgboss`/`job` tables are disposable operational state.

### Epic A — the real HTTP 202 producer (`ba27b79`).

- New `packages/jobs-runtime/src/producer.ts` (+ tests):
  `enqueueJobWithDispatch(boss, db, input)` performs the canonical atomic
  enqueue — one Drizzle transaction writing the outbox row, the durable
  `job` projection, the pg-boss send (`fromDrizzle`) and the audit fact.
  `payroll-schedule.ts`'s enqueue now delegates to it, so the cron path
  and the HTTP path share one enqueue implementation.
- New `apps/web/lib/jobs.ts`: a `globalThis`-cached `PgBoss` for the web
  process (`schema:"pgboss"`, `migrate:false`, `createSchema:false`,
  `useListenNotify:false`) started lazily with a persisted-once start
  promise and error/warning logging, plus an idempotent per-queue ensure
  so the web process does not depend on worker/scheduler boot order.
- `POST /api/v1/workforce/payroll-reports` now accepts `?async=true` →
  `202` + `Location: /api/v1/jobs/<jobId>` + `{ok, jobId, jobUrl}`; the
  default path stays synchronous `200`; an invalid `?async` value is
  `400`. The same limiter, same-origin check, session/access gate, body
  parser and `DomainError` mapping apply in both modes.
- Plumbing: `@aquarela/jobs-runtime` added to the `apps/web` dependencies
  and to `next.config.mjs` `transpilePackages`; `pg-boss` added to
  `serverExternalPackages`.

### Epic B — the 90-day retention prune + the DEC-139 item-8 alerts (`054355f`).

- `JobStore.deleteExpiredJobs({organizationId, olderThan, limit})` deletes
  **terminal-only** rows (`succeeded`/`failed`/`dead_lettered`),
  org-scoped and batched. The maintenance cron prunes after the outbox
  replay (`retentionDays` 90, `retentionLimit` 1000).
- The prune deliberately preserves the divergence case: `pending`/`running`
  rows are never terminal, so `JobStore.countStuckJobs` + the handler
  alert `jobs.stuck_pending` surface them (rows older than
  `stuckAfterMinutes`, default 60).
- New `MONITOR_QUEUE` cron (`registerMonitor`, `MONITOR_CRON` default
  `*/5 * * * *`, `missed:"once"`) evaluates and logs structured alerts:
  `jobs.dead_letter` (any), `jobs.queue_depth` (summed `readyCount` >
  100), `jobs.oldest_queued_age` (oldest `state:"created"` queued job >
  600 s; retry/backoff jobs excluded; the scan is skipped above 1000
  depth), plus an `info` heartbeat as the monitor's own liveness trace —
  an exhausted monitor cron ends `failed` in its own queue with no
  dead-letter, so log monitoring must alert on the heartbeat's **absence**.
- The worker heartbeat log was raised from `debug` to `info` so DO
  Monitoring can alert on its absence > 120 s. pg-boss 12 keeps WIP in
  memory (no `wip` table), so cross-process heartbeat detection cannot be
  in-app.

## Commit basis.

Two commits, each independently revertible:

1. `ba27b79` — `feat(jobs,web): add the HTTP 202 producer for async
   payroll generation` — `packages/jobs-runtime/src/producer.ts` (+ tests)
   and the `payroll-schedule.ts` delegation, `apps/web/lib/jobs.ts`, the
   payroll-reports route, `apps/web` `package.json` and
   `next.config.mjs`.
2. `054355f` — `feat(jobs): add the 90-day job retention prune and the
   DEC-139 alert surfaces` — `JobStore.deleteExpiredJobs` +
   `JobStore.countStuckJobs` (+ boundary tests), the maintenance-cron
   prune, `registerMonitor` (`MONITOR_QUEUE`/`MONITOR_CRON`) and the
   worker heartbeat level.

## Verification.

`npm run typecheck`, `npm run lint` and `npm run format:check` clean;
`next build` exit 0; `npm run db:migrate` a no-op (no migration in either
epic); `npm run test` → **4991/4991 (362 files)**, including the boundary
tests added during the review (retention edge/batching and the monitor
alert thresholds).

## Review reconciliation.

A `reviewer-glm` pass found **no blockers**; one **major** and five minors,
all addressed:

- **Major (fixed):** the prune's comment overclaimed that the monitor
  surfaces stuck rows — fixed properly by adding the `jobs.stuck_pending`
  check rather than rewording the comment.
- Minors (fixed): `jobs.oldest_queued_age` excludes retry/backoff-state
  jobs; `jobs.queue_depth` sums `readyCount`; the unused
  `deadLetterQueue` option dropped; boundary tests added; the monitor's
  self-liveness (heartbeat-absence alerting) documented.

## Deferred / recorded (not silently dropped).

- The prune is **org-scoped** (single-tenant deployment). A system-wide
  prune plus an `(organization_id, created_at)` index is the recorded
  follow-up if multi-tenant scale is ever needed.
- Cross-process heartbeat detection is a **log-monitoring contract** (DO
  Monitoring alerts on absence), not application code — with pg-boss 12
  keeping WIP in memory, no `wip` table exists to query in-app.
- The jobs access set remains provisional per `DEC-101`; `DEC-104` items
  5/9/10 (may an `exported` report be superseded?) remain open.

## Rollback.

Each commit reverts independently — `git revert ba27b79` and
`git revert 054355f` (either order, independently revertible). **No
migration**: nothing is posted in money or stock facts; the slice only
enqueues jobs, prunes terminal `job` rows and emits log alerts, and the
`pgboss`/`job` tables are disposable operational state (the facts live in
`public.outbox_event`).
