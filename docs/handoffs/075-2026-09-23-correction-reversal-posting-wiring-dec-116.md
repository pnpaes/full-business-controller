# 2026-09-23 — Correction/reversal posting wiring delivered (`DEC-116`)

`main`; HEAD before this slice's docs commit is **`c4014ba`** (the `DEC-115`
docs commit). The slice lands as the `docs(decisions)`, `feat(persistence)`,
`feat(application)`, `feat(web)` and this `docs(context)` handoff commits
(uncommitted at handoff-writing time; the orchestrator commits the layers).
Nothing pushed; nothing applied to DigitalOcean. Verification at the tree:
`typecheck`, `lint`, `format:check`, `build` clean; **3604/3604 tests with
`DATABASE_URL` (236 files)**; `npm audit --omit=dev` = 0; `db:migrate` a no-op
on re-run through `0062`; **89 tables** (no new table, **no migration**). The
baseline before the slice was 3585/3585 (235 files); the slice added one new
test file (the route test, `apps/web/app/api/v1/sales/lines/[id]/reverse/
route.test.ts`) and 19 tests. Next free decision id `DEC-117`.

- **Delivered (`DEC-116`).** `DEC-073` defines a sales-line reversal as a new
  negated `sales_line` carrying `reversal_of_id`, and `DEC-028` requires the
  original's stock movements to be restored through the inventory reversal
  primitive, but `reverseSalesLine` implemented only the line half — a reversed
  line left its theoretical-consumption `stock_movement` rows un-reversed, so
  its ingredient cost stayed understated, and no route or UI exposed the
  reversal at all. Wired additively and reversibly with **no schema change**;
  full negation only (`DEC-073`); the append-only rule holds — the original
  line and its movements are never edited, every reversal writes new rows.
  - **Persistence** (`feat(persistence)`) —
    `packages/persistence/src/repositories/inventory.ts`: a new source-scoped
    read of the line's reversible movements with the `onlyReversible` filter —
    `source_type = 'sales_line'`, `source_id` = the original line id,
    `reversal_of_id IS NULL`, and the movement is not itself a reversal nor
    already reversed (no other movement whose `reversal_of_id` equals its id) —
    so a partially-reversed line stays correctable and is never double-reversed
    or wedged. Tests in `inventory.test.ts`.
  - **Application** (`feat(application)`) — the new orchestrating command
    `correctSalesLine` (`packages/application/src/sales/correct-sales-line.ts`):
    reverses the line and every reversible movement of the original in **one
    database transaction** — the Postgres adapter binds both the sales and the
    inventory adapters to the transaction client, so a mid-loop failure rolls
    the line reversal back too. Reversal movements copy the **original**
    movement's `source_type`/`source_id` (the inventory primitive's existing
    behaviour), so `lineCostExpression` nets the original line's ingredient
    cost to zero and the reversal line carries zero cost. Idempotency is
    **rejection, not replay** — the line's partial unique index
    (`sales_line_reversal_of_id_key`) and the per-movement
    `reversal:<movementId>` idempotency key turn a double reversal into a real
    `23505`, not a silent replay. A mandatory `reason_code` (capped at 200
    chars) is audited. Port/types/store wiring in `inventory/types.ts`,
    `inventory/postgres-store.ts`, `inventory/test-support.ts`,
    `sales/types.ts`, `sales/postgres-store.ts`, `sales/test-support.ts`,
    `sales/index.ts`; command tests in `sales/sales.test.ts`; a reporting
    assertion updated in `reporting/reporting.postgres.test.ts`.
  - **Web** (`feat(web)`) —
    `POST /api/v1/sales/lines/[id]/reverse`
    (`apps/web/app/api/v1/sales/lines/[id]/reverse/route.ts`, + route test):
    same-origin + rate-limit + session guards, UUID validation (non-UUID →
    404), `DomainError` → 400; a `reverseSalesLine` limiter in
    `apps/web/app/api/v1/sales/limiters.ts`; the transaction detail page's
    `sales-rows.ts` (+ test) surfaces the reversal action and a new
    `ReverseLine` action (`reverse-line.tsx`) on
    `apps/web/app/(app)/sales/transactions/[id]/page.tsx`, hidden for a
    reversal line and for an already-reversed line; the import run page's
    `run-actions.tsx` adjusted for the shared rows helper.
  - **Decision** (`docs(decisions)`) — `DEC-116` recorded in
    `12_OPEN_DECISIONS.md` (both tables), provisional pending owner/FIN
    confirmation.
  - **No migration was needed** — the wiring rides on the existing
    `sales_line.reversal_of_id` partial unique index and the
    `stock_movement.reversal_of_id`/idempotency columns; no schema object
    changes. Schema stays through `0062`, 89 tables. Append-only: reversals
    write new rows; the original line and its movements are never edited.
  - **Deferred with reasons (recorded in `DEC-116`):** the `DEC-028`
    "blocked when reconciled downstream sales depend on the original" gate and
    any period-lock gate (next slice, `DEC-117`); partial/delta corrections;
    persisting `reason_code` or an `adjustment_period` link on `sales_line`
    (would need a migration); and the settlement-reconciliation header
    divergence (the settlement reconciliation sums the append-only transaction
    header, so a line-level reversal does not net there).
