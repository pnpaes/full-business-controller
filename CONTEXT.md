# Project context

Canonical orientation for this repository: read this first when resuming work,
and update it at the end of any session that changes anything (code, docs,
decisions, data) — per `AGENTS.md` Rule 1. Reference artifacts by path; don't
duplicate their content.

Per-slice history, commits and rollback inventories live in **`docs/handoffs/`**
(one file per slice + `reversibility-log.md`); this file keeps only the live
orientation and the next step. See "Handover archive" and "Update protocol".

## Resume here (next session)

**Say "resume the work" and start here.** A fresh session must be able to
continue from this section alone. (Rewritten by the 2026-09-24 W7
documentation session; the W7 wave is documented in
`docs/handoffs/080-2026-09-24-w7-ui-refinement-wave.md`.)

**State:** `main`; HEAD **`01a9cda`**, working tree clean. W7 — the
UI-refinement wave of the operations-completion programme
(`docs/ROADMAP-OPERATIONS-COMPLETION.md`) — is **complete for the screens**: every
recorded action that has an application service plus an HTTP route is now
reachable from a control, stale "not wired / planned" copy is purged, styling is
on the design tokens, and WCAG 2.2 AA and 375px mobile behaviour are enforced.
One W7 leftover is deliberately left to the next session: the app-shell search
and scope placeholders in `apps/web/app/(app)/layout.tsx` (Part 1 below). Not
every honest gap is closed — see "Open decisions / inputs" for what still has no
backend at all. Six commits on `main` (`54022c7` … `01a9cda` — see the handoff for
the list), **all unpushed**; nothing applied to DigitalOcean. This wave added
**no new decision**; next free decision id is **`DEC-129`**. The wave builds
on the `DEC-120` redesign, the `DEC-121` wiring and the `DEC-122` task
workflow (decisions + earlier handoffs are the authority for those). Schema:
migrations through **`0066`**, **93 public tables** — **no migration in W7**;
`db:migrate` a no-op on re-run. Verification at HEAD: `typecheck`, `lint`,
`format:check`, `build` clean;
`DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela npm run
test` → **4276/4276 tests (294 files)**.

**Next task — W7 close-out plus opening the file-bytes workstream.** Two
parts, in that order.

**Part 1 — the app-shell search and scope placeholders (decide, don't leave
ambiguous).** `apps/web/app/(app)/layout.tsx` (single-owner file) still
carries unwired search/scope placeholders. Inventory what the application
layer actually exports first (`packages/application/src/**`), then either:

- (a) **wire** them to a real read — honest only if a real listing/search
  read exists and is exported; or
- (b) **remove** the placeholders and record the reason (in the commit body
  and the handoff file) — the honest default when no read exists, per the
  `08_UI_UX.md` §8.4 rule (every screen answers "what next" or says honestly
  what is missing).
  State which option was chosen and why before implementing. Scope (do): only
  `apps/web/app/(app)/layout.tsx` plus, if (a), the minimum read plumbing under
  `packages/application`; commit reversibly. Scope (do not): no
  `packages/ui/**` redesign, no `shell-nav.tsx` edits bundled in, no new
  backend service invented for the sake of (a).

**Part 2 — record the storage-port posture as `DEC-129` and implement the
`file_object` application port.** `file_object` has no application port
(`DEC-085`/`DEC-099`, `ADR-0006`), so **all file bytes are metadata-only**
today across documents, employee documents, incident evidence, maintenance
evidence and payroll export — the largest remaining honest gap.

- Read first: `docs/adr/0006-file-storage-and-retention.md`, the `DEC-085`
  and `DEC-099` rows in `12_OPEN_DECISIONS.md`,
  `docs/runbooks/persistence-migrations.md`, the `file_object` schema and
  repository (migrations `0035`/`0036`).
- Record **`DEC-129`** in `12_OPEN_DECISIONS.md` — **both tables, whole new
  lines only** (append rows; never edit mid-row; never put a literal `|`
  inside a cell) — **before or with** the code (Rule 3). Do not invent a
  different id.
- Implement the application port with a **local adapter**; add an
  **expand-only migration** only if the port genuinely needs schema.
  Required disciplines: decimal-only with HALF_UP (never floats); a
  reversible additive migration with a rehearsed down path recorded in
  `docs/runbooks/persistence-migrations.md` (add the runbook row); update
  `EXPECTED_TABLES` in `schema.test.ts` if (and only if) the table set
  changes.
- Wire **one honest consumer first** (the document library is the natural
  one — it is metadata-only today); do not attempt to wire every deferred
  file FK in the same slice. No cloud storage integration (Spaces is a later
  decision; local adapter only).

**Scope (do not), whole task:** do not rewrite posted money or stock facts;
do not invent a row or a decision id silently; do not resolve other recorded
open inputs silently; do not push; do not deploy or write externally
(`DEC-015`).

**Verification set (exact):** `export NVM_DIR="$HOME/.nvm"; .
"$NVM_DIR/nvm.sh"; nvm use 22`; `npm run typecheck`; `npm run lint`; `npm run
format:check`; `npm run build` — noting that `apps/web/next-env.d.ts` and
`apps/web/tsconfig.json` are **generated artifacts** rewritten by every
`next build`/`next dev` for the active `NEXT_DIST_DIR`; normalise with
`git checkout -- apps/web/next-env.d.ts apps/web/tsconfig.json` before
staging. Full suite:
`DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela npm run
test` (≥ **4276/4276**, 294 files) — note
`packages/application/src/scheduling/scheduling.postgres.test.ts` has a known
same-instant ordering flake (passes on re-run). `npm run db:migrate` a no-op
re-run (or, if a migration landed: the rehearsed down path plus a runbook row
before finishing). Commit in layers with the rollback approach in each body
(Rule 2).

## Next up (prioritised)

`docs/BUILD_ROADMAP.md` is the ordered execution tracker; §5 carries the
open-point lists. Per-slice detail is in `docs/handoffs/`. The detailed list
lives in the second "Next up" section below.

1. **Next: W7 close-out + the `DEC-129` file-bytes workstream** (see
   "Resume here").
2. **The operations-completion waves W1–W7 are all delivered** (W7 per
   `docs/handoffs/080-…md`); what remains is the honest-gap list, not a wave.

## What this is

**Aquarela Business Control** — a secure, testable modular monolith for an Oslo
café with two locations, covering costing, pricing, inventory, production,
sales/imports, workforce and reporting. It is **documentation-first**: Phase 0 is
complete (specification, 65 accepted decisions, artifacts and ADRs).

