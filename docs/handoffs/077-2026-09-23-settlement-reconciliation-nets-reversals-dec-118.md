# 2026-09-23 — Settlement reconciliation nets line-level reversals (`DEC-118`)

`main`; HEAD before this slice's docs commit is **`6d0d498`** (the `DEC-117`
docs commit). The slice lands as the `docs(decisions)`, `feat(persistence)`,
`feat(application)` and this `docs(context)` handoff commits (uncommitted at
handoff-writing time; the orchestrator commits the layers). No `feat(web)`
layer — the re-run is the existing explicit `POST` reconciliation route and the
adapter change is port-internal. Nothing pushed; nothing applied to
DigitalOcean. Verification at the tree (Node 22,
`DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela`):
`typecheck`, `lint`, `format:check`, `build` clean; **3640/3640 tests with
`DATABASE_URL` (239 files)**; `npm audit --omit=dev` = 0; `db:migrate` a no-op
on re-run through `0062`; **89 tables** (no new table, **no migration**). The
baseline before the slice was 3630/3630 (238 files); the slice added one new
test file (the Postgres reconciliation adapter test,
`packages/application/src/reconciliation/reconciliation.postgres.test.ts`) and
10 tests. Next free decision id `DEC-119`.

- **Delivered (`DEC-118`).** `DEC-116`/`DEC-117` recorded that
  `sumSalesForChannelPeriod` summed the append-only
  `sales_transaction.gross_amount` header, so a line-level reversal never
  netted there and the settlement reconciliation disagreed with the sales
  reports (`summarizeSales`, `sumSalesVolume`) after any reversal. Resolved
  additively and reversibly as a **read change** — no posted fact is edited.
  - **Persistence** (`feat(persistence)`) — the new **read-only** aggregate
    `sumSalesLineGrossForChannelPeriod`
    (`packages/persistence/src/repositories/sales.ts`, + tests in
    `sales.postgres.test.ts`): a **single query** summing
    `sales_line.gross_amount` over the lines of the `sales_transaction` rows
    matching the **organization** (org-scoped on both sides), the
    **settlement's channel and currency**, and the transaction's
    `occurred_at` **inclusive UTC-day window** expressed as a half-open
    instant range, **excluding** `option_kind = 'included'`, with the
    **gross** basis kept. `sumSalesForChannelPeriod`
    (`packages/application/src/reconciliation/postgres-store.ts`) now
    delegates to it.
  - **Application** (`feat(application)`) — a `reconcileSettlement` **re-run**
    (`packages/application/src/reconciliation/reconcile-settlement.ts`) now
    refreshes `expected_amount`, `actual_amount`, `tolerance` and
    `difference` **alongside `status`** on the update branch, while
    preserving `resolution_note` (`owner_id`/`due_date` change only when
    supplied) — superseding the "amounts are creation-time facts" convention
    **for this command**, so a re-run cannot leave a stored status beside
    stale amounts. Port/types/store wiring in
    `packages/application/src/reconciliation/{types.ts,postgres-store.ts,
    test-support.ts}`; command tests in `reconciliation.test.ts` + the new
    `reconciliation.postgres.test.ts`.
  - **Decision** (`docs(decisions)`) — `DEC-118` recorded in
    `12_OPEN_DECISIONS.md` (both tables), provisional pending owner/FIN
    confirmation. The transaction-only channel attribution is deliberate
    (reporting's `coalesce(line.channel_id, transaction.channel_id)` fallback,
    `DEC-045`, is **not** adopted); **no backfill and no automatic historical
    re-evaluation** (existing `reconciliation` rows are untouched until an
    operator re-run — the only caller is an explicit `POST` route); and a
    recorded clause that a re-run can change the `DEC-117` reversal gate's
    verdict for the period (a flip to `exception`/`pending` **unblocks**
    reversals; a flip to `within_tolerance`/`resolved`/`approved` **blocks**
    them) — recorded, not silent.
  - **No migration was needed** — the change is a read change plus one new
    **read-only** aggregate over existing columns
    (`sales_line.gross_amount`, `option_kind`, the transaction header's
    `channel_id`/`currency`/`occurred_at`), so there is no schema object to
    add. Schema stays through `0062`, 89 tables. **Append-only:** no posted
    fact is edited — a re-run changes only the **re-derived** reconciliation
    values (`status`/amounts/tolerance/difference) and only on an explicit
    operator re-run; the sales facts stay untouched.
