# ADR-0004 — Background job technology and outbox implementation

- **Status:** Accepted (2026-09-26)
- Accepted 2026-09-26 by the owner/tech lead in-session; the acceptance is revertible. The
  runner is pg-boss pinned `12.33.2` per `DEC-062` (this ADR's original Graphile-Worker
  proposal is superseded) and the delivery shape is **P2**: the transactional `outbox_event`
  table stays the durable source of truth with `outbox_event.id` as the dedup key, the
  runner's queue is disposable and the runner is swappable by replaying unpublished outbox
  rows. The package is recorded as `DEC-139`.
- **Date:** 2026-09-13
- **Deciders:** TECH
- **Related:** `02:85`, `06:45-62,99-101`; OPS-001, OPS-002, DQ-001
- **Requirements:** OPS-001, OPS-002, OPS-004, SALE-001

## Context

Imports, summaries, forecasts and alerts run asynchronously; external calls must not sit inside
record-locking transactions; consumers must be idempotent and failures visible with retry/DLQ
(`02:85`, `06:101`). Keeping a separate broker adds ops surface a two-location café does not need.

## Decision

Use a **PostgreSQL-backed durable job queue** — **pg-boss pinned `12.33.2`** (`DEC-062`; the
earlier Graphile-Worker proposal in this ADR is superseded) — and a **transactional outbox** table
written in the same transaction as the business change. Delivery shape is **P2**: the
`outbox_event` table stays the durable source of truth and consumers deduplicate on
`outbox_event.id`, and the runner's queue is disposable — the runner stays swappable by replaying
unpublished outbox rows. Delivery is **at-least-once** with **application-level idempotency
required in addition** (`OPS-002`); retries use exponential backoff with a maximum-attempt limit
and a dead-letter status; job age and failure are exposed to monitoring (`07:102`).

## Alternatives considered

- Redis/BullMQ — fast, but a second stateful service to operate/back up.
- Managed cloud queue (SQS/Cloud Tasks) — durable, but splits transactionality and adds vendor coupling.
- `pg_cron` + ad-hoc polling — insufficient reliability/observability.

## Consequences

- One datastore for facts, outbox and jobs → atomic enqueue with the business change (`02:85`).
- Worker connections must be pooled carefully to avoid starving transactional load.
- Import/posting commands remain idempotent at the application layer too (OPS-002), not only the queue.

## Open items

- ~~Choose Graphile Worker vs pg-boss and pin versions~~ resolved 2026-09-26: pg-boss pinned
  `12.33.2` (`DEC-062`; acceptance package `DEC-139`).
- ~~Define job retention, DLQ review runbook and alert thresholds (OPS-004)~~ resolved
  2026-09-26 (`DEC-139`): dead-letters kept 30 days and reviewed weekly; alerts on any
  dead-letter, on the oldest queued job age > 10 minutes, on queue depth > 100 and on a worker
  heartbeat missing > 2 minutes; the `job` table is the application-facing projection for the
  `202` job URL/progress (not the runner queue) with 90-day retention.
- **`pgboss` schema ownership/privileges recorded (`DEC-139`):** the pre-deploy `migrator`
  (DDL) creates/migrates the `pgboss` schema; the runtime `app` role gets DML only; the down
  path is `DROP SCHEMA pgboss CASCADE` (facts retained in `outbox_event`).
- Still open: the exact conversion of the `scheduler` component (pg-boss cron today) to a real
  scheduled job when the DO provider (or pg-boss's own scheduler) exposes `SCHEDULED` — see the
  ADR-0012 Open items.