- **Review:** two reviewers (`reviewer-qwen` adversarial, `reviewer-glm`
  code-level). **Both independently flagged the same gap:** the atomicity
  guarantee was **untested**. `reviewer-qwen` also found that the movement set
  could include a reversal movement (a reversal copies the original's
  `source_type`/`source_id`), which could double-reverse a `correction`
  movement or wedge a partially-reversed line. **Accepted and fixed:** the
  `onlyReversible` movement-set restriction (with Postgres and unit tests); an
  atomicity rollback test that fails pre-fix (a duplicate reversal
  `idempotency_key` raises a real `23505` after the line reversal, and the
  test asserts the reversal line and its audit are absent) ; a 200-char
  `reason_code` cap in the command; an over-long-reason route test; and a
  refinement to the `DEC-116` decision row. **Declined with reasons:** (a)
  mitigating the recorded settlement-reconciliation header divergence in this
  slice — it is a recorded, separately-scoped divergence, not a defect of the
  wiring; (b) a test for the shared route guard order — the guards are
  shared, already-tested helpers, not slice logic; (c) a test for the recorded
  "a re-import does not re-post a reversed line" claim — that claim belongs to
  the import poster's scope, not this command.
- **Reversibility:** each layer commit is independently revertible with
  `git revert <sha>`. **No migration, no schema change** (migrations stay
  through `0062`; **89 tables**): the persistence read, the application
  command and the web route/UI revert independently; reverting the code leaves
  existing reversal rows intact and the ledger balanced (reversals are
  rows, never edits). No backfill. Nothing pushed; nothing applied to
  DigitalOcean.
- **Next:** `DEC-117` — the `DEC-028` downstream-reconciliation reversal gate:
  an automatic reversal must be **blocked** when reconciled downstream sales
  depend on the original (an operator can today reverse a line inside a
  reconciled or locked period and silently break the settlement match);
  decide and implement the gate — or record a posture that keeps it deferred,
  with the reason — and record it as `DEC-117` in both tables of
  `12_OPEN_DECISIONS.md` before or with the implementation. Read `DEC-028`,
  `DEC-073`, `DEC-106`/`DEC-107`, the reconciliation reads
  (`packages/application/src/reconciliation/**`,
  `packages/persistence/src/repositories/reporting.ts`,
  `packages/persistence/src/repositories/reconciliation/**`), the period-lock
  state (`packages/application/src/close/**`, `is-period-locked`) and
  `packages/application/src/sales/correct-sales-line.ts` first; keep it
  additive and reversible, append-only, with a `.test.ts` per branch, and
  commit in layers with the rollback approach in the body. Also weigh the
  sibling divergence `DEC-116` recorded — the settlement reconciliation sums
  the append-only transaction header, so a line-level reversal does not net
  there. Then the remaining close-outs (the `denominator_source` DB CHECK,
  per-channel packaging, the cost-card version chain, the per-item override,
  `behavior` filtering, partial-window proration), partial/delta corrections,
  a persisted reversal reason or `adjustment_period` link, the row-11 backfill
  posture, `daily_close`, and the test-deployment rehearsal /
  golden-fixture sign-off (parked on owner inputs).
