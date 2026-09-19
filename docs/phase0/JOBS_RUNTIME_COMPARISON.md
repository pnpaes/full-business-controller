# Jobs runtime comparison — decision input for ADR-0004

- **Status:** decision input / brief — **not a decision**. `ADR-0004` stays `Proposed`.
- **Date:** 2026-09-19
- **Author:** build session (read-only research; one new file)
- **Question:** which background-jobs runtime should the `worker` / `scheduler`
  components use, given the transactional `outbox_event` table already in the schema?
- **Gates:** `ADR-0004` acceptance and the deployment apply
  (`docs/BUILD_ROADMAP.md:128-130`, `CONTEXT.md:224-232`).
- **Authority:** `docs/adr/0004-jobs-and-outbox.md` is the decision; this file only
  assembles evidence and states a recommendation the owner can accept or reject.

## 1. What is already fixed (constraints, with evidence)

| # | Constraint | Evidence |
| --- | --- | --- |
| C1 | Durable PostgreSQL-backed queue + transactional outbox written in the same transaction as the business change | `docs/adr/0004-jobs-and-outbox.md:18-21` |
| C2 | Consumers deduplicate on `outbox_event.id`; at-least-once, idempotent consumers | `docs/adr/0004-jobs-and-outbox.md:20`; `06_API_INTEGRATIONS.md:62` |
| C3 | Retries use exponential backoff with a max-attempt and a dead-letter status; failures visible with recovery controls | `docs/adr/0004-jobs-and-outbox.md:20-21`; `06_API_INTEGRATIONS.md:210` |
| C4 | Job age / queue age and failed or stale background jobs are monitored; imports and reports run async with progress | `07_SECURITY_AND_NFR.md:131`; `11_REQUIREMENTS_CATALOG.md:156-159` (OPS-001/OPS-002/OPS-004) |
| C5 | Async commands return `202` with a job URL; long-running imports/exports are job resources | `06_API_INTEGRATIONS.md:43`; `06_API_INTEGRATIONS.md:5` |
| C6 | External writes run as an idempotent publish job with confirmation read-back, audit, rollback and failure alerts | `12_OPEN_DECISIONS.md:37` (DEC-015); `07_SECURITY_AND_NFR.md:198-211` |
| C7 | Scheduled jobs exist (daily/month close, payroll-input report, forecasts, AI advisories) with cost/rate limits and a kill switch | `12_OPEN_DECISIONS.md:69` (DEC-039) |
| C8 | `scheduler` is scaffolded as a long-lived App Platform **worker** + internal tick loop because Terraform provider v2.101.1 exposes no `SCHEDULED` job kind; conversion to a real scheduled job (or a runner with its own scheduler) is the recorded trigger | `apps/scheduler/src/main.ts:4-6`; `docs/adr/0012-deployment-topology-and-service-runtimes.md:34,38-43,151-156` |
| C9 | `worker` is an App Platform **worker** component: "Postgres-backed job queue + outbox consumers" | `docs/adr/0012-deployment-topology-and-service-runtimes.md:33` |
| C10 | Worker connections must be pooled carefully to avoid starving transactional load | `docs/adr/0004-jobs-and-outbox.md:32` |
| C11 | Node 22 (`>=22 <23`); the image deliberately ships devDependencies and runs TS via `tsx` | `package.json:6-8`; `apps/worker/package.json:9-13`; `docs/adr/0012-deployment-topology-and-service-runtimes.md:145-150` |
| C12 | Least-privilege DB roles: `migrator` (DDL) and `app` (runtime), bootstrapped by `infra/bootstrap/database-grants.sql` as `doadmin` before first deploy | `CONTEXT.md:234-237`; `docs/adr/0012-deployment-topology-and-service-runtimes.md:86-97` |
| C13 | Reversibility: expand → migrate → contract; documented rollback; append-only financial facts | `AGENTS.md` Rule 2; `CONTEXT.md:316-323` |
| C14 | `drizzle-orm` is pinned `0.38.4` (runtime dep) and must be upgraded to `>=0.45.2` before production (DEC-049) | `CONTEXT.md:181-184,238-240` |