Built and committed: the foundation scaffold; the Phase 1–2 persistence core; the
auth slices (1a–1e); the UI token foundation; master-data slices 2–3; slice 4
(receipt + price history + landed cost); slice 5 (recipes); slice 6 (operating
costs + labour + allocation); slice 7 (cost card + snapshots + price scenario +
approval); slice 8 (stock ledger + balances + lots/storage); slice 9 (counts +
transfers + waste); slice 10 (production planning + batches, incl. web); row 11
(import framework + external mappings, complete); row 12 (sales + settlements +
reconciliation, complete); the `DEC-072`–`DEC-085` low-risk implementations; the
`DEC-086`–`DEC-094` programme (HMS monitoring/incidents/checklists/equipment/
compliance export; the `employee` + personnel-documents slice; the staff document
library; the schema-only workflow platform); and row 14 (workforce/scheduling —
14a shifts, 14b-1 worked hours, 14b-2 payroll report), which is **complete**;
and the operations-completion programme (`docs/ROADMAP-OPERATIONS-COMPLETION.md`,
waves W1–W7 — wiring, master-data authoring, recipes, production, tasks/
administration, intelligence/simulation, UI refinement; `DEC-120`–`DEC-128`)
which is **delivered as a wave programme**, with an enumerated honest-gap list
in "Next up" / Current status.

Per-slice detail, commits and reconciliation are in `docs/handoffs/`.

## Where things live

- `00_README.md` … `13_AGENT_BUILD_BRIEF.md` — the specification package
  (inputs, rarely edited). Start with `00_README.md`.
- **`12_OPEN_DECISIONS.md` — the accepted decisions (`DEC-001`…`DEC-128`);
  the authority. New decisions are appended here (next free id `DEC-129`).**
- `docs/phase0/` — close-out plan, calculation contract, data dictionary, golden
  fixtures, source-data request, notes. See
  `docs/phase0/CALCULATION_CONTRACT.md`.
- `docs/adr/` — architecture decision records `0001`–`0012`.
- `docs/runbooks/` — operator runbooks (`persistence-migrations.md`, `deployment.md`).
- `docs/BUILD_ROADMAP.md` — the ordered slice backlog and per-slice execution loop
  (a derived execution tracker; decisions and accepted ADRs stay the authority).
- `docs/handoffs/` — **the handover archive**: one file per completed slice
  (verbatim work-log entry, newest first in `README.md`), `reversibility-log.md`
  (per-slice commit/rollback inventory) and `context-sections-archive-2026-09-22.md`.
- `schemas/` — draft DDL and domain enums (`schemas/phase1_2_draft.sql`,
  `schemas/domain-enums.yaml`).
- `samples/` — real POS exports, screenshots and templates (reference data).
- `packages/*` and `apps/*` — code (config, logger, domain, application,
  persistence; `web`, `worker` and `scheduler` runtimes).
- `AGENTS.md` — the rules (handoff/work log, reversibility, decisions).
- `CONTEXT.md` — this file.

## Current status

- **As of:** 2026-09-24 — branch `main`; HEAD **`01a9cda`**, working tree
  clean. **W7 — the UI-refinement wave of the operations-completion
  programme — is complete** and it is the newest work-log entry: six commits
  (`54022c7` reconcile forms, `5227552` costing/inventory authoring,
  `f3201ff` workforce/HMS/document actions, `733ee83` review findings,
  `c202c39` honesty corrections, `01a9cda` recipe-version registration +
  item pickers — the verbatim list is in
  `docs/handoffs/080-2026-09-24-w7-ui-refinement-wave.md`), all **unpushed**,
  covering
  sales, purchasing, inventory, costs, workforce, HMS, documents, tasks,
  recipes, products and production across the six programme groups, with
  tokens/WCAG 2.2 AA/375px enforced and every stale "not wired / planned"
  label purged. **No new decision added** in the wave (next free id
  **`DEC-129`**); **no migration** (through `0066`, **93 tables**);
  `01a9cda`'s group re-ran from scratch after an abandoned subagent (see the
  handoff's process facts). Lineage and full per-slice detail:
  `docs/handoffs/README.md` and the files it lists.
- **The operations-completion waves W1–W7 are delivered** (`DEC-120` redesign
  through `DEC-128` recorded and implemented; per-wave detail lives in the
  decisions rows and the handoff archive — not restated here). The prior
  entries below record the programme's earlier completed slices.
- **W7 verification (2026-09-24, at `01a9cda`):** `typecheck`, `lint`,
  `format:check`, `build` clean (build under a unique `NEXT_DIST_DIR`);
  **4276/4276 tests with `DATABASE_URL`** (294 files); `db:migrate` a no-op.
  Review: `reviewer-qwen` (adversarial) + `reviewer-glm` (code-level) —
  **no blockers, no majors**; accepted minors listed in
  `docs/handoffs/080-…md`, with one declined item (an `opacity` token scale)
  and its reason recorded there.
- **The daily (location, day) close is exposed operator-driven (`DEC-119`):**
  research found the backend already complete — `beginPeriodClose`/
  `lockPeriodClose` accept both scopes
  (`packages/application/src/close/**`), `resolveClosePeriod` derives the
  window (`packages/domain/src/period-close.ts`) and the API routes exist
  under `apps/web/app/api/v1/close/**` — but no close UI existed, so an
  operator could not create or lock a location daily close and the
  `DEC-117` reversal gate's location arm was unreachable in practice. A new
  `/close` register UI (`apps/web/app/(app)/close/**`: the server page
  gating on `PERIOD_CLOSE_READ_ROLES`, a begin form whose location selector
  is filtered to the caller's allowed locations plus a `periodStart` day,
  a role-gated company month option, and lock/reopen row actions with a
  **mandatory** reopen reason; a pure labels module + test; a `Close` nav
  entry in `shell-nav.tsx` and a tasks-page pointer) plus a **joining
  test** (unit + Postgres over `packages/application/src/sales/**`) that
  locks a location close through the **real** commands and proves
  `correctSalesLine` is then blocked for that location and day while
  another location is allowed. `scopeLimited` (the `DEC-107`
  organization-wide prerequisite evaluation) is surfaced, not hidden.
  **No backend production code changed** (no command, route, schema or gate
  change; no new route); **no migration**; operator-driven — no scheduler.
  Review: `reviewer-qwen` + `reviewer-glm` — no blockers, no majors; two
  trivial minors declined with reasons. Handoff: `docs/handoffs/078-…md`.
