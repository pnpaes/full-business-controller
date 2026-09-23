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
continue from this section alone. (Rewritten by the 2026-09-23 cost-card
component-resolvers session.)

**State:** `main`; HEAD before the next docs commit is **`8bf8c71`** (the
`feat(web)` commit of the resolver slice). The resolvers landed as **`8cf86c9`**
`docs(decisions)`, **`bfb1a07`** `feat(domain)`, **`fb081ef`**
`feat(persistence)`, **`7748969`** `feat(application)`, **`8bf8c71`**
`feat(web)` — plus this `docs(context)` handoff. Nothing pushed; nothing
applied to DigitalOcean. Schema: migrations through **`0062`**; **89 tables**
(no new table); next free decision id **`DEC-113`** (`DEC-112` is recorded and
implemented). Baseline with `DATABASE_URL`:
**3547/3547 tests** (233 files). Handoff: `docs/handoffs/071-…md`. **The cost-card
component resolvers (three of four) are delivered**: `directLaborCost`,
`channelVariableCost` and `allocatedUnitOverhead` can now be resolved from
production data (`otherVariableCost` stays an explicit input).

**Next task — the row-11 import mapping writer.** The row-11 importer commits
`sales_line` rows but never writes `sales_line.product_variant_id`, so the
13c/13d variant chain (`product_variant_id → sku → external_mapping →
unmapped`) resolves products by sku only; the contract (`DEC-108`/`DEC-109`)
makes the mapping writer the lead sub-task so product labels are real. Build a
committed import path that resolves each sales line to a product variant — by
`product_variant.sku` when it matches, otherwise via `external_mapping`
(data-source, external id, exact scope, effective window) — and writes
`sales_line.product_variant_id` at import time, leaving unmappable lines
`null` (they keep resolving through the `unmapped` bucket). Preserve the
existing defaults: net-sales preference, partial posting (`DEC-025`), mapping
conflicts blocked for review (`DEC-033`) and approved superseding mappings
with effective dates.

**Scope (do):** read this file, `docs/handoffs/071-…md`, `DEC-108`, `DEC-109`,
`DEC-033`, `DEC-025` and the row-11 decisions (`DEC-080`–`DEC-085`),
`docs/phase0/CALCULATION_CONTRACT.md` §3, the variant-resolution chain in
`packages/application/src/reporting/**` and `sales` reads, the import posting
path (`packages/application/src/imports/**`) and the `product_variant`/
`external_mapping` schema first; keep changes additive, decimal-only, in the
existing package boundaries, with a `.test.ts` for the resolver branches
(sku-hit, mapping-hit, miss) and commit in layers with the rollback approach
in the body (Rule 2).

**Scope (do not):** do not rewrite the specification inputs or re-model the
row-11 framework; do not invent a mapping policy beyond `DEC-033`'s
conflict/approval rules (ambiguous external ids stay conflicting rows, never
auto-resolved); do not backfill historical `sales_line` rows unless a
provisional decision records the backfill posture; do not touch the deferred
file FKs or the storage integration (`DEC-085`); do not deploy or write
externally (`DEC-015`); do not resolve any recorded open input silently.

**Acceptance / verification:** `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh";
nvm use 22`; then `npm run typecheck`, `npm run lint`, `npm run test` (with
`DATABASE_URL` — current baseline **3547/3547**, 233 files), `npm run build`,
`npm run format:check`, `npm audit --omit=dev` = 0; `db:migrate` a no-op
(expected: no migration unless the provisional decision needs one). Commit in
layers with the rollback approach in the body (Rule 2).

**Open decisions/inputs that shape it:** the per-source mapping write policy is
provisional and must be recorded (next free id `DEC-113`) before or with the
implementation — including whether historical rows are backfilled (the
decision posture above defaults to no backfill); sales/consumption grain
ambiguity (`DEC-009` daily-per-location) is not affected. Do not resolve I11,
the OPS policy, `DEC-077` or any other recorded open input silently.

**Alternatives (named in the previous `Resume here`):** the deferred
volume-based denominators from `DEC-112` (`revenue`, `transactions`,
`sales_units`, `production_*` — failing closed, needing the period-scoped
sales read wiring); the deferred close follow-ups (correction-posting wiring
`DEC-028`/`DEC-073`, `daily_close`); the **receipt→ledger wiring** once the OPS
`storage_area_id` policy lands.

**Step after:** the deferred `DEC-112` close-outs (volume-based denominators,
`denominator_source` DB CHECK, per-channel packaging, the cost-card version
chain, the per-item override, recurrence→period normalisation) or the row-11
backfill posture once decided; the deferred close follow-ups (`DEC-028`/
`DEC-073` correction wiring, `daily_close`); the test-deployment rehearsal and
golden-fixture sign-off (both parked on owner inputs).

**Programme direction (standing user instruction):** proceed autonomously, in
continuous sequence — parallel background agents → adversarial review + fixes →
concise status/documentation → commit → next task. Global ruleset
(`~/.config/kilo/AGENTS.md`): compact context at 25 %; pausing is permitted
above USD 20 at a clean point (committed, verified, documented).

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
14a shifts, 14b-1 worked hours, 14b-2 payroll report), which is **complete**.

Per-slice detail, commits and reconciliation are in `docs/handoffs/`.

## Where things live

- `00_README.md` … `13_AGENT_BUILD_BRIEF.md` — the specification package
  (inputs, rarely edited). Start with `00_README.md`.
- `12_OPEN_DECISIONS.md` — the accepted decisions (`DEC-001`…`DEC-104`); the
  authority. New decisions are appended here (next free id `DEC-113`).
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

