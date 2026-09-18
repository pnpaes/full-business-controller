# ADR-0005 — Stock valuation and theoretical sale-consumption policy

- **Status:** Proposed (needs finance acceptance)
- This ADR is a proposal; implementation must not rely on it until status is `Accepted`.
- Sub-decisions **DEC-009** (theoretical consumption) and **DEC-010** (negative stock) are **accepted** as of 2026-09-14; the ADR's own acceptance is separate.
- **Date:** 2026-09-13
- **Deciders:** FIN, OPS, ACC
- **Related:** DEC-008, DEC-009, DEC-021, DEC-028, DEC-034, DEC-035; `04:136-153`, `02:81`, `05:53`
- **Requirements:** INV-001, INV-003, PROD-002, WASTE-002, COST-008

## Context

Valuation and theoretical-consumption postings determine the whole inventory ledger's behaviour.
`04:138` recommends moving weighted average; `04:150-153` leaves three consumption policies open;
`02:81`/`05:53` assume consumption movements are posted. Reversal semantics (`04:145`) conflict with
a moving average unless a revaluation rule exists.

## Decision

- **Valuation:** moving weighted average per item/location; outbound movements retain the average at
  posting time; lots preserved for traceability. Standard recipe cost is a **separate** measure
  (DEC-021) and is never used to value stock.
- **Theoretical consumption:** **post daily per location** (not per sale), with double-use prevention
  between production and sales (**DEC-009, accepted 2026-09-14**).
  `[If comparison-only were later chosen, `02:81` and `05:53` would be corrected.]`
- **Reversal:** restore quantity/value at the original movement value; reversals never restate
  downstream movements; post an explicit **revaluation correction** for any moving-average gap.
  Automatic reversal is blocked when reconciled downstream sales depend on the original, requiring an
  explicit approved correction with a reason (DEC-028).
- **Concurrency:** postings that change an item's cost (receipt, production output, count adjustment)
  serialize per `(organization_id, item_id, location_id)` using `SELECT … FOR UPDATE` on the
  `stock_balance` row with bounded retry; reads stay non-locking (DEC-034).
- **Partial posting and reconciliation:** reconciliation compares the source total to
  `posted + approved dispositions`; the tolerance (`DEC-026`) applies to the residual after
  dispositions, and an import cannot close while a non-posted row lacks an approved disposition
  (DEC-035).
- **Negative stock:** postings that would drive stock negative are blocked; a restricted emergency
  override (manager permission + mandatory reason) is allowed, raises a high-priority exception and
  requires later revaluation (**DEC-010, accepted 2026-09-14**).

## Alternatives considered

- FIFO/lot cost — more precise for expiry, more bookkeeping; keep lot traceability without FIFO.
- Standard cost valuation — hides real purchase variance; rejected for operational stock.
- Per-sale consumption posting — highest fidelity, highest write volume and double-count risk.

## Consequences

- Ledger invariants (`09:31-38`) become testable: balance = Σ movements; posted movements immutable.
- Daily consumption posting is a bulk job; must be idempotent and re-runnable.
- Revaluation movements are first-class and auditable, not implicit adjustments.

## Open items

- ACC confirms statutory export treatment (DEC-008).

DEC-009 (theoretical consumption posting) and DEC-010 (negative stock) are accepted as of
2026-09-14 and are no longer open; this ADR's own acceptance remains separate (status `Proposed`).
