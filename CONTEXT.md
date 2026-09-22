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
continue from this section alone. (Rewritten by the 2026-09-22 row-13d
menu-engineering session.)

**State:** `main`; HEAD before the row-13d slice was **`4f77c0c`** (the row-13c
handoff). Row 13d lands as **`af2b81c`** `feat(domain)`, **`b360c82`**
`feat(persistence)`, **`eb6dbb6`** `feat(application)`, **`7f7dfc7`**
`feat(web)`, plus this `docs(context)` handoff. Nothing pushed; nothing applied
to DigitalOcean. Schema: migrations through **`0059`**; **89 tables**; next free
decision id **`DEC-110`**. Baseline with `DATABASE_URL`: **3324/3324 tests**
(219 files). Handoff: `docs/handoffs/068-…md` (13d), `066-…md`/`067-…md` (13c).
**Row 13's close half (13a + 13b) and its dashboards + menu-engineering half
(13c + 13d) are complete**; only `RPT-004` remains of the row-13 reporting set.

**Next task — `RPT-004`: stock value/variance, production yield and waste
value/reasons reporting.** The last `RPT` item. Reuse the reporting read model
where possible (`packages/application/src/reporting/`); the facts are
`stock_balance`/`stock_movement` (value/variance, as-of), `production_batch`
input/output variance (yield) and `waste_event` (value/reasons — note the
`DEC-068` moving-average-only valuation and the item→product attribution gap).
It is **data-gated on I11** (history/grain quality) — build over synthetic
fixtures. Alternatives: the **cost-card composition assembler** (unblocks the
contract's full `unit_variable_cost`/`unit_full_cost`, which would let the
row-13c/d reports show real contribution and full cost); the deferred close
follow-ups (correction-posting wiring `DEC-028`/`DEC-073`, `daily_close`); the
**receipt→ledger wiring** once the OPS `storage_area_id` policy lands; the
row-11 **import mapping writer** (so `sales_line.product_variant_id` is
populated — the variant chain resolves by sku meanwhile). Do not resolve I11, the
OPS policy or any recorded open input silently.

**Objective:** the `RPT-004` stock/production/waste reporting deliverables per
the existing package boundaries — metric definitions once in domain/application,
not in dashboard SQL (`ADR-0007`), decimal-only, with scope and freshness
displayed (`FND-006`) and a drill-down path to records (`RPT-002`), over
synthetic fixtures.

**Scope (do):** read this file, `docs/handoffs/068-…md`/`066-…md`,
`RPT-004`/`RPT-002`/`FND-006` in `11_REQUIREMENTS_CATALOG.md`,
`docs/adr/0007-reporting-aggregates.md`, `04_CALCULATIONS.md` §4.8,
`CALCULATION_CONTRACT.md`, `DEC-032`/`DEC-063`/`DEC-068` and
`docs/BUILD_ROADMAP.md` §1/§4 first; keep changes organization-scoped
(`DEC-061`), additive, decimal-only, with a rehearsed down path for any
migration, `EXPECTED_TABLES` updated, a `.test.ts` for new non-trivial logic, and
small atomic commits with the rollback approach in the commit body (Rule 2).

**Scope (do not):** do not invent a cost-card composition assembler or report
full cost/direct labour/channel fees (none is computable today — report
contribution before them, clearly labelled); do not build materialized
aggregates/MVs or a refresh job (`ADR-0004` still `Proposed`); append to
`12_OPEN_DECISIONS.md` only a new provisional decision (next free id `DEC-110`);
do not deploy or write externally (`DEC-015`); do not rewrite the specification
inputs.

**Acceptance / verification:** `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh";
nvm use 22`; then `npm run typecheck`, `npm run lint`, `npm run test` (with
`DATABASE_URL` — current baseline **3324/3324**, 219 files), `npm run build`,
`npm run format:check`, `npm audit --omit=dev` = 0; `db:migrate` a no-op. Commit
in layers (`feat(domain)`, `feat(persistence)`, `feat(application)`, `feat(web)`,
`docs(decisions)`, `docs(context)`) with the rollback approach in the body
(Rule 2).

