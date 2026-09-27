# 088 — 2026-09-27 — Jobs operator tooling: DLQ review automation + the DB-backed worker heartbeat

On branch `main`; **committed** as `918b80a` (DLQ review automation +
operator job list) + `d070983` (the DB-backed worker heartbeat, migration
`0073`) — working tree clean, **pushed** to `origin/main`, nothing applied
to DigitalOcean. Migration `0073` in the heartbeat commit.

## What was decided and what was built.

Two more recorded `DEC-139` follow-ups, both decided in-session: the
dead-letter review is now automated behind the API, and the worker heartbeat
became a DB signal the monitor can read cross-process (the runbook's manual
log-only posture was the fallback).

### DLQ review automation + operator listing (`918b80a`) — no migration.

- Persistence: `resetDeadLetteredJob` (`dead_lettered` → `pending`, resetting
  attempts/error/started/finished) and `discardDeadLetteredJob`
  (`dead_lettered` → terminal `failed`) — both org-scoped and guarded so a
  non-dead-lettered row cannot transition; `findOutboxEventById` and
  `clearOutboxDeadLetter` (clears `dead_lettered_at` **and** `published_at`,
  so the event is replayable) on the outbox repository.
- Application: `retryDeadLetteredJob` / `discardDeadLetteredJob` commands
  with audit facts `jobs.job.retried` / `jobs.job.discarded`.
- Web: `GET /api/v1/jobs` (status/limit/offset, `payload`/`error` omitted;
  `JOBS_READ_ROLES` = owner/general_manager/finance/admin) and
  `POST /api/v1/jobs/[id]/retry` + `/discard` (`JOBS_ADMIN_ROLES` =
  owner/general_manager/admin; finance excluded), all with the same-origin
  guard, a limiter, UUID validation, org-scoped 404 and `DomainError`
  mapping. Retry re-dispatches via the web boss using the routing payload
  read from the outbox row; the maintenance replay is the safety net.
- **Correctness catch:** the runbook's premise that `dead_lettered_at`
  prevents replay was wrong — the replay selects `published_at IS NULL`, so
  discard additionally stamps the outbox row published, making a discard
  stick. Recorded as a deliberate deviation and reflected in the runbook.

### DB-backed worker heartbeat (`d070983`) — migration `0073`.

- New operational table `worker_heartbeat` (`worker_id` text PK, `role`
  CHECK `worker`/`scheduler`, `last_seen_at`, `created_at`/`updated_at`);
  deliberately **not** org-scoped (infrastructure liveness, the
  `rate_limit_counter` shape). `EXPECTED_TABLES` is now 99.
- `startHeartbeat` writes one beat immediately and every 30 s from the
  worker (`role: "worker"`) and scheduler (`role: "scheduler"`); identity
  `<role>:<hostname>:<pid>` or `WORKER_HEARTBEAT_ID`; errors are logged and
  swallowed (a heartbeat failure must not kill the process); the timer is
  cleared on shutdown.
- The monitor's fifth check alerts `jobs.worker_heartbeat_missing` when the
  newest `worker` beat is older than `WORKER_HEARTBEAT_ALERT_SECONDS`
  (120 s) — the in-app cross-process signal. The platform log alert on the
  absent `info "worker heartbeat"` line remains secondary.
- Down companion `0073_worker_heartbeat_down.sql` drops the table (liveness
  state only).

## Commit basis.

`918b80a` (`feat(jobs,web)`, persistence + application + routes + tests) and
`d070983` (`feat(jobs)`, schema + migration `0073` + repository + heartbeat
writer + monitor check + tests). Each reverts independently.

## Verification.

`npm run typecheck`, `npm run lint`, `npm run format:check` clean;
`npm run build` exit 0; `DATABASE_URL=… npm run test` → **5075/5075 (368
files)**; `npm run db:migrate` applied `0073` and is a no-op on re-run; the
`0073` down path was rehearsed on a scratch DB (table present → down → table
absent, scratch dropped; never the dev DB). Route tests cover the list shape
(no `payload`/`error`), retry/discard 200/400/403/404 and the access split.

## Deferred / recorded.

- The **system-wide** prune remains (org-scoped covers this single-tenant
  deployment); the retention index landed in `0072`.
- `DEC-104` items 5/9/10 remain open; the lead-window payroll report stays
  provisional; `JOBS_READ_ROLES`/`JOBS_ADMIN_ROLES` remain provisional
  (`DEC-101`); the Terraform HCL is unvalidated until CI has the binary.
- INTG-002 publishing stays gated on the per-source write terms I15/I18 under
  `DEC-015`.

## Rollback.

`0073`: run the down file (`DROP TABLE worker_heartbeat` — liveness state
only); the DLQ routes: `git revert 918b80a` (additive; retry/replay are
id-deduped); the heartbeat commit: `git revert d070983`. No business row and
no posted money or stock fact is touched.