## 2. The outbox as it exists today

`outbox_event` (Drizzle `packages/persistence/src/schema/platform.ts:7-27`; raw DDL
`schemas/phase1_2_draft.sql:830-842`):

`id, organization_id, event_type, event_version, aggregate_type, aggregate_id,
payload jsonb, occurred_at, published_at, attempts, dead_lettered_at`, plus the
partial index `outbox_unpublished_idx on outbox_event(occurred_at) where published_at is null`
(`platform.ts:23-25`; `schemas/phase1_2_draft.sql:873`).

Facts that shape the choice:

- The table is already **purpose-built as a poll source**: a partial index over
  unpublished rows, `attempts` and `dead_lettered_at` for retry/DLQ bookkeeping.
- It has **no scheduling, locking or backoff columns**: no `next_attempt_at`,
  no `locked_at` / `locked_by`, no `last_error`, and no priority/queue/kind.
- The partial index does **not** exclude dead-lettered rows, and orders only by
  `occurred_at`; a hand-rolled poller would need both a predicate and an index
  change for correct backoff and DLQ behaviour.
- A separate application-level `job` table is **planned but deferred**:
  `job | id, organization_id, queue, kind, payload jsonb, status, attempts,
  max_attempts, scheduled_at, started_at, finished_at, error, idempotency_key`
  (`docs/phase0/DATA_DICTIONARY.md:746`; deferred to the platform slice per
  `schemas/phase1_2_draft.sql:25`). The API job URL and progress (C5) need this
  row regardless of which runner executes the work.

## 3. Two integration shapes (decide this first)

- **P1 — outbox *is* the queue.** A poller selects unpublished `outbox_event`
  rows, executes the handler, then sets `published_at` (success) or increments
  `attempts` / sets `dead_lettered_at` (failure). One table, no runner schema.
- **P2 — outbox is the *source*, a runner's queue is the dispatch.** The domain
  transaction writes the `outbox_event` row **and** enqueues a job carrying
  `outbox_event.id`; the runner executes the handler, which reads the outbox row
  and marks it published. The runner's queue tables are disposable.

P2 is the shape that preserves C2 (dedup on `outbox_event.id`) and makes the
runner **swappable by replay**: stop the runner, replay unpublished rows into the
new one. This is the reversibility lever, so the recommendation below assumes P2.

## 4. Options

### 4.1 Graphile Worker (`graphile-worker@0.18.0`, MIT)

- **Transactional enqueue:** the documented in-transaction path is the SQL
  function `graphile_worker.add_job(...)` (`website/docs/sql-add-job.md`); the JS
  `addJob` "simply defers to this underlying `add_job` SQL function"
  (`website/docs/library/add-job.md`), and `WorkerUtils` takes a
  `connectionString`/`pgPool` but documents no per-call transaction client
  (`website/docs/library/queue.md`). So P2 enqueue is
  `tx.execute(sql\`select graphile_worker.add_job(...)\`)` from the domain
  transaction. **`add_job` requires database owner privileges**; the docs
  recommend wrapping it in a `SECURITY DEFINER` function for lower-privileged
  users (`sql-add-job.md`) — extra migration + grant work against the
  least-privilege `app` role (C12).