**Step after:** `RPT-004` then the cost-card composition assembler (real
contribution/full cost); the deferred close follow-ups (correction-posting wiring
`DEC-028`/`DEC-073`, `daily_close`); the row-11 import mapping writer; the
receipt→ledger wiring once the OPS policy lands; the test-deployment rehearsal
and golden-fixture sign-off (both parked on owner inputs).

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
  authority. New decisions are appended here (next free id `DEC-110`).
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

- **As of:** 2026-09-22 — branch `main`; the row-13d slice is committed
  (`af2b81c`…`7f7dfc7`, plus this `docs(context)` handoff). Lineage and full
  per-slice detail: `docs/handoffs/README.md` and the files it lists.
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
- **Schema:** migrations through **`0059`**; **89 tables** (all additive, tested
  down paths). Next free decision id **`DEC-110`** (`DEC-108`/`DEC-109` are
  committed).
- **Verification (2026-09-22, at the row-13d tree):** `typecheck`, `lint`,
  `format:check`, `build` clean; **3324/3324 tests with `DATABASE_URL`**
  (219 files); `npm audit --omit=dev` = 0; `db:migrate` through `0059` a no-op on
  re-run; 89 public base tables.
- **Not yet built:** `RPT-004` (stock value/variance, production yield, waste
  value/reasons; `ADR-0007`; data-gated on I11 — synthetic fixtures); the
  cost-card composition assembler (which would make the contract's full
  `unit_variable_cost`/`unit_full_cost` computable); the deferred `daily_close`
  and the correction-posting wiring (`DEC-028`/`DEC-073`); the row-11 import
  mapping writer (`sales_line.product_variant_id` is never written — the variant
  chain resolves by sku meanwhile); the receipt→ledger wiring (gated on the OPS
  destination `storage_area_id` policy) and rows 15–18 (blocked: data /
  `ADR-0009`–`0011`). The deferred file FKs
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

1. **Row 13 — close + dashboards + menu engineering** — `ADR-0007` accepted
   (2026-09-20). **The close half is delivered:** 13a `period_close`
   (`REC-003`, `REC-006`, `DEC-027`, `DEC-105`, migrations `0057`/`0058`) and
   13b prerequisites + `adjustment_period` (`REC-005`, `DEC-106`/`DEC-107`,
   migration `0059`), committed `415297b`…`956ceb6`. **The reporting half is
   delivered:** 13c sales & margin (`RPT-001`–`RPT-003`, `FND-006`, `DEC-108`,
   `e79c88e`…`4f77c0c`) and 13d menu engineering (`RPT-005`, `DEC-109`,
   `af2b81c`…`7f7dfc7`), both no-migration. **Next:** `RPT-004` (stock
   value/variance, production yield, waste value/reasons) over synthetic
   fixtures — **data-gated** on history/grain quality (I11) — then the deferred
   `daily_close`/correction-posting wiring and the cost-card composition
   assembler.
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
  not reported** — the cost-card composition assembler is a prerequisite slice
  to schedule; the `RPT-003` normalized measures are undefined (totals only);
  `product.category` is free text; read access is provisional.
  `DEC-109` (13d) — menu-engineering thresholds are **computed medians** only
  (no Star/Puzzle labels, no approved-target rule), `option_kind='included'`
  excluded from popularity units, no add-on roll-up, and labour/fees/overhead/
  forecast-reliability/strategic-role have no per-product attribution.
  Variant resolution (`product_variant_id → sku → external_mapping → unmapped`)
  is implemented, but the row-11 importer still never writes
  `sales_line.product_variant_id`, so the **mapping writer** remains the lead
  sub-task for real product labels. 13d also records: waste annotations are
  **`moving_average`-only** (`DEC-068`), and that filter also excludes
  non-`moving_average` events from the **quantity** sum (inert while those
  methods are unimplemented); `waste_event.currency` is not cross-checked
  against the hard-coded NOK; the waste read has no covering index (a future
  index review); and the top-level `threshold.contribution.value` is `null` by
  design (category-relative — each row carries its own threshold).
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
