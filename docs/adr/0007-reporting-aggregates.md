# ADR-0007 — Reporting aggregate strategy

- **Status:** Proposed (needs tech-lead acceptance)
- This ADR is a proposal; implementation must not rely on it until status is `Accepted`.
- **Date:** 2026-09-13
- **Deciders:** TECH, FIN
- **Related:** `02:71`, `07:73`; RPT-001..005, FND-006
- **Requirements:** RPT-001, RPT-002, RPT-003, RPT-004, RPT-005, FND-006

## Context

Dashboards must refresh within 15 minutes of posting, drill to canonical facts, show freshness, and
answer as-of queries without stressing the transactional tables (`07:73`). `02:71` says reporting
aggregates are disposable and rebuildable from canonical records.

## Decision

Materialize reporting data in **PostgreSQL**: purpose-built aggregate tables and/or materialized
views, refreshed by idempotent jobs within the 15-minute freshness target, each exposing `as_of` and
scope (FND-006). Canonical facts remain the source of truth; aggregates are **disposable and
rebuildable** at any time. No separate warehouse/BI stack in the MVP. Every metric carries a
drill-down path to the records and calculation snapshot that produced it (RPT-002).

## Alternatives considered

- Query canonical tables directly — simplest, but risks NFR breaches on large histories.
- Separate analytics warehouse/BI tool — over-engineered for café scale today.

## Consequences

- Aggregates need rebuild tooling and freshness monitoring; staleness is visible, not hidden.
- Metric definitions live once in application/domain code (`02:59`), materialized — not
  reimplemented in dashboard SQL.
- Adding a warehouse later is a non-breaking extension.

## Open items

- Choose materialized views vs incremental aggregate tables per metric group.
- Define the 15-minute refresh schedule and alerting on stale aggregates.
