# ADR-0008 — Integration ownership and system-of-record boundaries

- **Status:** Accepted (2026-09-20)
- Accepted 2026-09-20 (owner-delegated in-session; revertible). The open items below (per-integration ownership records, POS/Wolt API availability, allowed-operations approval) remain recorded inputs.
- **Date:** 2026-09-13
- **Deciders:** BUS, TECH, FIN
- **Related:** DEC-001, DEC-002, DEC-015, DEC-016; ADR-0011; `06:79-97`
- **Requirements:** SALE-001..003, PROC-002/004, REC-001/002, SEC-003

## Context

POS, Wolt, Medusa, Vipps/Stripe, suppliers, Fiken and payroll can each claim ownership of the same
field. An earlier version of this package defaulted to read-only ingestion and no MVP external writes
(`06:97`). DEC-015 (2026-09-14) changes that default: external writes are permitted when governed per
source and per operation, and the ownership question is now per field **and per operation**, not a
single read-only posture. This ADR records who owns which field and who operates each connector; the
publishing design itself is ADR-0011.

## Decision

- **Internal system owns** approved cost, recipe, standard-cost and price decisions; approved
  snapshots are authoritative (`DEC-002`).
- **External systems own** raw sales facts (POS/Wolt/Medusa) and payment settlements
  (Vipps/Stripe); the internal system stores imported facts with provenance and never rewrites the
  source.
- **Ownership is per field and per operation.** Read-only ingestion is no longer the universal
  default (DEC-015). Internal remains the system of record for approved costs/prices (`DEC-002`); an
  external system may own a field for reading while an approved operation publishes that field back.
- **Allowed-operations registry per integration.** Each source declares exactly which operations are
  permitted (read; write price; write menu/product; write stock; write accounting) together with a
  **named credentials owner**; nothing outside the registry is permitted and no write is enabled until
  explicitly approved per operation.
- **Writes are push-only from approved internal changes.** Publishing is one-way, from an approved
  internal entity/version to the external system, as idempotent jobs with confirmation read-back,
  audit, rollback and failure alerts (ADR-0011). There is no bidirectional sync.
- For **each integration**, a Phase-0 record captures source owner, data owner, credentials owner,
  allowed operations, rate limits, source IDs, timezone/currency/tax meaning, retry policy,
  reconciliation method, retention and failure contact (`06:93-95`).
- **Read-only until approved.** A source with no approved write operation stays read-only; approval is
  per operation and can be withheld or withdrawn.

## Alternatives considered

- **Read-only ingestion only (previous default)** — superseded by DEC-015: the owner wants approved
  changes published to POS/Medusa/Sanity (later Wolt/Fiken), and governed writes are now in scope
  (ADR-0011).
- Bidirectional sync with POS/Wolt in MVP — rejected: conflict resolution, rollback and vendor terms
  are unproven; would expand scope beyond MVP (`01:65`).
- Per-connector bespoke ownership — rejected: inconsistent reconciliation.

## Consequences

- Field-level ownership is explicit; conflicts at import time route to a review queue, not silent
  overwrite.
- Writes carry the added cost of idempotency, confirmation read-back, rollback and failure alerting
  (ADR-0011), and a new write connector still requires an approved publishing design and rollback.
- Integration credentials live in the managed secret store, never in config rows (`07:45`), with a
  named owner per integration.
- External changes made independently of a publish can diverge; conflict detection and rollback must
  be designed before a write operation is enabled (ADR-0011).

## Open items

- Complete the per-integration ownership records in Phase 0 (I1, I2, I10, I14, I15).
- Confirm POS/Wolt API availability and terms (DEC-001, DEC-015).
- Approve the allowed operations per source and name the credentials owner for each (ADR-0011).