- **Scheduling:** built-in crontab (file or config), ACID-safe across multiple
  workers via `known_crontabs`, optional backfill; **UTC only**, no runtime
  `schedule()` API and no RRULE (`website/docs/cron.md`). Month-end ("3 days
  before month-end") and Europe/Oslo DST are awkward.
- **Retries/DLQ:** failure retries with exponential backoff; `max_attempts`
  (default 25); jobs stuck after a hard kill stay locked ~4 h then are swept
  (`website/docs/error-handling.md`). No first-class DLQ + redrive.
- **Schema:** auto-installs its own `graphile_worker` schema (worker installs it;
  `--schema-only` / `WorkerUtils.migrate()` needed before enqueue —
  `website/docs/library/queue.md`).
- **Footprint/supply chain:** 9 direct deps incl. `yargs`, `cosmiconfig`,
  `json5`, `graphile-config`, `@graphile/logger`; crowd-funded project
  (`README.md`); engines `node >=22.18.0`; latest publish 2026-09-08 (npm).

### 4.2 pg-boss (`pg-boss@12.33.2`, MIT)

- **Transactional enqueue:** first-party, documented Drizzle adapter —
  `boss.send('order-processing', data, { db: fromDrizzle(tx, sql) })` inside
  `db.transaction(...)`, with explicit rollback semantics
  (`docs/api/adapters.md`). This is the cleanest fit for C1/C2 on our exact
  stack and avoids the owner-privilege problem Graphile Worker has.
- **Scheduling:** runtime `schedule(name, cron|RRULE, data, { tz, key, missed })`;
  cron **and** RRULE (last-Friday, etc.), time zones, 30 s evaluation, and a
  `missed: skip|once` catch-up policy for outages
  (`docs/api/scheduling.md`). Directly covers C7/C8 and can retire the tick-loop
  workaround by running `scheduler` (or `worker`) with scheduling enabled.
- **Retries/DLQ:** "dead letter queues with redrive, automatic retries with
  exponential backoff", priority queues, retention policies, queue storage
  policies (`README.md`).
- **Observability:** job states + inspection APIs, plus a bundled
  `@pg-boss/dashboard` package (`README.md`); helps C4 without custom code.
- **Schema:** auto-creates a `pgboss` schema, **requires `CREATE` privilege**, or
  can be managed by its CLI (`--dry-run`/`plans`) for DBAs
  (`docs/install.md`); uninstall is `DROP SCHEMA pgboss CASCADE`.
- **Footprint/supply chain:** 4 direct deps (`pg`, `cron-parser`,
  `rrule-temporal`, `serialize-error`); **maintained by one person** on
  sponsorship (`README.md`); engines `node >=22.12.0`, PostgreSQL ≥13; latest
  publish 2026-09-18 (npm).
- **Caveat:** the README markets "exactly-once job delivery". Treat that as
  at-least-once with dedup — C2 still requires idempotent consumers keyed on
  `outbox_event.id`.

### 4.3 Hand-rolled outbox poller

- **Transactional enqueue:** native — insert into `outbox_event` in the domain
  transaction; nothing else to enqueue. Strongest C1.
- **Scheduling:** none; you build a cron parser + a single-flight lock, or keep
  the tick loop (`apps/scheduler/src/main.ts:31-39`).
- **Retries/DLQ:** `attempts` + `dead_lettered_at` exist, but there is no
  `next_attempt_at`, no `locked_at`/`locked_by`, no `last_error`, no redrive, and
  the partial index neither excludes dead-lettered rows nor orders by backoff
  (`platform.ts:23-25`). A correct poller needs an additive migration and a new
  index, then `SELECT ... FOR UPDATE SKIP LOCKED` or an advisory lock for
  multi-instance safety.
- **Observability:** you build queue-age/failure metrics and the DLQ review flow.
- **Schema/migration:** one schema, fully in the Drizzle ledger — best C13.
- **Footprint/supply chain:** zero new deps; all code and all bugs owned here.
  Highest risk of re-introducing the exact OPS-001/OPS-002 failure class.

### 4.4 Comparison

| Constraint | Graphile Worker | pg-boss | Hand-rolled |
| --- | --- | --- | --- |
| Transactional enqueue (C1) | SQL `add_job`, needs owner privilege / `SECURITY DEFINER` | first-party Drizzle adapter `fromDrizzle(tx, sql)` | native |
| Outbox relationship (C2, P2) | job payload = `outbox_event.id` | job payload = `outbox_event.id` | P1 (outbox is the queue) |
| Cron / `scheduler` (C7, C8) | file crontab, UTC, no RRULE, no runtime API | runtime cron + RRULE + tz + missed-catch-up | build it |
| Retries / backoff / DLQ (C3) | backoff + `max_attempts`; no redrive | backoff + DLQ + redrive + retention | build it |
| Observability (C4) | job tables + events | states + inspection APIs + dashboard | build it |
| Schema/migration impact | own `graphile_worker` schema, owner grant | own `pgboss` schema, `CREATE` or CLI-managed | additive columns + index |
| Ops footprint | library + schema | library + schema (+ optional dashboard) | code + new columns |
| Node 22 / TS (C11) | `>=22.18.0`, ESM/TS docs | `>=22.12.0`, TS + Drizzle adapter | n/a |
| Supply chain | 9 direct deps, crowd-funded | 4 direct deps, one maintainer | none |
| Reversibility (C13, P2) | replay outbox into another runner | replay outbox into another runner | migrate rows into a runner |

## 5. Recommendation

**Use pg-boss as the runner and keep `outbox_event` as the durable source of
truth (shape P2), with the planned `job` table as the user-facing projection.**

Reasoning, against the constraints above:

1. **Transactional enqueue is first-class on our stack.** `fromDrizzle(tx, sql)`
   is a documented pg-boss adapter that runs `send()` inside the Drizzle
   transaction and rolls back with it (`docs/api/adapters.md`) — C1/C2 with no
   privilege wrapper. Graphile Worker's equivalent needs owner privileges or a
   `SECURITY DEFINER` function (`sql-add-job.md`), which is real extra work and
   risk under C12.
2. **It covers the scheduler without a custom tick loop.** Runtime cron + RRULE +
   timezone + missed-catch-up (`scheduling.md`) fits month-end payroll and
   Europe/Oslo DST better than Graphile Worker's boot-static, UTC-only crontab,
   and gives a concrete retirement path for the C8 workaround.
3. **It supplies the OPS-001/OPS-004 surface we would otherwise build**: DLQ with
   redrive, retention, job states, inspection APIs, dashboard (C3/C4).
4. **Smallest dependency delta of the two libraries** (4 direct deps vs 9).
5. **P2 keeps it reversible**: because the runner only dispatches and the outbox
   keeps the facts, the queue can be swapped later by replaying unpublished rows
   (C13).

Explicitly: this does **not** mean "no `job` table". The API job URL/progress
(C5) still needs the application `job` row (`DATA_DICTIONARY.md:746`) as a
projection over the runner; the runner's queue is not the user-facing job record.

## 6. Cost of each alternative

- **Graphile Worker instead:** viable, and it is the ADR's stated preference.
  Accept the owner-privilege/`SECURITY DEFINER` step for transactional enqueue,
  a UTC-only static crontab (or keep a custom scheduler loop), no DLQ redrive,
  and a larger direct dependency set.
- **Hand-rolled poller:** lowest supply chain and one schema, but you own backoff,
  cron, DLQ/redrive, multi-instance locking, queue-age observability and the
  DLQ runbook — plus a migration for `next_attempt_at`/`locked_at`/`last_error`
  and a corrected partial index. Acceptable only as a fallback if pg-boss is
  rejected on supply-chain grounds; P2 means it can be adopted later without
  changing domain writes.
- **pg-boss (recommended):** accept a `pgboss` schema whose migrations sit
  outside the Drizzle ledger and need the `migrator` grant (C12), 4 new runtime
  deps including `cron-parser`/`rrule-temporal`/`serialize-error`, and a
  one-maintainer bus factor.

## 7. Questions the owner must answer to accept this

1. **Runner:** accept pg-boss as the ADR-0004 choice, or prefer Graphile Worker
   (accepting the `SECURITY DEFINER` enqueue step), or fall back to the
   hand-rolled poller?
2. **Shape:** confirm P2 — `outbox_event` stays the durable source and dedup key,
   and the runner's queue tables are disposable/replayable?
3. **Scheduler component:** keep `scheduler` as a separate App Platform worker
   running pg-boss with scheduling enabled, or fold scheduling into `worker` and
   delete the component (cost vs isolation)? This is the ADR-0012 conversion
   trigger (`docs/adr/0012-...md:151-156`).
4. **`job` table:** confirm the application `job` row (`DATA_DICTIONARY.md:746`)
   is the API-facing projection (202 job URL, progress) and name its retention.
5. **Migrations/privileges:** who creates and migrates the `pgboss` schema — the
   pre-deploy `migrator` (needs the DDL grant) or the pg-boss CLI — and what is
   the documented down path (`DROP SCHEMA pgboss CASCADE`, with facts retained in
   `outbox_event`)?
6. **Retention/DLQ:** approve job retention windows, the DLQ review runbook and
   alert thresholds (the remaining ADR-0004 open item,
   `docs/adr/0004-jobs-and-outbox.md:38`; OPS-004).
7. **Idempotency:** confirm consumers dedup on `outbox_event.id` and that
   external publish jobs also carry `(integration_source_id, idempotency_key)`
   (`07_SECURITY_AND_NFR.md:207-208`).
8. **Versions/supply chain:** pin pg-boss `12.33.2` (or graphile-worker `0.18.0`)
   and accept the dependency delta and the one-maintainer bus factor; confirm the
   choice does not interact with the pending DEC-049 `drizzle-orm >=0.45.2`
   upgrade (`CONTEXT.md:238-240`).

## 8. Verification / formatting

`.prettierignore:9` ignores `docs/`, so
`npx prettier --check docs/phase0/JOBS_RUNTIME_COMPARISON.md` **skips this file**
(the explicit-path check reports "No files matching the pattern were found").
No repo formatting gate applies to it; no other file was modified.

## 9. Facts I could not verify (marked as assumptions)

- Bus-factor/maintainer counts are read from project README/registry metadata, not
  audited (pg-boss "maintained by one person"; Graphile Worker "crowd-funded").
- Whether pg-boss can share the application's existing `pg.Pool` (C10 pool
  discipline) rather than opening its own pool — needs a constructor-doc check
  before implementation.
