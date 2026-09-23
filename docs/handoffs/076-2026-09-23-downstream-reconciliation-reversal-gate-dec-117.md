# 2026-09-23 — Downstream-reconciliation reversal gate delivered (`DEC-117`)

`main`; HEAD before this slice's docs commit is **`be524f7`** (the `DEC-116`
docs commit). The slice lands as the `docs(decisions)`, `feat(domain)`,
`feat(persistence)`, `feat(application)` and this `docs(context)` handoff
commits (uncommitted at handoff-writing time; the orchestrator commits the
layers). No `feat(web)` layer — the existing route already maps `DomainError`
→ 400. Nothing pushed; nothing applied to DigitalOcean. Verification at the
tree (Node 22, `DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/
aquarela`): `typecheck`, `lint`, `format:check`, `build` clean; **3630/3630
tests with `DATABASE_URL` (238 files)**; `npm audit --omit=dev` = 0;
`db:migrate` a no-op on re-run through `0062`; **89 tables** (no new table,
**no migration**). The baseline before the slice was 3604/3604 (236 files);
the slice added two new test files (13 domain tests in
`packages/domain/src/reversal-gate.test.ts`, 5 Postgres sales tests in
`packages/application/src/sales/correct-sales-line.postgres.test.ts`) and 8
more tests (7 unit + 1 persistence Postgres). Next free decision id
`DEC-118`.