- **The settlement reconciliation nets line-level reversals (`DEC-118`):**
  the new read-only aggregate `sumSalesLineGrossForChannelPeriod`
  (`packages/persistence/src/repositories/sales.ts` + Postgres tests) sums
  `sales_line.gross_amount` over the lines of the transactions matching the
  organization (org-scoped both sides), the settlement's channel and
  currency, and the transaction's `occurred_at` inclusive UTC-day window
  expressed as a half-open instant range, excluding
  `option_kind = 'included'`, with the **gross** basis kept;
  `sumSalesForChannelPeriod`
  (`packages/application/src/reconciliation/postgres-store.ts`) now
  delegates to it, so a `DEC-073` line-level reversal nets and the
  settlement reconciliation agrees with the sales reports. A
  `reconcileSettlement` re-run
  (`packages/application/src/reconciliation/reconcile-settlement.ts`)
  refreshes `expected_amount`/`actual_amount`/`tolerance`/`difference`
  alongside `status` while preserving `resolution_note` — superseding the
  "amounts are creation-time facts" convention for this command. The
  transaction-only channel attribution is deliberate (no reporting
  `coalesce` fallback); **no backfill and no automatic historical
  re-evaluation** (the only caller is an explicit `POST` route); the adapter
  patch now forwards `updatedBy` (pre-existing audit-trail gap, fixed end to
  end); a re-run can change the `DEC-117` reversal gate's verdict for the
  period (a flip to `exception`/`pending` unblocks reversals; a flip to
  `within_tolerance`/`resolved`/`approved` blocks them — recorded as a
  `DEC-118` clause). **No migration** (a read change plus one new read-only
  aggregate over existing columns); append-only holds — no posted fact is
  edited, only re-derived reconciliation values change, and only on an
  explicit re-run. Review: `reviewer-qwen` + `reviewer-glm` — no blockers;
  the `DEC-117`-verdict-flip clause and the `updatedBy` fix accepted; two
  minors declined with reasons. Handoff: `docs/handoffs/077-…md`.
- **Correction/reversal posting wiring is delivered (`DEC-116`):** the new
  orchestrating command `correctSalesLine`
  (`packages/application/src/sales/correct-sales-line.ts`) reverses the line
  and every **un-reversed, non-reversal** `stock_movement` with
  `source_type='sales_line'` and `source_id` = the original line id through
  `reverseStockMovement`, all inside **one database transaction** (the
  Postgres adapter binds both the sales and inventory adapters to the
  transaction client). Reversal movements copy the **original** movement's
  `source_type`/`source_id`, so `lineCostExpression` nets the original line's
  ingredient cost to zero and the reversal line carries zero cost.
  Idempotency is **rejection-not-replay** (the line's partial unique index;
  `reversal:<movementId>`). A mandatory `reason_code` (capped at 200 chars)
  is audited. `POST /api/v1/sales/lines/[id]/reverse` (same-origin + rate
  limit + session guards, UUID validation, `DomainError` → 400), a
  `reverseSalesLine` limiter and a `ReverseLine` action on the transaction
  detail page (hidden for a reversal line and an already-reversed line). The
  `onlyReversible` movement-set restriction (a movement that is itself a
  reversal, or already has one, is excluded) keeps a partially-reversed line
  correctable and never double-reversed. **No migration** (existing
  `reversal_of_id`/idempotency columns); append-only — the original line and
  its movements are never edited. Deferred (recorded): partial/delta
  corrections, a persisted reason or `adjustment_period` link, and the
  settlement-reconciliation header divergence
  (`sumSalesForChannelPeriod` sums the append-only transaction header, so a
  line-level reversal does not net there). Review: `reviewer-qwen` +
  `reviewer-glm` — both flagged the untested atomicity, fixed with a
  fails-pre-fix rollback test; qwen's double-reverse finding fixed via
  `onlyReversible`; three minors declined with reasons. Handoff:
  `docs/handoffs/075-…md`.
- **The `DEC-028` downstream-reconciliation reversal gate is delivered
  (`DEC-117`):** a read-only, no-migration gate (`evaluateReversalGate`,
  `packages/domain/src/reversal-gate.ts`, a pure domain predicate + test) is
  evaluated inside `correctSalesLine`'s transaction (`packages/application/
src/sales/correct-sales-line.ts`) **before any write**, with the
  reconciliation store reads (`packages/persistence/src/repositories/