- **Review:** two reviewers (`reviewer-qwen` adversarial, `reviewer-glm`
  code-level). **No blockers.** Both verified: the new window expression is
  exactly equivalent to the old adapter's inclusive UTC-day string comparison
  (including a non-UTC-offset timestamp); no double-counting (the join is on
  the transaction primary key); the netting is correct on the gross basis;
  `resolution_note` is preserved on a re-run; the no-backfill/no-automatic-
  re-evaluation posture holds (the only caller is an explicit `POST` route);
  the tests are real and the new Postgres test executes rather than skips;
  and the decision file's rows are intact. **Accepted and fixed:** qwen's
  major — the `DEC-118` re-run can change the `DEC-117` reversal gate's
  verdict for a period (a flip to `exception`/`pending` unblocks reversals; a
  flip to `within_tolerance`/`resolved`/`approved` blocks them), now recorded
  as a `DEC-118` clause; and a pre-existing `updatedBy`-dropped mapping in
  the adapter's patch (the column pre-existed; an audit-trail gap), now
  forwarded end to end with a test. **Declined with reasons:** (a) the test
  fake's `slice(0, 10)` UTC-day derivation — test-only, all seeds are `Z`
  strings, the limitation is documented; (b) an unreachable `?? "0.0000"`
  backstop in the aggregate — a harmless defence.
- **Reversibility:** each layer commit is independently revertible with
  `git revert <sha>` — the persistence aggregate and the application command
  change revert independently. **No migration, no schema change and no data
  written by the slice itself** (migrations stay through `0062`; **89
  tables**): reverting the code restores the header-basis read
  (`sumSalesForChannelPeriod` over the `sales_transaction.gross_amount`
  header); a re-run would then re-derive the old figures for that row — the
  only rows ever affected are those an operator explicitly re-runs.
  **No backfill.** Nothing pushed; nothing applied to DigitalOcean.
- **Next:** `DEC-119` — make the daily (location, day) close reachable.
  `DEC-027` defines the lock at **(location, day)** for a daily close and
  **(company, calendar month)** for a month close, and the `DEC-117` reversal
  gate reads **location-scope** locks — but if the daily/location close cannot
  actually be created and locked end to end (command, route, UI, tests), the
  gate's location arm is dead and the `DEC-028` block never fires at location
  granularity. Objective: verify and complete the location-scope close path
  end to end (or record precisely which part is missing and why); record the
  posture as `DEC-119` in both tables of `12_OPEN_DECISIONS.md` before or with
  the implementation (Rule 3). Read `DEC-027`, `DEC-105`, `DEC-106`,
  `DEC-107`, `DEC-117`, `packages/application/src/close/**`
  (`begin-period-close.ts`, `lock-period-close.ts`, `resolveClosePeriod` in
  `packages/domain/src/period-close.ts`, `is-period-locked.ts`), the close
  routes/UI under `apps/web/app/api/v1/close/**` and
  `apps/web/app/(app)/close/**`, and the close tests first; keep it additive
  and reversible, append-only, with a `.test.ts` per branch, and commit in
  layers with the rollback approach in the body. Then the
  `DEC-116`/`DEC-117`/`DEC-118` follow-ups (recomputing the transaction header
  at posting time, partial/delta corrections, a persisted reversal reason or
  `adjustment_period` link, gating the exported `reverseSalesLine`, an
  approval/override path, channel-precise reconciliation matching), the
  remaining close-outs (`denominator_source` DB CHECK, per-channel packaging,
  the cost-card version chain, the per-item override, `behavior` filtering,
  partial-window proration), the row-11 backfill posture, and the
  test-deployment rehearsal / golden-fixture sign-off (parked on owner
  inputs).
