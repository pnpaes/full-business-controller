# ADR-0004 — Background job technology and outbox implementation

- **Status:** Proposed (needs tech-lead acceptance)
- This ADR is a proposal; implementation must not rely on it until status is `Accepted`.
- **Date:** 2026-09-13
- **Deciders:** TECH
- **Related:** `02:85`, `06:45-62,99-101`; OPS-001, OPS-002, DQ-001
- **Requirements:** OPS-001, OPS-002, OPS-004, SALE-001

## Context

Imports, summaries, forecasts and alerts run asynchronously; external calls must not sit inside
record-locking transactions; consumers must be idempotent and failures visible with retry/DLQ
(`02:85`, `06:101`). Keeping a separate broker adds ops surface a two-location café does not need.

## Decision

Use a **PostgreSQL-backed durable job queue** (proposed: **Graphile Worker**, alternative **pg-boss**)
and a **transactional outbox** table written in the same transaction as the business change.
Consumers deduplicate on `outbox_event.id`; retries use exponential backoff with a maximum-attempt
and dead-letter status; job age and failure are exposed to monitoring (`07:102`).

## Alternatives considered

- Redis/BullMQ — fast, but a second stateful service to operate/back up.
- Managed cloud queue (SQS/Cloud Tasks) — durable, but splits transactionality and adds vendor coupling.
- `pg_cron` + ad-hoc polling — insufficient reliability/observability.

## Consequences

- One datastore for facts, outbox and jobs → atomic enqueue with the business change (`02:85`).
- Worker connections must be pooled carefully to avoid starving transactional load.
- Import/posting commands remain idempotent at the application layer too (OPS-002), not only the queue.

## Open items

- Choose Graphile Worker vs pg-boss and pin versions.
- Define job retention, DLQ review runbook and alert thresholds (OPS-004).