- **As of:** 2026-09-23 — branch `main`; the cost-card component-resolvers
  slice is committed (`8cf86c9`…`8bf8c71`, plus this `docs(context)` handoff).
  Lineage and full per-slice detail:
  `docs/handoffs/README.md` and the files it lists.
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
  workstream (qwen/minimax/glm) → no blockers after fixes. `daily_close` and the
  correction-posting wiring stay deferred.
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
- **Schema:** migrations through **`0062`**; **89 tables** (all additive, tested
  down paths). Next free decision id **`DEC-113`** (`DEC-108`–`DEC-112` are
  committed).
- **Verification (2026-09-23, at the component-resolvers tree):** `typecheck`,
  `lint`, `format:check`, `build` clean; **3547/3547 tests with `DATABASE_URL`**
  (233 files); `npm audit --omit=dev` = 0; `db:migrate` through `0062` a no-op
  on re-run; 89 public base tables. (One full-suite run mid-session failed a single
  test that did not reproduce across three subsequent runs; recorded in
  `docs/handoffs/069-…md` for CI watchfulness.)
- **Not yet built:** the row-11 import mapping writer (`sales_line.product_variant_id`
  is never written — the variant chain resolves by sku meanwhile); the deferred
  `DEC-112` items (the `other_variable_cost` source; the volume-based
  denominators `revenue`/`transactions`/`sales_units`/`production_*`, which
  fail closed; a `denominator_source` DB CHECK; per-channel packaging; the
  cost-card version chain; the per-item cost-selection override; the
  period-overlap operating-cost read; recurrence→period normalisation and
  `behavior` filtering); the deferred `daily_close` and
  the correction-posting wiring (`DEC-028`/`DEC-073`); the receipt→ledger wiring
  (gated on the OPS destination `storage_area_id` policy) and rows 15–18
  (blocked: data / `ADR-0009`–`0011`). The deferred file FKs
  (`goods_receipt.evidence_file_id`, `cost_observation.receipt_file_id`,
  `operating_cost.evidence_file_id`, `settlement.source_file_id`,
  `waste_event.photo_file_id`) stay plain uuids — `file_object` exists
  (`DEC-085`, migration `0035`) but has no application port.
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

1. **Row 13 — close + dashboards + menu engineering — COMPLETE.** The close
   half: 13a `period_close` (`REC-003`, `REC-006`, `DEC-027`, `DEC-105`,
   migrations `0057`/`0058`) and 13b prerequisites + `adjustment_period`
   (`REC-005`, `DEC-106`/`DEC-107`, migration `0059`), committed
   `415297b`…`956ceb6`. The reporting half: 13c sales & margin (`RPT-001`–`003`,
   `FND-006`, `DEC-108`), 13d menu engineering (`RPT-005`, `DEC-109`) and
   13e/13f `RPT-004` operations (`DEC-110`) — all no-migration. **The cost-card
   composition assembler is delivered** (`DEC-111`, `182342b`…`0ee79f7`)
   **and three of the four component resolvers** (`DEC-112`,
   `8cf86c9`…`8bf8c71`) — direct labour, channel variable cost and allocated
   overhead now resolve from production data; `otherVariableCost` stays
   explicit. **Next: the row-11 import mapping writer** (populate
   `sales_line.product_variant_id` so product labels are real), then the
   deferred `DEC-112` close-outs and the deferred `daily_close`/correction
   wiring.
2. **Receipt→ledger wiring — the lead item, gated:** on the **OPS receipt
   destination `storage_area_id` policy** (a recorded owner input). If it has
   not landed it stays blocked; do not resolve the policy silently
   (`post-stock-movement.ts`; `docs/BUILD_ROADMAP.md` §5 slice-8 entry).
3. **Owner/OPS/data inputs** (gate the remaining roadmap items): the OPS
   `storage_area_id` policy; the FIN variance-tolerance thresholds; the
   privacy-review retention periods per file class; history/grain quality (I11);
   the deployment prerequisite inputs; the six golden-fixture signatures; the
   **WF-003 self-assignment login model**; the **`DEC-102`/`DEC-103`/`DEC-104`
   provisional items**.
4. **Test-deployment rehearsal** (`docs/runbooks/deployment.md`) — staging first
   with sanitized/synthetic data only; parked on the deployment prerequisite
   inputs.
5. **Golden-fixture sign-off** — the six fixtures are prepared as machine-readable
   JSON under `tests/fixtures/` (`DEC-065`); finance + product owner sign (the
   "verified" gate); `I8`/`I9` still gate the real rates behind them.
6. **Rows 15–18** — blocked (data / `ADR-0009`–`0011`).

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
  `adjustment_period` has one open window per organization, no reopen, and the
  correction-posting wiring (`DEC-028`/`DEC-073`) and `daily_close` are
  **deferred**. The `DEC-027` interaction with reversal/payroll regeneration
  stays open.
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
  forecast-reliability/strategic-role have no per-product attribution.
   is implemented, but the row-11 importer still never writes
  `sales_line.product_variant_id`, so the **mapping writer** remains the lead
  sub-task for real product labels. 13d also records: waste annotations are
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
  free-text denominator (`explicit`, `eligible_products`, `equal_share`) with
  only those three implemented — the volume-based denominators
  (`revenue`/`transactions`/`sales_units`/`production_*`) **fail closed**
  pending the period-scoped sales read wiring. Still deferred: the
  `other_variable_cost` source; a DB CHECK for `denominator_source`;
  per-channel packaging; the cost-card version chain; the per-item
  cost-selection override; the period-overlap operating-cost read; the
  recurrence→period normalisation and `behavior` filtering; the
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
  `DEC-028` "reversal blocked when reconciled downstream" gate deferred;
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