- **Delivered (`DEC-117`).** `DEC-028` requires that automatic reversal be
  **blocked** when reconciled downstream sales depend on the original, and
  `DEC-073` deferred that gate "until row 13 exposes period-lock state";
  `DEC-116` wired the reversal (`correctSalesLine`) and deferred the gate, so
  an operator could reverse a line inside a reconciled or locked period and
  silently break the settlement match. Implemented as a **read-only,
  no-migration gate** evaluated inside the reversal command's transaction,
  **before any write** — additive and reversible; the append-only rule holds
  (a blocked reversal writes nothing).
  - **Domain** (`feat(domain)`) — the new pure predicate
    `evaluateReversalGate` (`packages/domain/src/reversal-gate.ts`, + test,
    barrel export in `packages/domain/src/index.ts`): a reversal is blocked
    when either
    - (a) a **`locked` `period_close`** covers the parent transaction's
      `occurred_at` **date** for the `location` scope (the transaction's
      `location_id`, that day) or the `company` scope (the organization id,
      that day — the month close covers it), the `DEC-027` "after lock, no
      direct mutation" rule; or
    - (b) a **`reconciliation`** row whose `[period_start, period_end]`
      covers that date has status ∈ {`within_tolerance`, `resolved`,
      `approved`} — `pending`/`exception` do **not** block (they are the
      close prerequisites, `DEC-107`, and mean not-yet-reconciled).

    A parent transaction with a **null `location_id`** has no location-scope
    lock to apply, so only the `company` scope is evaluated. The
    reconciliation match is **organization-wide by period** because
    `reconciliation` carries no location and no channel (the `DEC-107`
    `scopeLimited` posture); a channel-precise match would need a
    `reconciliation.scope_id → settlement.channel_id` join that no read
    performs (a recorded `DEC-117` follow-up).
  - **Persistence** (`feat(persistence)`) —
    `packages/persistence/src/repositories/reconciliation.ts` (+ tests in
    `reconciliation.postgres.test.ts`): the read-only gate reads over the
    existing `period_close` and `reconciliation` columns — no schema change.
  - **Application** (`feat(application)`) — the gate is evaluated inside
    `correctSalesLine`'s **existing transaction** (`packages/application/src/
    sales/correct-sales-line.ts`), before any write, with the reconciliation
    and period-close stores bound to the **same transaction client** as the
    writes (no race between the gate read and the posting). A blocked
    reversal throws a **message-only `DomainError`** and posts **nothing** —
    no reversal line, no movement reversal, no audit — consistent with the
    other reversal rejections. No override/approval path and no
    `adjustment_period` requirement in this slice. Port/types/store wiring in
    `packages/application/src/reconciliation/{types.ts,postgres-store.ts,
    index.ts,test-support.ts}` and `packages/application/src/sales/{types.ts,
    postgres-store.ts,test-support.ts}`; command tests in
    `sales/sales.test.ts` + the new `sales/correct-sales-line.postgres.test.ts`
    (the block tests assert no reversal line, no movement reversals and no
    audit events).
  - **Decision** (`docs(decisions)`) — `DEC-117` recorded in
    `12_OPEN_DECISIONS.md` (both tables), provisional pending owner/FIN
    confirmation.
  - **No migration was needed** — the gate is two **read-only** reads over
    existing columns (`period_close.status`/scope/dates;
    `reconciliation.status`/`period_start`/`period_end`), so there is no
    schema object to add. Schema stays through `0062`, 89 tables.
    **Append-only:** a blocked reversal posts nothing at all; an allowed
    reversal still writes only new rows (never edits), so the rule holds on
    both paths.
- **Review:** two reviewers (`reviewer-qwen` adversarial, `reviewer-glm`
  code-level). **Both independently found the same defect:** the `DEC-116`
  long-form row in `12_OPEN_DECISIONS.md` had been corrupted by an earlier
  writer's truncate-and-restore incident (12 cells instead of 7; content
  intact but the markdown table broken). **Accepted and fixed:** the row was
  repaired by splitting on `|` and keeping the first seven cells — it is now
  **byte-identical to `HEAD`**, zero content loss — and a clause recording
  the null-`location_id` handling was accepted into the `DEC-117` row. Both
  reviewers verified the gate itself: the block path posts nothing (the block
  tests assert no reversal line, no movement reversals and no audit events),
  the window bounds are inclusive, `pending`/`exception` do not block, the
  adapter binds the reconciliation and period-close stores to the same
  transaction client (no race), and the tests are real. **Declined with
  reasons:** (a) a dead `??` fallback message in the predicate — defensive
  only, the predicate always sets a reason; (b) the optional unused
  `scopeTypes` parameter — a future API surface, not this slice's contract;
  (c) the absent `FOR SHARE` row lock — informational only, `DEC-117`
  requires transactional reads, which the same-transaction binding already
  holds.
- **Reversibility:** each layer commit is independently revertible with
  `git revert <sha>` — the domain predicate, the persistence reads and the
  application command change revert independently. **No migration, no schema
  change and no data written** (migrations stay through `0062`; **89
  tables**): reverting the code restores the ungated reversal (the
  `DEC-116` behaviour); no backfill. Nothing pushed; nothing applied to
  DigitalOcean.
- **Next:** `DEC-118` — net the line-level reversals into the settlement
  reconciliation (or record a posture explaining why the append-only
  header is authoritative): `DEC-116` and `DEC-117` both recorded that
  `sumSalesForChannelPeriod` (`packages/application/src/reconciliation/
  postgres-store.ts`) sums the append-only `sales_transaction.gross_amount`
  header, so a line-level reversal never nets there and the settlement
  reconciliation disagrees with the sales reporting (`summarizeSales`,
  `sumSalesVolume`) after any reversal — a gate cannot fix that. Record
  `DEC-118` in both tables before or with the implementation, and note
  whether historical reconciliations are re-evaluated or only future ones
  (changing the read can flip an already-`within_tolerance` settlement to
  `exception`). Then the `DEC-116`/`DEC-117` follow-ups (partial/delta
  corrections, a persisted reversal reason or `adjustment_period` link,
  gating the exported `reverseSalesLine`, an approval/override path,
  channel-precise reconciliation matching), the remaining close-outs
  (`denominator_source` DB CHECK, per-channel packaging, the cost-card
  version chain, the per-item override, `behavior` filtering, partial-window
  proration), the row-11 backfill posture, `daily_close`, and the
  test-deployment rehearsal / golden-fixture sign-off (parked on owner
  inputs).