- Whether `graphile_worker.add_job` can be `GRANT`ed to a non-owner role directly
  (the docs only recommend `SECURITY DEFINER`); treat the wrapper as required.
- Exact transitive dependency counts (only direct deps were inspected via npm).
- Neither library was installed or run against this repository's PostgreSQL 16 or
  its least-privilege roles; the transactional-enqueue behaviour is taken from
  the projects' own documentation.
- pg-boss's "exactly-once" claim is not independently verified; C2 assumes
  at-least-once with dedup.

## 10. Sources

Repo (file:line): `docs/adr/0004-jobs-and-outbox.md:3,18-21,32,35-38`;
`docs/adr/0012-deployment-topology-and-service-runtimes.md:33-34,38-43,86-97,145-156,161-162`;
`packages/persistence/src/schema/platform.ts:7-27`;
`schemas/phase1_2_draft.sql:25,830-842,873`;
`docs/phase0/DATA_DICTIONARY.md:745-746`;
`docs/BUILD_ROADMAP.md:128-130`;
`06_API_INTEGRATIONS.md:5,43,45-62,210`;
`07_SECURITY_AND_NFR.md:131,198-211`;
`11_REQUIREMENTS_CATALOG.md:156-159`;
`12_OPEN_DECISIONS.md:37,69`;
`apps/worker/src/main.ts:24`; `apps/scheduler/src/main.ts:4-6,31-39`;
`package.json:6-8`; `.prettierignore:9`; `CONTEXT.md:181-184,224-240,316-323`.

External (fetched 2026-09-19):
- graphile-worker registry metadata (`npm view graphile-worker`): version `0.18.0`,
  `engines.node >=22.18.0`, MIT, publish 2026-09-08.
- pg-boss registry metadata (`npm view pg-boss`): version `12.33.2`,
  `engines.node >=22.12.0`, MIT, publish 2026-09-18.
- https://raw.githubusercontent.com/graphile/worker/main/website/docs/sql-add-job.md
- https://raw.githubusercontent.com/graphile/worker/main/website/docs/library/add-job.md
- https://raw.githubusercontent.com/graphile/worker/main/website/docs/library/queue.md
- https://raw.githubusercontent.com/graphile/worker/main/website/docs/cron.md
- https://raw.githubusercontent.com/graphile/worker/main/website/docs/error-handling.md
- https://raw.githubusercontent.com/timgit/pg-boss/master/README.md
- https://raw.githubusercontent.com/timgit/pg-boss/master/docs/api/adapters.md
- https://raw.githubusercontent.com/timgit/pg-boss/master/docs/api/scheduling.md
- https://raw.githubusercontent.com/timgit/pg-boss/master/docs/install.md
