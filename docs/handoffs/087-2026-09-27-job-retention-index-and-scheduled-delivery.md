# 087 — 2026-09-27 — Job retention index (`0072`) and honoured scheduled delivery

On branch `main`; **committed** as `94bd965` (the job retention index,
migration `0072`) + `d3602d0` (the `scheduledAt` fix) — working tree clean,
**pushed** to `origin/main` (`git@github.com:pnpaes/full-business-controller.git`),
nothing applied to DigitalOcean. Migration `0072` in the index commit; no
migration in the `scheduledAt` fix.

## What was decided and what was built.

Two recorded `DEC-139` follow-ups closed after the jobs layer went complete
(handoff `086`): the retention index obligation, and the delayed-delivery gap
the P2 core left open (`scheduledAt` persisted on the `job` projection but
ignored by the dispatcher).

### The retention index — migration `0072` (`94bd965`).

- Drizzle-generated, expand-only: `CREATE INDEX "job_org_created_at_idx" ON
"job" USING btree ("organization_id","created_at")`, so the org-scoped,
  terminal-only `JobStore.deleteExpiredJobs` prune can range-scan
  `created_at`. It previously leaned on
  `job_org_status_scheduled_idx (organization_id, status, scheduled_at)`,
  which cannot range-scan `created_at`.
- Down companion `0072_job_org_created_at_idx_down.sql` drops the index (no
  row is touched; the table and its other two indexes stay).
- Journal tag `0072_job_org_created_at_idx`, `when` `1790496122421`, up-file
  sha256 `68aa54b045bcf0663a62edd58647096eac3c4dc64ba7e394aac90455f7bb430d`.
  Runbook row recorded in `docs/runbooks/persistence-migrations.md`.
- Evidence: dev `db:migrate` applied `0072` and re-ran as a no-op; the down
  path was **rehearsed on a scratch DB** (index present → down applied →
  index absent, `job` and its other two indexes intact, scratch dropped;
  never the dev DB); a **data-backed `EXPLAIN`** on a 5500-row scratch table
  showed the prune subquery using a `Bitmap Index Scan on
  job_org_created_at_idx` (the empty dev table plans a seq scan, reported
  honestly). The stale `deleteExpiredJobs` comment claiming no `created_at`
  index was corrected.

### Honoured scheduled delivery (`d3602d0`).

- `OutboxDispatchEvent` gains an optional `scheduledAt`; `enqueueOutboxEvent`
  forwards the normalized value; `createPgBossDispatcher` passes pg-boss
  `startAfter` **only** when it is set (a past value delivers immediately, so
  the unscheduled path is unchanged).
- `replayUnpublishedOutbox` now reads the projection per replayed event (one
  bounded read, `limit`-bounded) and preserves a future `scheduledAt`,
  sending immediately when the projection is missing or unscheduled — so a
  replay cannot fire a scheduled event early.
- A now-stale `payroll-schedule.ts` comment claiming the dispatcher had no
  `startAfter` support was corrected.

## Commit basis.

`94bd965` (`feat(persistence)`, migration `0072` + schema + snapshot/journal +
runbook row + the roadmap/`CONTEXT` notes) and `d3602d0` (`fix(jobs)`, the
dispatch/replay change + tests). Each reverts independently.

## Verification.

`npm run typecheck`, `npm run lint`, `npm run format:check` clean;
`npm run build` exit 0; `DATABASE_URL=… npm run test` → **4995/4995 (362
files)**; `npm run db:migrate` a no-op. The pg-boss integration suite gained a
claim asserting the queued `job.start_after` equals the event's `scheduledAt`;
the dispatcher and maintenance suites cover the set/unscheduled and
replay-preserves-schedule paths.

## Deferred / recorded.

- The **system-wide** prune (the index landed; the prune remains org-scoped
  for the single-tenant deployment) is the one open `DEC-139` follow-up,
  alongside a DB-backed worker heartbeat (if cross-process detection is ever
  wanted) and DLQ review automation.
- `DEC-104` items 5/9/10 remain open; the lead-window payroll report stays
  provisional; `JOBS_READ_ROLES` remains provisional (`DEC-101`); the
  Terraform HCL is unvalidated until CI has the binary.
- External publishing (`INTG-002`) stays gated on the per-source write terms
  I15/I18 under `DEC-015`.

## Rollback.

Migration `0072`: run the down file (`DROP INDEX job_org_created_at_idx`) — no
row or posted fact is touched; the prune reverts to the status index. The
`scheduled` fix: `git revert d3602d0` (additive; unscheduled events keep the
immediate path and the queue is rebuildable from unpublished outbox rows).