reconciliation.ts` + Postgres tests) and period-close reads bound to the
  **same transaction client** as the writes (no race). A reversal is blocked
  when a **`locked` `period_close`** covers the parent transaction's
  `occurred_at` date for the `location` scope (the transaction's
  `location_id`, that day) or the `company` scope (the organization id, that
  day), or when a **`reconciliation`** row whose `[period_start, period_end]`
  covers that date has status ∈ {`within_tolerance`, `resolved`,
  `approved`} — `pending`/`exception` do **not** block (they are the close
  prerequisites, `DEC-107`); a null `location_id` means only the company
  scope is evaluated. A blocked reversal throws a message-only
  `DomainError` and posts **nothing** (no reversal line, no movement
  reversal, no audit); no override/approval path and no `adjustment_period`
  requirement; the reconciliation match is organization-wide by period
  (`reconciliation` has no location or channel). No web change — the route
  already maps `DomainError` → 400. **No migration** (two read-only reads
  over existing columns); append-only holds on both paths. Deferred
  (recorded in `DEC-117`): an approval/override path and channel-precise
  reconciliation matching. Review: `reviewer-qwen` + `reviewer-glm` — both
  independently found the corrupted `DEC-116` decision row (repaired;
  byte-identical to `HEAD`); three minors declined with reasons. Handoff:
  `docs/handoffs/076-…md`.
- **Allocation pool recurrence→period normalisation is delivered (`DEC-115`):**
  each linked `operating_cost.amount` is a **per-recurrence-unit** amount,
  scaled to the half-open `[periodFrom, periodTo)` UTC allocation period by the
  exact rational factor `periodDays / nominalDays` (`nominalDays`
  calendar-anchored at `periodFrom`: daily 1, weekly 7, monthly = days in
  `periodFrom`'s month, quarterly = 3 months, annual = 12 months incl. leap);
  `one_off` contributes face value once only when
  `periodFrom <= effective_from < periodTo`; contributions are summed exactly
  over a common denominator (BigInt rationals) and rounded once at
  `MONEY_SCALE` (4 dp HALF_UP); an unknown recurrence fails closed with a
  message-only `DomainError`. Implemented in the new
  `packages/domain/src/recurrence.ts` (+ test, barrel export); the pool sum in
  `packages/application/src/costing/resolve-allocated-unit-overhead.ts` calls
  it and `operatingCostIds` now lists **only non-zero contributors**.
  Supersedes `DEC-112`'s "recurrence unscaled" clause for the pool amount.
  **No migration** (a computation over an existing column). Deferred:
  partial-window proration, `behavior` filtering, a cross-currency guard, the
  `denominator_source` DB CHECK. Review: `reviewer-qwen` + `reviewer-glm` —
  no blockers, no majors; one minor accepted (a JSDoc clarification on the
  `operatingCostIds` semantics), three declined with reasons. Handoff:
  `docs/handoffs/074-…md`.
- **Volume-based allocation denominators are delivered (`DEC-114`):** the
  sales-derived denominators — `revenue`, `transactions`, `sales_units` — are
  implemented in `resolveAllocatedUnitOverhead` via a new half-open
  `sumSalesVolume` read (`packages/persistence/src/repositories/reporting.ts`:
  org-scoped, `locationId`-scoped, `option_kind <> 'included'`, unmapped lines
  included, reversals netted, empty window returns zeros; the
  `netSalesExpression()` helper was extracted from `summarizeSales` with
  byte-identical rendered SQL). The vocabulary
  `allocation_denominator_source` widened to
  `{explicit, eligible_products, equal_share, revenue, transactions,
sales_units}` in `schemas/domain-enums.yaml` and
  `packages/persistence/src/schema/vocabularies.ts` — **no migration** (the
  column is free text with a non-empty CHECK only). A missing/zero/negative
  volume **fails closed** with a message-only `DomainError`, and volume
  branches force `stop` semantics; the port member is on
  `CostCardComponentStore`, wired through
  `cost-card-composition-postgres-store.ts`. Deferred with reasons:
  `production_hours`/`production_minutes` (no driver authority yet),
  `recorded_time`, `operating_hours`, the `denominator_source` DB CHECK, and
  org-wide volume scope for `organization`/`company_wide` rules (the read is
  single-location — a recorded gap). Review: `reviewer-qwen` +
  `reviewer-glm` — no blockers, no majors; three minors declined with
  reasons. Handoff: `docs/handoffs/073-…md`.
- **Row-11 sales-import mapping writer is delivered (`DEC-113`):**
  `mapImportRows` resolves each sales-import row to a `product_variant` —
  SKU-first (`product_variant.sku` within the org), otherwise the effective
  `external_mapping` rows with `internal_entity_type = 'product_variant'` for
  the transaction's `source_system`, matched on sku/external id within the
  half-open window at `occurred_at` — and writes the resolved id into the
  staging row's `normalized.product_variant_id` (the key `postImportRun`
  already reads), so `sales_line.product_variant_id` is populated at import
  time. Unmapped rows stay null and keep resolving through the reporting
  `unmapped` bucket; the unmapped/conflict branches strip
  `product_variant_id`/`mapped_internal_entity_id`/`mapping_match` so a
  withdrawn mapping leaves no stale target; `DEC-025` partial posting and
  `DEC-033` conflict blocking unchanged. The map form exposes an optional
  Internal entity type field (default blank; the item path is unchanged; no
  automatic inference — `import_profile` carries no entity-type field). No
  migration, no schema change; **no historical `sales_line` backfill** (the
  recorded posture; the backfill posture, the demo variant seed and an
  `external_mapping` lookup index are deferred).
- **Cost-card component resolvers are delivered (`DEC-112`):** three of the
  four components now resolve from production data — direct labour
  (`recipe_version.preparation_minutes` = minutes per batch, valued at the
  effective `labor_rate` for the new `recipe_version.labor_cost_center_id`/
  `labor_role_code` pair, ÷ `approved_usable_output` via `unitDirectLaborCost`),
  channel variable cost (the `channel_fee_rule` reader, incl. a new
  `registerChannelFeeRule` + `POST /api/v1/costing/channel-fee-rules`) and
  allocated overhead (`operating_cost.cost_pool_id`, the closed
  `ALLOCATION_DENOMINATOR_SOURCE` vocabulary, `allocatedUnitOverhead`).
  Resolved wins over the caller's explicit input; provenance records the
  per-component source. `otherVariableCost` stays an explicit input.
  Migrations `0060`–`0062` (additive columns/vocabulary/guards/index).
- **Cost-card composition assembler is delivered (`DEC-111`):** the recipe
  version (effective `product_recipe_assignment`; an explicit id must agree or
  stands in), ingredient/packaging/sub-recipe via `computeRecipeCost` ÷
  `approvedUsableOutput`, `unitNetSales` from the effective
  `price_version.netPrice`, and the four non-resolvable components (direct
  labour, channel variable cost, other variable cost, allocated overhead) as
  **explicit validated inputs** with provenance. `POST /api/v1/costing/cost-cards`
  assembles then calls `calculateCostCard`. No migration.
- **Row 13e/13f `RPT-004` operations report is delivered (`DEC-110`):** stock
  value (point-in-time ledger Σ by location), stock variance (Σ
  `stock_count_line.variance_qty` + the **booked** adjustment value, never
  qty × cost), production yield (planned/actual output, both the stored
  `yield_variance_pct` semantics and the ratio, Σ|consumption Δ| input value),
  and waste by the `DEC-018` **`stage`** axis (`moving_average`-only value,
  item-only events included, unit-blind quantity). Uniform half-open `[from,to)`
  flow windows; `GET /api/v1/reports/operations` + `/records`; the Insights →
  Operations screen. No migration.
- **Row 13d menu engineering is delivered (`RPT-005`, `DEC-109`):** computed
  median thresholds (popularity; category-relative contribution before
  labour/fees) over all resolved products before the cap, high/low classification
  (no Star/Puzzle labels), waste annotations (`moving_average` only, `DEC-068`),
  the `unmapped` bucket, `GET /api/v1/insights/menu-engineering` and the Insights
  matrix screen with each row's actual threshold value + source period and a
  drill-down link. Reuses the row-13c read model; no migration.
- **Row 13c sales & margin reporting read model is delivered:**
  the domain (`SALES_REPORT_GRAINS`, `periodBucket`, `netSalesFromLine`,
  `contributionBeforeLabour`, `contributionMarginPctOrNull`), the org-scoped
  on-demand application + persistence read model (`buildSalesReport`,
  `listSalesReportRecords`, `summarizeSales` → `{ rows, transactions }` with a
  window-level distinct count, `countSalesTransactions`, `listSalesLineRecords`),
  the API (`/api/v1/reports/sales`, `/records` — the latter accepts the caller's
  `locationIds` scope; `SALES_REPORT_READ_ROLES` = owner, GM, location_manager,
  finance, admin, analyst) and the Management-home + Insights→Reports wiring
  (`RPT-001`–`RPT-003`, `FND-006`). Product/category grouping resolves the
  variant through `product_variant_id → sku → external_mapping → unmapped`
  (`DEC-108`/`DEC-109`). **No new table** — on-demand over the canonical facts
  (`ADR-0007`). Contribution is reported **before** direct labour, channel fees
  and allocated overhead, which are not computable today; no full cost or gross
  margin. Handoff:
  `docs/handoffs/066-2026-09-22-row-13c-sales-margin-reporting-read-model.md`.
- **Row 13 close half is complete (13a + 13b):** 13a `period_close` + the
  domain/application/web port (`REC-003`, `REC-006`, `DEC-027`, provisional
  `DEC-105`, migrations `0057`/`0058`), API under `/api/v1/period-closes/**`;
  13b close prerequisites + the `schemaVersion: 2` snapshot (`REC-003`/`REC-005`,
  `DEC-107`) and `adjustment_period` (`REC-006`, `DEC-106`, migration `0059`),
  API under `/api/v1/adjustment-periods/**`. The row-13a create-race recovery was
  fixed in `c903954` (fresh-transaction recovery). Three reviewers per
  workstream (qwen/minimax/glm) → no blockers after fixes. `daily_close`
  stays deferred; the `DEC-028` downstream-reconciliation reversal gate is
  now delivered (`DEC-117`), and the daily (location, day) close is exposed
  operator-driven (`DEC-119` — the `/close` register UI).
- **Row 14 (workforce/scheduling) is complete:** 14a `shift` +
  `shift_assignment` (`DEC-102`, migrations `0051`/`0052`); 14b-1
  `shift_adjustment` + the worked-hours derivation/report (`DEC-103`, migrations
  `0053`/`0054`); 14b-2 `payroll_report` + snapshot/application/web port
  (`DEC-104`, migrations `0055`/`0056`). API under `/api/v1/workforce/**`.
- **Programme (`DEC-086`–`DEC-094`, Phase 6 + Epics 20/21) fully delivered:**
  HMS monitoring, incidents, checklists, equipment/maintenance and the
  compliance/evidence export; the `employee` + personnel-documents slice
  (`DEC-087`/`DEC-099`); the staff document library (`DEC-088`/`DEC-100`, the
  first versioned entity); the workflow platform (`DEC-094`/`DEC-101`,
  schema-only). The `job`/worker/outbox layer stays gated on `ADR-0004`.
- **Schema:** migrations through **`0066`**; **93 tables** (all additive,
  tested down paths). Next free decision id **`DEC-129`** (`DEC-120`–`DEC-128`
  are recorded and implemented).
- **Verification (2026-09-24, at `01a9cda`):** `typecheck`, `lint`,
  `format:check`, `build` clean; **4276/4276 tests with `DATABASE_URL`**
  (294 files); `db:migrate` a no-op through `0066`; 93 public base tables.
  (Known flake, re-observed in this wave:
  `packages/application/src/scheduling/scheduling.postgres.test.ts` can fail
  on an audit same-instant ordering assertion and passes on re-run.)
- **Not yet built (the honest-gap list after W7 — do not imply the programme
  is finished):** `file_object` has **no application port** (`DEC-085`/
  `DEC-099`, `ADR-0006`), so **all file bytes are metadata-only** across
  documents, employee documents, incident evidence, maintenance evidence and
  payroll export — the largest remaining gap, affecting the most screens
  (next task = the `DEC-129` posture + the port); the app-shell **search and
  scope placeholders** in `apps/web/app/(app)/layout.tsx` are still unwired
  (single-owner file); **no unit-catalogue read service** anywhere (unit
  pickers impossible; recipe lines pinned to the component's base unit); **no
  cost-centre list read** (the `DEC-112` cost centre stays a paste-the-id
  field); `calculatePriceScenario` has **no HTTP route** (no price-scenario
  creation UI possible); incident **owner assignment** has no HMS-scoped
  user-list read (`listAssignableUsers` is not wired there); **Administration**
  has no identity/configuration backend (users, roles, scopes, tax, units
  read, audit read, data-quality read, integrations); planning/forecast
  **tracking** has no backend (the insights card stays honest). Standing
  items: per-process **rate limiter** needs a shared store; **reset-token
  delivery** is a no-op stub; `WF-003` self-assignment deferred (`DEC-102`);
  six golden fixtures **unsigned**; the `task`↔`approval` link is open; the
  worker/outbox layer is gated on `ADR-0004`. The deferred `DEC-112` items
  (the `other_variable_cost` source, the `production_*`/time denominators, a
  `denominator_source` DB CHECK, per-channel packaging, the cost-card version
  chain, the per-item cost-selection override, partial-window proration,
  `behavior` filtering), the org-wide volume scope (`DEC-114` gap) and the
  `DEC-116`/`DEC-117`/`DEC-118` recorded follow-ups remain recorded in their
  decision rows and handoffs — not restated here.
- **Dev server (session-scoped):** `DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela`,
  `ORGANIZATION_ID=1448a476-32f2-426f-b153-11a851011e48`; sign in `owner` /
  `LocalDevPass123`; MFA disabled for `owner`; demo data seeded including the
  `zettle-legacy` `import_profile`. A fresh session must restart the server.
- **Nothing applied to DigitalOcean.**
- **Open verification debt:** the per-process rate limiter needs a shared store
  before multi-instance deployment; reset-token delivery is a no-op stub until
  the email slice; palette hex values / data-viz palette semantics await owner
  sign-off; the six golden fixtures remain unsigned (the "verified" gate).

## Next up (prioritised)

`docs/BUILD_ROADMAP.md` is the ordered execution tracker; §5 carries the
open-point lists. Per-slice detail is in `docs/handoffs/`.

1. **Next: W7 close-out plus opening the file-bytes workstream** — the first
   self-contained, executable task in "Resume here" above: (a) decide the
   app-shell search/scope placeholders in `apps/web/app/(app)/layout.tsx`
   (wire to a real read or remove with the reason recorded — do not leave
   them ambiguous), then (b) record the storage-port posture as **`DEC-129`**
   in `12_OPEN_DECISIONS.md` (both tables, whole new lines only) and
   implement the `file_object` application port with a local adapter and an
   expand-only migration if the port needs schema, per `ADR-0006` and
   `DEC-085`/`DEC-099` (decimal-only/HALF_UP; rehearsed reversible
   migration + a runbook row in `docs/runbooks/persistence-migrations.md`;
   the `EXPECTED_TABLES` update in `schema.test.ts` if the table set
   changes).
2. **Then the honest-gap queue** (see the "Not yet built" bullet in Current
   status, each recorded not silently deferred): the unit-catalogue read
   service and the cost-centre list read (they still pin recipe lines to the
   component's base unit and keep the `DEC-112` cost centre a paste-the-id
   field), `calculatePriceScenario`'s HTTP route (no price-scenario UI
   possible without it), the HMS-scoped user-list read for incident owner
   assignment, the Administration identity/configuration backend, and
   planning/forecast tracking.
3. **Rows 13/12/11 and the close-outs delivered — COMPLETE.** Row 13 (close
   13a/13b + reporting 13c/13d/13e-f), the cost-card composition chain
   (`DEC-111`/`DEC-112`), the row-11 import mapping writer (`DEC-113`), the
   volume denominators + recurrence normalisation (`DEC-114`/`DEC-115`), the
   correction/reversal wiring (`DEC-116`), the reversal gate (`DEC-117`),
   the settlement netting (`DEC-118`) and the operator-driven daily close
   (`DEC-119`) — all delivered, per their decision rows and handoffs. The
   recorded follow-ups (posture gaps listed above) remain open, not silently
   deferred.
4. **Receipt→ledger wiring — the lead item, gated:** on the **OPS receipt
   destination `storage_area_id` policy** (a recorded owner input). If it has
   not landed it stays blocked; do not resolve the policy silently
   (`post-stock-movement.ts`; `docs/BUILD_ROADMAP.md` §5 slice-8 entry).
5. **Owner/OPS/data inputs** (gate the remaining roadmap items): the OPS
   `storage_area_id` policy; the FIN variance-tolerance thresholds; the
   privacy-review retention periods per file class; history/grain quality (I11);
   the deployment prerequisite inputs; the six golden-fixture signatures; the
   **WF-003 self-assignment login model**; the **`DEC-102`/`DEC-103`/`DEC-104`
   provisional items**.
6. **Test-deployment rehearsal** (`docs/runbooks/deployment.md`) — staging first
   with sanitized/synthetic data only; parked on the deployment prerequisite
   inputs.
7. **Golden-fixture sign-off** — the six fixtures are prepared as machine-readable
   JSON under `tests/fixtures/` (`DEC-065`); finance + product owner sign (the
   "verified" gate); `I8`/`I9` still gate the real rates behind them.
8. **Rows 15–18 and the competitor/planning waves** — competitor manual
   observations landed in the completion programme (see the decisions rows);
   rows 15–18 remain blocked (data / `ADR-0009`–`0011`).

## Open decisions / inputs (do not block development)

Full detail for each item lives in its slice's handoff file and in
`docs/BUILD_ROADMAP.md` §5. Recorded, not decided — do not resolve silently.

- **Row 13 (provisional, awaiting owner/OPS):** `DEC-105` (13a) — the status
  machine has `open` unreachable through the API; the close **list** route is not
  location-filtered (the recorded systemic location-scope gap) while
  `[id]`/begin/lock enforce the location scope; the access reading
  (`front_of_house`/`analyst` included on read, `kitchen`/`purchasing` excluded,
  company-scope writes and reopen narrowed) is provisional. `DEC-107` (13b) —
  the prerequisite rule is **provisional** (which reconciliation/import statuses
  block a close was not defined by any decision); `data_quality_exception` and
  the tolerance existence are informational only (no period/location column);
  a `location` close cannot enforce scope (`scopeLimited: true`); there is no
  override/force path; the snapshot is `schemaVersion: 2`. `DEC-106` (13b) —
  `adjustment_period` has one open window per organization, no reopen, and
  `daily_close` is **deferred**; the correction-posting wiring has since been
  delivered (`DEC-116`) together with the `DEC-028`
  downstream-reconciliation gate (`DEC-117`), and the daily (location, day)
  close is now exposed operator-driven (`DEC-119` — the `/close` register
  UI; the standalone `daily_close` table stays deferred as redundant with a
  `scope_type='location'` `period_close`). The `DEC-027` interaction with
  reversal/payroll regeneration stays open.
- **Correction/reversal posting (provisional, awaiting owner/FIN):** `DEC-116`
  — full negation only (no partial/delta correction); reversal is
  rejection-not-replay; no approval workflow and no `adjustment_period` link
  (persisting a reason or period link would need a migration); gating the
  exported `reverseSalesLine` primitive is a recorded follow-up. `DEC-117` —
  the gate blocks outright with no override/approval path, only when a
  `locked` period close or a `within_tolerance`/`resolved`/`approved`
  reconciliation covers the parent transaction's date (`pending`/`exception`
  do not block), organization-wide by period because `reconciliation` has
  no location or channel (channel-precise matching and the override path are
  recorded follow-ups). `DEC-118` — the settlement reconciliation is now
  line-derived and a re-run refreshes the amounts as well as the status
  (superseding the creation-time-facts convention for this command), so a
  re-run can change the `DEC-117` reversal gate's verdict for the period
  (recorded, not silent); the transaction-only channel attribution and the
  no-backfill/no-automatic-re-evaluation posture are deliberate; deferred:
  recomputing the header at posting time, a channel-precise predicate, a
  persisted reversal-effect record.
- **Row 13c/13d reporting (provisional, awaiting owner/OPS):** `DEC-108` (13c) —
  reporting is **on-demand, not materialized** (`ADR-0007`'s MV-vs-incremental
  and the 15-minute refresh stay open, the job layer gated on `ADR-0004`); net
  sales prefers the imported `net_amount`; cost is **ingredient-only**
  (ledger-derived) so contribution is **before labour/fees** and **full cost is
  not reported** — the cost-card composition assembler is built (`DEC-111`) and
  three of its four component resolvers now exist (`DEC-112`); the `RPT-003` normalized measures are
  undefined (totals only);
  `product.category` is free text; read access is provisional.
  `DEC-109` (13d) — menu-engineering thresholds are **computed medians** only
  (no Star/Puzzle labels, no approved-target rule), `option_kind='included'`
  excluded from popularity units, no add-on roll-up, and labour/fees/overhead/
  forecast-reliability/strategic-role have no per-product attribution. The
  row-11 mapping writer is now delivered (`DEC-113`), so
  `sales_line.product_variant_id` is populated at import time; historical
  rows keep the **no-backfill** posture (they resolve by SKU/
  `external_mapping` at read time; the demo variant seed / `external_mapping`
  lookup index remain deferred). 13d also records: waste annotations are
  **`moving_average`-only** (`DEC-068`), and that filter also excludes
  non-`moving_average` events from the **quantity** sum (inert while those
  methods are unimplemented); `waste_event.currency` is not cross-checked
  against the hard-coded NOK; the waste read has no covering index (a future
  index review); and the top-level `threshold.contribution.value` is `null` by
  design (category-relative — each row carries its own threshold).
- **Row 13e/13f `RPT-004` operations (provisional, awaiting owner/OPS):**
  `DEC-110` — stock value is point-in-time ledger Σ (not the `stock_balance`
  projection); stock variance **value** is the **booked** adjustment value
  (Σ `value_delta` where `source_type='stock_count'`), **not** `variance_qty ×
cost` (the `DEC-067`/`DEC-008` valuation is asymmetric); the waste reasons axis
  is the closed `DEC-018` **`stage`** vocabulary (free-text `reason_code` is not
  the axis — a closed reason vocabulary is deferred); waste value is
  `moving_average`-only with item-only events included and unit-blind quantity;
  flow windows are half-open `[from,to)` while `sumWasteByProductVariant`
  (RPT-005) stays inclusive; production yield reports both figures over
  `actual_finish`; `stock_turn`, multi-currency, `DEC-028` reversal pairing and
  item→product attribution remain deferred; no covering index for the new reads
  (a future index review); read access per `DEC-108`.
- **Cost-card component resolvers (provisional, awaiting owner/OPS/FIN):**
  `DEC-112` — direct-labour minutes per batch, valued at the effective
  `labor_rate` for the `recipe_version.labor_cost_center_id`/
  `labor_role_code` pair and divided by `approved_usable_output`;
  `channel_fee_rule` percentage kinds on `gross_price`/`net_price` per
  `fee_basis`, fixed kinds via `perUnitFixedFee` (the order-size allocation a
  recorded `[PROPOSED]`); `ALLOCATION_DENOMINATOR_SOURCE` closes the
  free-text denominator (`explicit`, `eligible_products`, `equal_share`,
  `revenue`, `transactions`, `sales_units`); `explicit`/`eligible_products`/
  `equal_share` and the three sales-derived volume denominators are
  implemented (`DEC-114`) — the `production_*`/time denominators
  (`production_hours`/`production_minutes`/`recorded_time`/`operating_hours`)
  still **fail closed** (no driver authority yet), and the org-wide volume
  scope for `organization`/`company_wide` rules is a recorded `DEC-114` gap.
  Still deferred: the
  `other_variable_cost` source; a DB CHECK for `denominator_source`;
  per-channel packaging; the cost-card version chain; the per-item
  cost-selection override; the period-overlap operating-cost read; a
  cross-currency guard; partial-window proration and
  `behavior` filtering (recorded in `DEC-115`); the
  golden-fixture sign-off.
- **Cost-card composition assembler (provisional, awaiting owner/OPS):**
  `DEC-111` — the recipe version is the effective `product_recipe_assignment`
  (an explicit `recipeVersionId` must agree or stands in; both missing rejected);
  ingredient/packaging/sub-recipe assembled via `computeRecipeCost` (a
  sub-recipe's internal packaging lands in the ingredient bucket);
  `unitNetSales` from the exact-scope effective `price_version.netPrice` (a
  missing or negative value rejected); **direct labour, channel variable cost,
  other variable cost and allocated unit overhead are explicit validated inputs**
  (default `0.0000`, provenance recorded) — at `DEC-111` time because the
  resolvers did not exist; `DEC-112` now resolves three of the four (resolved
  wins over explicit; `otherVariableCost` stays an explicit input; see the
  `DEC-112` bullet above). `COST_CARD_WRITE_ROLES`
  (incl. `kitchen`) is provisional; no price-version scope fallback (a recorded
  `DEC-077` open point); the cost-card version chain, the per-item cost-selection
  override and the golden-fixture sign-off remain open.
- **Row 14 (provisional, awaiting owner/OPS):** `DEC-104` — the "remaining
  planned shifts run as scheduled" assumption is **not** implemented (only
  `{assigned, completed}` shifts count, so a pre-month-end payroll report
  under-counts — the biggest open item); base vs loaded hourly rate;
  `currency` hard-coded `NOK`; `draft` unreachable through the API; the
  `DEC-027` period-lock interaction; working-time retention; application-layer
  audit only; `location_manager` deliberately excluded from payroll read/write
  (matrix None) while the worked-hours report grants it. `DEC-103` — single-stage
  adjustment approval (actor is approver); `analyst` excluded from worked hours
  ("Aggregate" unimplemented); worked-hours report not persisted. `DEC-102` —
  provisional shift state machine; manager-assignment only, self-assignment
  deferred pending the **WF-003 self-assignment login model**; `created_by`
  convention; multi-assignment with no headcount invariant; list orderings not
  fully index-covered; `role_code` free text.
- **Workflow platform (`DEC-094`/`DEC-101`):** 12 clarifications — free-text
  `task.type`/`priority`; no `task_status` transition guard; nullable
  `approval.decision` while pending; decide-once; plain-uuid actors; polymorphic
  targets; no `task.location_id`; **access unset** (no `task`/`approval` matrix
  row); no task↔approval link (`HMS-001` conflict); `job`/outbox gated on
  `ADR-0004`.
- **Staff document library (`DEC-088`/`DEC-100`):** `document` has no location
  column, so `DOC-001`'s "at authorized locations" is unenforceable;
  acknowledgement retention period (privacy review); no un-archive; storage path
  deferred (`DEC-085`); `file_object` has no application port; `reviewer-glm`
  coverage gaps.
- **`employee` + personnel documents (`DEC-087`/`DEC-099`):** `WF-007` upload/
  replace **and retention** not implementable while the storage path is deferred;
  no version model (`supersedes_id` chain is the upgrade path); `role_code` no
  CHECK; `employee.cost_center_id` a plain uuid; no un-retire/delete; provisional
  NULL-`primary_location_id` fail-closed rule; location scope enforced in the web
  layer only; fake vs Postgres collation ordering.
- **HMS (export `DEC-093`/`DEC-098`, equipment `DEC-092`/`DEC-097`, checklists
  `DEC-091`/`DEC-096`, incidents `DEC-090`/`DEC-095`, monitoring `DEC-089`):**
  no DB-side location push-down in the export (per-source cap applied org-wide
  then filtered, flagged via `truncated`); no personal-data
  minimization/redaction; bundle not persisted (no retention class);
  `analyst` partial bundle unimplemented; regulator-final format later; period
  choices provisional; `maintenance_log`/`corrective_action` have no
  `location_id`; `equipment.kind` free text; `maintenance_log` immutability only
  in the repository; no checklist completeness rule / per-item evidence /
  failed-item→action link; jsonb 500-element ceiling provisional; `HMS-007` vs
  `DEC-093` export-scope conflict; `HMS-001` task/approval-link conflict.
- **Standing systemic:** the **systemic location-scope gap** (most routes do not
  pass `locationId` to `isAuthorizedFor`; HMS monitoring routes are the first to
  enforce it); the **`writeAudit` transaction binding** (closes over the parent
  `db`); the **driver-error→500 mapping** (a bad FK/check id → 500 instead of
  400/404; the root-cause fix belongs in `apps/web/lib/http.ts`'s `mapErrors`);
  the `notes`-amendment audit trail; duplicate readings at the same instant are
  intentional.
- **Row 11 import framework:** sales/consumption grain ambiguity (`DEC-009`
  daily-per-location vs a single `sales_line` source); the five deferred file FKs
  and the `file_object` immutability/soft-delete posture; the storage integration
  (Spaces client / signed URLs / retention enforcement).
- **Row 12 sales/reconciliation:** consumption grain A1; the legacy I19 import
  carries no resolvable `location_id` (demo theoretical consumption posts zero
  recipe-bearing lines); I1 channel/SKU confirmations.
- **Price-version scope resolution is exact-scope only:** no company-wide
  (`null` location/channel) → specific fallback in `findEffectivePriceVersion`;
  whether a fallback hierarchy is wanted is an owner/TECH decision (`DEC-077`).
- **Slice-9/10 owner questions:** output-cost allocation across multiple
  outputs/by-products; variance-tolerance thresholds; work-in-progress/source-draw
  storage area; `production_plan` line/quantity model + status vocabulary;
  lot-tracked cross-location transfer policy; per-source stock reversal semantics
  (`DEC-028`, stock variant not implemented); receipts not wired to the ledger;
  `DEC-009` daily theoretical consumption not implemented.
- **Slice-8 stock ledger:** per-source reversal semantics not enumerated; the
  sales-line side of the `DEC-028` "reversal blocked when reconciled
  downstream" gate is delivered (`DEC-117`); the stock-variant reversal
  remains unimplemented;
  `stock_balance` written directly while the runbook calls it a rebuildable
  projection (confirm the writer policy before multi-instance use); no
  application surface creates `location` rows; the `DEC-010` negative-override
  role set is fail-closed (which roles should grant it — `DEC-066`).
- **Slice-7:** the 16 cost-card/pricing open (owner) points, tracked in
  `docs/BUILD_ROADMAP.md` §5.
- **Slice-6 deferrals:** how `cost_pool` derives from `operating_cost` (an
  application convention, needs an owner rule); `allocation_rule.denominator_source`
  free text; `scope_type` shared vocabulary; the `asset` register deferred;
  imputed owner labour awaits I8 remainder / I9.
- **Slice-5 ambiguities:** per-line then recipe-level yield loss; same-instant
  cost-source tie rejected; `recipe_version` quantities carry no unit;
  `yield_rate` derived never input; `recipe_version_no_overlap` ungated;
  `planned_output_qty` unused by the §6 formula.
- **Deployment prerequisite inputs (owner; before any real `apply`):**
  `ADR-0004` acceptance; a scoped `DIGITALOCEAN_TOKEN`; a provisioned private
  Spaces state bucket + credentials; the sanitized-data owner; the legacy
  instance-slug/manual-scaling check; domain names (optional). First real `apply`
  must be **staging** with sanitized/synthetic data only. Required pre-apply:
  `infra/bootstrap/database-grants.sql` once as `doadmin`.
- **External inputs still outstanding:** supplier costs/receipts (I4), recipes +
  yields (I5), productive-hours % (I8 remainder), opening counts (I7), Frontline
  data-shape confirmations. See `docs/phase0/SOURCE_DATA_REQUEST.md` and
  `docs/phase0/UNBLOCK_CHECKLIST.md`.
- **Golden fixtures:** the six must be **signed** before any Phase 1 cost is
  treated as "verified".

## How to verify / environment

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
npm run lint && npm run typecheck && npm run test && npm run build && npm run format:check
```

Runtime stubs (each prints its start line and exits 0 after one tick; the worker
and scheduler ticks pass only when `DATABASE_URL` is set):

```bash
DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela WORKER_TICKS=1 npm run start --workspace @aquarela/worker
DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela SCHEDULER_TICKS=1 npm run start --workspace @aquarela/scheduler
```

Environment note: `docker` and `terraform` are **not on PATH** in this
environment — the container build and credentialed Terraform steps cannot be run
here (the Terraform offline validation was run from a downloaded 1.16.3 binary).

Local PostgreSQL 16 and migrations (the wrapper takes advisory lock `8675309`;
`DATABASE_MIGRATIONS_URL`, when set, wins over `DATABASE_URL`):

```bash
docker compose up -d postgres         # local PostgreSQL 16 on localhost:5432
DATABASE_MIGRATIONS_URL=postgres://aquarela:aquarela@localhost:5432/aquarela npm run db:migrate
```

Container (`docker` at /usr/local/bin/docker):

```bash
docker build -t aquarela-web .
docker run --rm -p 3000:3000 aquarela-web
curl -s localhost:3000/api/health    # {"status":"ok"}
```

Schema generate/apply and recovery are documented in
`docs/runbooks/persistence-migrations.md`.

Terraform (binary pinned by `.terraform-version`; validated locally with
Terraform 1.16.3 darwin_arm64). The S3/Spaces backend is deliberately partial,
so offline validation uses `-backend=false` (a real `init` supplies the bucket
and keys via `-backend-config` or the environment):

```bash
cd infra && terraform fmt -check -recursive
cd envs/staging && terraform init -backend=false && terraform validate
DIGITALOCEAN_TOKEN=dop_v1_dummy terraform plan -refresh=false -lock=false -input=false -var-file=staging.tfvars
# same three for envs/production with production.tfvars
```

`terraform plan` works offline with a dummy token (no API calls with
`-refresh=false`). If the backend block is present, `init -backend=false`
followed by `plan` reports "Backend initialization required"; run the offline
plan from a **scratch copy with `backend.tf` removed** (or a local backend
override) rather than mutating the repo — never run `apply` in this state. A real
`init` supplies `bucket` and Spaces credentials via `-backend-config` /
`AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`; the state bucket itself must be
created out of band first (see `docs/runbooks/deployment.md`).

## Handover archive

`docs/handoffs/` holds the extracted history that used to live in this file:

- `README.md` — the index of all per-slice handovers, newest first.
- `NNN-YYYY-MM-DD-*.md` — one verbatim work-log entry per slice (commits,
  verification, review reconciliation), numbered chronologically (`001` oldest).
  Newest: `080-2026-09-24-w7-ui-refinement-wave.md`.
- `reversibility-log.md` — the per-slice commit list, migration down paths and
  ledger-row rollback notes.
- `context-sections-archive-2026-09-22.md` — the pre-refactor `Resume here`,
  `Current status`, `Next up` and `Open decisions / inputs` sections, verbatim.

## Reversibility

Every change must be revertible or carry a documented recovery path (Rule 2).
The per-slice commit inventories, migration down paths and DB rollback steps are
in **`docs/handoffs/reversibility-log.md`**; each slice's handoff file repeats
its own rollback approach. Standing rules: prefer small atomic commits each
independently revertible; never rewrite history or force-push; migrations follow
expand → migrate → contract with a rehearsed down path; financial/stock facts are
append-only (reversals, not edits); external writes require a documented rollback
and per-source approval (`DEC-015`).

## Update protocol

1. Add a dated entry at the top of the work log — date, session focus, what
   changed, how it was verified, what comes next, and the rollback approach.
2. Write that entry to **`docs/handoffs/NNN-YYYY-MM-DD-<slug>.md`** (next
   sequence number, verbatim as the work log entry) and add it to the top of
   `docs/handoffs/README.md`. Add its commit list / down path to
   `docs/handoffs/reversibility-log.md`.
3. Rewrite the **`Resume here (next session)`** section of this file for the new
   next step — self-contained and executable without questions. Do this at the
   end of **every** session, even small or docs-only ones; if there is no next
   step or it is blocked, say so explicitly and name the blocker.
4. Update **Current status** (including git HEAD), **Next up** and **Open
   decisions / inputs** in the same pass, and note any new open inputs.
5. When the user says **"resume the work"** (or "resume"), read the `Resume here`
   section and continue from it without re-asking for context.

Keep this file lean: live orientation and the next step only. Per-slice history
belongs in `docs/handoffs/`. Handoffs and context live in this repo only — never
write them to a temp directory or any path outside the repository.
