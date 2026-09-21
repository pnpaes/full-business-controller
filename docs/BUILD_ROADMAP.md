# BUILD_ROADMAP — ordered execution tracker

## 1. Purpose and authority

This file is a **derived execution tracker**: the single ordered view of the slices that
continue the build, across sessions. It is **not** the authority. `12_OPEN_DECISIONS.md`
and the accepted ADRs in `docs/adr/` govern (per `AGENTS.md` Rule 3); the specification
files (`00_README.md` … `13_AGENT_BUILD_BRIEF.md`) and `docs/phase0/` artifacts are the
requirements and data inputs. Where this roadmap and a decision, ADR or Phase 0 artifact
disagree, the decision/ADR/artifact wins and this file is corrected.

This file is **updated at the end of every slice** — statuses and the "current position"
line move with the work; `CONTEXT.md` keeps the narrative handoff and the immediate
`Resume here` section.

**Current position:** HEAD `a5c3db2` on `main` (nothing pushed; the working tree is
clean). Slice 0, auth slices 1a–1e, slices 2–10, row 11 (import framework +
external mappings), row 12 (sales + settlements + reconciliation), the
**price-version slice (`DEC-064`, PRICE-002/003)** and the **`DEC-078`
low-risk vocabulary/integrity open points** are `done` and committed;
`ADR-0007` and `ADR-0008` accepted 2026-09-20 (owner-delegated, revertible).
The `DEC-078` slice delivered (commits `3673633`, `ed93288`, `39d3364`,
`a5c3db2`): `settlement.status` constrained to `{received, paid, void}`
(default `received`); `reconciliation.scope_type` constrained to a new
`reconciliation_scope_type` `{import_run, sales_source, settlement,
supplier_invoice}` (migration `0028`, check constraints
`settlement_status_check`/`reconciliation_scope_type_check`, with
`assertReconciliationScopeType` rejecting an unknown scope before any write);
and a `lotTracked` item may no longer post a stock movement with a null
`lotId` (one guard in `postStockMovementInternal` covering all posting paths;
reversal stays exempt because it mirrors the original lot). Verification at
`a5c3db2`: `typecheck`, `lint`, `build`, `format:check` clean;
**1279/1279 tests with `DATABASE_URL`** (132 files); `npm audit --omit=dev`
0; `db:migrate` through `0028` is a no-op; the `0028` down path rehearsed;
64 tables. Programme direction: proceed autonomously, per task — parallel
background agents → adversarial review + fixes → document status and next
steps → commit → next task. **Remaining roadmap:** row 13 is
**data-gated** on history/grain quality (I11); row 14 is **owner-gated** on a
privacy review / access matrix; rows 15–18 remain blocked (data /
`ADR-0009`–`0011`) — so no roadmap slice is buildable from code alone without
owner inputs or real history. **Next unblocked task:** the
**cross-organization referential-integrity / deferred-FK hardening**
(`DEC-054` for `recipe_allergen.allergen_id`, `recipe_line.item_id`/
`sub_recipe_id`, and the `goods_receipt_line` composite FKs) using the
runbook's `NOT VALID` → `VALIDATE CONSTRAINT` pattern — a documented,
TECH-owned gap buildable without owner input (fallback if it hits a gate:
the `data_quality_exception` table, `DEC-066`'s interim replacement for
`stock_transfer.discrepancy_note`). Still owner/data-gated: the receipts→ledger
wiring, row 13, row 14, rows 15–18, the price-version scope-resolution
fallback and consumption grain A1. Next free decision id `DEC-079`.

## 2. The execution loop (per slice)

1. **Select** the next ready slice from §4 and cite its primary requirement IDs,
   decision IDs and ADR dependencies. If a cited ADR is still `Proposed`, stop at §3.
2. **Pre-flight**: read the authoritative docs named by the slice (see §4 refs) and run
   `npm run typecheck` before changing code.
3. **Design note** (short, in the session or commit body): commands/queries, authorization,
   states and error paths, migration/rollback.
4. **Implement** within the existing package boundaries — `packages/domain`,
   `packages/application`, `packages/persistence`, `apps/web` — with a `.test.ts` for new
   non-trivial logic (happy path + edge case), per `AGENTS.md` and the global test policy.
5. **Verify**: `npm run lint && npm run typecheck && npm run test && npm run build &&
   npm run format:check`, plus the slice-specific evidence (migration apply, fixture,
   reconciliation, drill-down).
6. **Adversarial review**, risk-scaled. Roster (global orchestrator instructions; pick the
   cheapest sufficient option first, never more than three concurrently): `reviewer-qwen`
   (`opencode-go/qwen3.7-plus`, default outside opinion), `reviewer-glm`
   (`opencode-go/glm-5.3-flash`, cheap code-level correctness), `reviewer-minimax`
   (`opencode-go/minimax-m3`, structural risk: schema/migration/rollback), `reviewer-ling`
   (`kilo/inclusionai/ling-3.0-flash-vl:free`, breadth only, rate-limited), `reviewer-kimi`
   (`opencode-go/kimi-k3`, expensive — only for cross-document or irreversible decisions).
   Trivial/mechanical change: 0 reviewers. Normal slice: 1 outside reviewer. Security,
   migration, schema or otherwise structural slice: 2 (e.g. `reviewer-qwen` +
   `reviewer-minimax`). Each reviewer states its model first, stays read-only, cites
   `file:line` or query evidence, and ranks findings blocker/major/minor.
7. **Reconcile** findings: record accepted fixes and declined items with the reason, so a
   later session can see why.
8. **Commit atomically** with the verification evidence and the rollback approach in the
   body (per `AGENTS.md` Rule 2). Never rewrite history or force-push.
9. **Rewrite** `CONTEXT.md`'s `Resume here`, status (including git HEAD), work log and open
   items before finishing.

## 3. Stop conditions / gates

Pause the loop and raise to the owner, recording it in `CONTEXT.md`, when any of these is hit:

- **Proposed ADR required by the slice.** The slice cites an ADR whose status is `Proposed`.
  (As of 2026-09-20 only `ADR-0009`/`ADR-0010`/`ADR-0011` remain `Proposed`; `ADR-0007` and
  `ADR-0008` are **accepted** 2026-09-20.) *Needed from owner:* the named decider
  accepts or amends it in `docs/adr/` (`Accepted` with date) before the slice is treated as
  settled. Slice 1 is the owner-directed exception: proceed and accept `ADR-0003` in
  parallel, without treating it as settled (`CONTEXT.md`).
- **Golden fixtures needed before a calculation is "verified".** *Needed from owner:*
  finance + product owner sign the six fixtures in `docs/phase0/GOLDEN_FIXTURES.md`
  (real supplier/recipe/labour data; I4/I5/I8 and the I9 accountant ruling). Until then the
  calculation is `illustrative` and must not be used for real decisions.
- **External source data or integration shapes missing.** I4 (costs), I5 (recipes/yields),
  I7 (opening counts), I8 remainder (productive hours, insurance, role→location) and the
  Frontline data-shape confirmations (item-level sales lines, channel/applied tax, SKU,
  on-sale representation). *Needed from owner:* the labelled source files requested in
  `docs/phase0/SOURCE_DATA_REQUEST.md` / `docs/phase0/UNBLOCK_CHECKLIST.md`. This gates
  validation and go-live, not the start of development (owner clarification, 2026-09-18).
- **External write or otherwise irreversible action.** *Needed from owner:* the per-source
  approval in `DEC-015`, a named credentials owner, and a documented, tested rollback
  (`AGENTS.md` Rule 2). Never perform it without both.
- **A decision would have to be invented.** *Needed from owner:* append the decision to
  `12_OPEN_DECISIONS.md` (next id `DEC-066`) — never resolve accounting, tax, valuation,
  privacy or system-of-record ambiguity in code (`13_AGENT_BUILD_BRIEF.md`).
- **Slice budget reached.** The session has completed its agreed slice budget. *Needed from
  owner:* confirm the next slice (or that work pauses); hand off via `CONTEXT.md`.

## 4. Ordered slice backlog

Phase and epic references are `10_DELIVERY_PLAN.md` §10.2 (phases) and §10.4 (epic
sequence). Requirement IDs are from `11_REQUIREMENTS_CATALOG.md`; decision IDs from
`12_OPEN_DECISIONS.md`; ADR filenames from `docs/adr/`. Status values are defined in §6.

| # | Slice | Phase / epic | Primary refs | Depends on | Owner gate | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Foundation, persistence core, deployment foundation | P0 / pre-epic | `ADR-0001`, `ADR-0002`, `ADR-0012`; `13` implementation steps 1–3 | — | none | done |
| 1a | Auth domain primitives (Argon2id, TOTP, recovery codes, tokens, lockout) | P1 / epic 1 | `FND-002`, `SEC-001`, `SEC-003`; `DEC-013`; `ADR-0003` (accepted) | 0 | none | done |
| 1b-i | Auth persistence layer (Drizzle client, repositories, TOTP counter migration) | P1 / epic 1 | `FND-002`, `FND-005`; `DEC-013`; `ADR-0003` (accepted) | 1a | none | done |
| 1b-ii | Auth application flow (authenticate, MFA, sessions, audit port/adapter) | P1 / epic 1 | `FND-002`, `FND-005`, `SEC-001`, `SEC-003`; `DEC-013`; `ADR-0003` (accepted) | 1b-i | none | done |
| 1b-iii | Password reset + access control (roles/location scope, admin operations) | P1 / epic 1 | `SEC-001`, `SEC-003`; `DEC-013`; `ADR-0003` (accepted) | 1b-ii | none | done |
| 1c | Auth HTTP surface (`/api/v1/auth`, session cookies, minimal login/2FA UI) | P1 / epic 1 | `SEC-001`, `SEC-003`; `DEC-013`; `ADR-0003` (accepted) | 1b-iii | none | done |
| 1d | TOTP enrolment + recovery codes (enrolment and recovery-code surface) | P1 / epic 1 | `SEC-001`, `SEC-003`; `DEC-013`; `ADR-0003` (accepted) | 1c | none | done |
| 1e | First-owner bootstrap + MFA enrolment HTTP surface | P1 / epic 1 | `SEC-001`, `SEC-003`; `DEC-013`; `ADR-0003` (accepted) | 1d | none | done |
| 2 | Units & catalog value objects (decimal money/quantity) | P1 / epic 2 | `FND-003`, `PROC-001`; `DEC-030` | 1 | none | done |
| 3 | Item + supplier pack + conversion + price | P1 / epic 2 | `PROC-001`–`005`, `PROC-008`, `COST-010`, `FND-008`, `FND-009`; `DEC-021`, `DEC-030`, `DEC-041`, `DEC-044`, `DEC-046` | 2 | none — I4/I6 data gates real values | done |
| 4 | Receipt + price history + landed cost | P1 / epic 3 | `PROC-002`–`005`, `PROC-008`, `COST-010`, `COST-012`; `DEC-047`; `CALCULATION_CONTRACT.md` §5 | 3 | none — I4 data gates real values | done |
| 5 | Recipes / sub-recipes / version / yield / allergens | P1 / epic 4 | `COST-001`, `COST-002`, `PROD-005`; `DEC-005`, `DEC-030`, `DEC-036`; `CALCULATION_CONTRACT.md` §6 | 3 | none — I5 data gates real recipes | done |
| 6 | Operating costs + labour + allocation | P1 / epic 5 | `COST-004`, `COST-006`, `COST-007`, `COST-011`, `COST-013`; `DEC-006`, `DEC-007`, `DEC-048`; `CALCULATION_CONTRACT.md` §7, §9 | 3 | none — I8 remainder + I9 ruling confirm loaded rates | done |
| 7 | Cost card + snapshots + price scenario + approval | P1 / epic 6 | `COST-005`, `COST-008`, `COST-009`, `PRICE-001`–`005`; `DEC-021`–`024`; `CALCULATION_CONTRACT.md`; `GOLDEN_FIXTURES.md` | 4, 5, 6 | six golden fixtures signed (A5) before "verified" | done |
| 8 | Stock ledger + balances + lots / storage | P1–P2 / epic 7 | `INV-001`–`003`, `INV-008`, `PROD-002`, `WASTE-002`, `COST-008`; `DEC-008`, `DEC-009`, `DEC-010`, `DEC-028`, `DEC-034`; `ADR-0005` (accepted 2026-09-20) | 3, 4 | none — `ADR-0005` **Accepted** (2026-09-20) | done (committed `b525f30`/`40e736b`/`c91e512`/`6c69f7f` with migrations `0017`–`0019`; verified 842/842 with `DATABASE_URL`) |
| 9 | Counts + transfers + waste | P2 / epic 8 | `INV-004`–`007`, `INV-009`, `WASTE-001`, `WASTE-002`; `DEC-017`, `DEC-018`, `DEC-029`, `DEC-066`–`DEC-068` | 8 | none — I7 opening counts gate the pilot | done (counts/transfers/waste application + `/api/v1` + screens + seeds + tests; persistence in `b525f30`, migration `0020`; verified 989/989 with `DATABASE_URL`) |
| 10 | Production planning + batches | P2 / epic 9 | `PROD-001`–`005`; `DEC-005`, `DEC-031`, `DEC-036`, `DEC-069`–`DEC-071` | 5, 8 | none | done (migration `0021`; domain `production.ts`; application `production/**` incl. atomic `completeProductionBatch`; web API + `/production` screens + seed; verified 1087/1087 with `DATABASE_URL` at the row-11 tree) |
| 11 | Import framework + external mappings | P3 / epic 10 | `SALE-002`, `SALE-004`, `SALE-007`, `SALE-008`; `DEC-025`, `DEC-033`, `DEC-035`, `DEC-041`; `ADR-0008` (accepted 2026-09-20) | 3 | none — legacy I19 as reference; I1/I15 Frontline shapes gate real profiles | done (committed — migration `0022` (`import_run`/`import_staging_row`/`external_mapping`), vocabularies `IMPORT_STATUS`/`MAPPING_STATE`/`IMPORT_POSTING_POLICY`, domain `sales-mapping.ts` (`resolveExternalEntity`, SKU-first then external id, both `DEC-033` conflict directions), application `imports/**` (create/stage/validate/map/dispose/preview + list/get), web `/api/v1/imports/**` + `(app)/sales/**` + `seed-imports.ts`; verified 1087/1087 with `DATABASE_URL`) |
| 12 | Sales + settlements + reconciliation | P3 / epic 11 | `SALE-001`–`011`, `PRICE-006`, `REC-001`–`006`; `DEC-026`, `DEC-035`, `DEC-040`, `DEC-042`, `DEC-043`, `DEC-045`; `ADR-0008` (**Accepted** 2026-09-20) | 8, 11 | none — `ADR-0008` accepted 2026-09-20 (inputs: I1 channel/SKU) | done (committed — migration `0023` (`sales_transaction`/`sales_line`/`settlement`/`reconciliation` + the `sales_line` branch in `stock_movement_source_guard`), vocabularies `RECONCILIATION_STATUS`/`OPTION_KIND`, domain `sales-consumption.ts` (recipe explosion + the `DEC-026` tolerance evaluator), application `sales/**` (`postImportRun`, `postTheoreticalConsumption`, list/get) + `reconciliation/**` (`reconcileImportRun`, `reconcileSettlement`, `resolveReconciliation`, list, `resolveTolerance`), web `/api/v1/sales/**` + `/api/v1/reconciliations/**` + `(app)/sales/**` screens (landing, transactions list/detail, reconciliation with resolve) + `seed-sales.ts`; verified 1186/1186 with `DATABASE_URL`) |
| 13 | Close + dashboards + menu engineering | P3 / epic 12 | `REC-003`, `REC-006`, `RPT-001`–`005`; `DEC-027`, `DEC-032`; `ADR-0007` (**Accepted** 2026-09-20) | 12 | data — history/grain quality (I11) | todo (data-gated — synthetic fixtures until real history) |
| 14 | Workforce: employees, shifts, worked hours, payroll-input report | P3 / epics 13–15 | `WF-001`–`006`; `DEC-012`, `DEC-037`, `DEC-038` | 1 | privacy review / access matrix approved (`SEC-003`) | blocked (owner) — note: owner-gated on the privacy review / access matrix |
| 15 | Forecasts / budgets / planning | P4 / epic 16 | `FCST-001`–`003`, `PLAN-001`–`003`; `DEC-011`, `DEC-019` | 12, 13 | clean history / grain measured (I11, `DEC-011`) | blocked (data) |
| 16 | Publishing integrations | P3 / epic 17 | `INTG-001`–`003`; `DEC-002`, `DEC-015`, `DEC-041`, `DEC-044`; `ADR-0011` (**Proposed**), `ADR-0008` | 3, 7, 12 | `ADR-0011` acceptance; per-source approval + named credentials owner (I18) | blocked (owner) |
| 17 | AI-assisted advisory | P4 / epic 18 | `FCST-004`; `DEC-039`; `ADR-0009` (**Proposed**), `ADR-0004` (**Proposed**), `ADR-0007` | 13, 15 | `ADR-0009` acceptance; provider privacy/DPA review (I16) | blocked (owner) |
| 18 | Automated connectors / optimization | P5 / epic 19 | `COMP-001`–`004`, `PLAN-003`; `DEC-020`; `ADR-0010` (**Proposed**) | 15, 16, 17 | `ADR-0010` acceptance; approved competitor sources (I17); measured history/accuracy | blocked (owner) |

Convention: `blocked (owner)` means an owner/tech acceptance or approval named in the gate
is required before the slice can be implemented or relied on; `blocked (data)` means a
measured input (history/grain quality) is required. Data gates noted as "none — …" do not
block the build (owner clarification 2026-09-18: they gate validation and go-live); the
slice proceeds against `CALCULATION_CONTRACT.md` with synthetic fixtures until real data
arrives.

## 5. Owner-input register

Outstanding owner decisions/inputs that gate slices (no new decisions invented here; no
dates assigned):

- **`ADR-0003` accepted (2026-09-19)** — `docs/adr/0003-identity-and-role-model.md`;
  slices 1a–1e are done. Its open items (final access matrix / shared-device login,
  Argon2id parameters against the ~250 ms target, admin-assisted password reset) are still
  open and tracked here.
- **~~`ADR-0004` jobs runtime~~ resolved (2026-09-20, `DEC-062`)** — pg-boss selected as
  the jobs runtime (`3505aa8` comparison). `ADR-0004` acceptance itself is still tracked
  with the remaining `Proposed` ADRs below.
- **`ADR-0005` accepted (2026-09-20); `ADR-0007` + `ADR-0008` accepted (2026-09-20);
  `ADR-0009`/`0010`/`0011` acceptance** — `ADR-0005`, `ADR-0007` and `ADR-0008` are
  settled (2026-09-20; `ADR-0007`/`ADR-0008` owner-delegated in-session, revertible;
  slices 8 unblocked and rows 12/13 unblocked — row 12 is now `done` and committed,
  and row 13 is data-gated on history/grain quality); the
  remaining `Proposed` ADRs (`0009`/`0010`/`0011`) gate
  slices 16, 17, 18.
- **~~Multi-tenancy posture~~ resolved (2026-09-20, `DEC-061`)** — shared schema with
  `organization_id` row scoping.
- **Component cost estimate** — `docs/phase0/PHASE0_CLOSEOUT_PLAN.md` §9 (P0-008);
  needed for the Phase 1–3 estimate reassessment after `DEC-037`/`DEC-039`/`DEC-015`.
- **Staging data-sanitization owner** — `CONTEXT.md` "Open decisions / inputs";
  `docs/runbooks/deployment.md`.
- **Real DO credentials + provisioned Spaces state bucket + single-runner apply** —
  `docs/runbooks/deployment.md` ("Database privilege bootstrap", state-bucket bootstrap,
  proxy/dry-run notes); includes the **legacy instance-slug check** before apply.
  (Deployment readiness, 2026-09-20: the env-var wiring is **done** —
  `ORGANIZATION_ID` (general) and `TOTP_SECRET_ENCRYPTION_KEY` (secret) are wired
  conditionally into the app-platform module and both env roots (unset adds no env
  var), web-only; `terraform fmt -check -recursive` clean, `init -backend=false` +
  `validate` green in both envs, offline plan still **16 to add / 0 change / 0
  destroy** per env. What still gates a real `apply`: `ADR-0004` acceptance, a real
  scoped `DIGITALOCEAN_TOKEN`, a provisioned private Spaces state bucket + state
  credentials, the sanitized-data owner, the legacy instance-slug/manual-scaling
  check, and domain names (optional). The runbook mandates staging-first `apply`
  with sanitized/synthetic data only — never a raw production copy; a raw
  production copy is only sanctioned via an isolated PITR restore for a data
  rollback.)
- **Slice-5 recipe ambiguities (eight, deliberate, from `841da96`)** — record each
  owner resolution in `12_OPEN_DECISIONS.md` (next free id `DEC-066`; items 3 and 7
  already resolved as `DEC-050` and `DEC-053`); do not resolve silently:
  1. allergen roll-up from sub-recipes into the parent recipe is not implemented;
  2. yield loss is applied per line and then once at recipe level, as §6 literally
     states; a batch-level alternative would change rounding;
  3. a same-instant tie between cost sources is rejected as ambiguous (no silent
     precedence, in the spirit of `DEC-050`);
  4. allergens are per recipe version, as `DATA_DICTIONARY` §3 keys them;
  5. `recipe_version` quantities carry no unit and are treated as the output item's
     base unit;
  6. `yield_rate` is derived and persisted; it is never accepted as input;
  7. `recipe_version_no_overlap` is ungated, so two draft versions of one recipe
     cannot overlap in time;
  8. `planned_output_qty` is stored but unused by the §6 formula.
- **Slice-6 cost/allocation open points (five, deliberate, recorded not decided)** —
  record each owner resolution in `12_OPEN_DECISIONS.md` (next free id `DEC-066`);
  do not resolve silently:
  1. `operating_cost → cost_pool` linkage is not modelled: `DATA_DICTIONARY` defines
     `operating_cost` by cost centre and `cost_pool` separately with no join, so the
     slice takes `periodCostPoolAmount` as an explicit input to allocation rather
     than inventing an aggregation; owner/FIN to define how a period's pool amount
     is derived from operating costs.
  2. `allocation_rule.denominator_source` is free text with only a non-blank check;
     there is no controlled vocabulary (typos would silently change the denominator);
     TECH/owner to decide a closed set (per-driver) before reliance.
  3. `allocation_rule.scope_type` reuses the `scope_type` vocabulary; for allocation,
     `equal_share` is only meaningful with `organization`/`company_wide`; the
     structural split is deferred.
  4. `asset` (fixed-asset register, `DATA_DICTIONARY` §4) is deliberately deferred;
     equipment depreciation is entered as an `operating_cost` for now.
  5. Owner imputation and the cash view are implemented (`economicView` = paid +
     imputed owner labour at the effective role rate; `cashView` = paid only),
      pending the I8/I9 inputs.
- **Slice-7 cost-card / pricing open points (deliberate; recorded not decided)** —
  record each owner resolution in `12_OPEN_DECISIONS.md` (next free id `DEC-066`);
  do not resolve silently:
  1. `target_contribution_pct` semantics — `CALCULATION_CONTRACT.md` §10 solves
     `required_net_price = unit_variable_cost / (1 − target_contribution_pct)`
     (contribution over net price), but `DEC-021`/the UI say "target margin"; the
     stored fraction vs percentage and display scale are not pinned. owner/FIN.
  2. Gross-price fee solving — §10 says "solve algebraically or by bounded
     iteration" but pins no algorithm, iteration cap, convergence criterion or
     tolerance, and rejection rule 7 does not enumerate the unattainable fee
     layouts. owner/TECH.
  3. Tax → net-price conversion — §2/§8 give `unit_net_sales = gross −
     included_tax` and the fixture uses `gross / (1 + rate)`, but the
     derivation/rounding of `included_tax` from `tax_basis` + `rate_pct` is not
     formally defined (same gap noted in `landed-cost.ts`). owner/FIN.
  4. Break-even — `04_CALCULATIONS.md` defines it with a `fixed_cost` and a
     "weighted_average_unit_contribution" from the sales mix, but no rule names
     which fixed cost a single scenario uses or how the mix is weighted for one
     product. owner/FIN.
  5. "Expected monthly effect" and "sensitivity" — required scenario outputs
     with no formula, axes or grain. owner/FIN.
  6. "Price change in NOK and percent" — required output with no
     boundary/rounding or n/a-on-zero-baseline rule. owner/FIN.
  7. Contribution before vs after labour — both are mandatory outputs but which
     one drives the target/margin/approval is not pinned. owner/FIN.
   8. ~~`price_version` is not created (deferred)~~ resolved 2026-09-21
       (`DEC-064`/`DEC-077`): the `price_version` table (migration `0027`,
       half-open `[effective_from, effective_to)`, non-overlapping per scope
       via an EXCLUDE with a COALESCE sentinel) and approval-driven effective
       versions — `approvePriceScenario` creates the version for the
       scenario's scope in the same transaction with the CAS
       `approvePriceScenarioIfApprovable` race fix; only an approved scenario
       yields a version (PRICE-003 served). Remaining recorded open point:
       the scope-resolution fallback (company-wide → specific
       location/channel) is not implemented — see the assert below.
  9. The `approval` platform table (`DATA_DICTIONARY.md` §9, FND-005) does **not**
     exist — `packages/persistence/src/schema/platform.ts` has only
     `outbox_event` and `audit_event`; a `CONTEXT.md` claim that approval
     platform tables exist is incorrect. Model cost-card/scenario approval via
     state columns + `audit_event` for now, or add the table later. owner/TECH.
  10. Cost-card version chain/effective dating — `cost_card` has no `version_no`
      or effective dates and no uniqueness in scope; the supersede rule in
      `DEC-060` is provisional until the owner defines the chain. owner/FIN.
  11. "Required item" for §3's not-approvable rule ("no cost source for a
      required item") is undefined (which recipe lines/sub-recipes/packaging
      count). owner/FIN.
  12. Per-item `cost_selection_policy` override (`DEC-021` "per-item override
      allowed") is not modelled; the policy lives only on `cost_card`/
      `calculation_snapshot`. owner/TECH.
  13. `calculation_snapshot.tax_rule_version` in `DATA_DICTIONARY.md` vs the
      implemented `tax_rule_snapshot jsonb` column: version reference vs full
      JSON snapshot is unresolved. owner/TECH.
  14. `calculation_snapshot.totals` and `snapshot_component.provenance` jsonb
      shapes are unenumerated. owner/TECH.
  15. Golden-fixture sign-off — the six fixtures are still unsigned and
      `tests/fixtures/` does not exist; the storage format of the signed record
      and how "verified" is represented in code are unpinned. The gate stands:
      no cost is "verified" before owner sign-off. owner/FIN.
  16. (Standing, from earlier slices) the unit `m` vs missing `length` dimension,
      and the missing `numeric(19,6)` digit cap in
      `packages/domain/src/decimal.ts` — tracked in the standing bullets
      below. owner/TECH.
- **Price-version scope-resolution fallback (surfaced 2026-09-21, from the
  price-version slice; recorded not decided)** — `findEffectivePriceVersion`
  resolves exact scope only: there is no company-wide (`null` location/channel)
  → specific-location/channel fallback; per `DEC-077` a company-wide version
  is a distinct "any" scope and does not resolve for a specific location.
  owner/TECH.
- **Slice-8 stock-ledger open points (deliberate; recorded not decided)** — surfaced
  by the slice-8 adversarial reviews and implementation (uncommitted working tree at
  HEAD `f7b1db7`); record each owner/TECH resolution in `12_OPEN_DECISIONS.md` (next
  free id **`DEC-066`**); do not resolve silently:
  1. Goods-receipt acceptance is not yet wired to the ledger: a receipt has no
     destination `storage_area_id`, so the receipt→movement integration and its
     storage-area policy are unresolved (surface: `post-stock-movement.ts`). owner/TECH.
  2. Per-source reversal semantics are not enumerated: reversing a non-receipt
     movement posts movement type `correction` (only `receipt` →
     `receipt_reversal`); `DEC-028` defines the semantics per source type (receipt,
     production batch, transfer, count adjustment, sales line). Surface:
     `reverse-stock-movement.ts`. owner/TECH.
  3. `lotTracked` is not enforced — a lot-tracked item can post with `lotId` null
     (`post-stock-movement.ts`). owner/TECH.
  4. The `DEC-028` "automatic reversal blocked when reconciled downstream sales
     depend on the original" gate is deferred until the sales slice exposes
     reconciliation state; reversal always requires an explicit reason today
     (`reverse-stock-movement.ts`). owner/TECH.
  5. The `0017_stock_ledger_invariants.sql` `source_id` guard validates only
     `source_type='goods_receipt'` (existence + org); production/transfer/count/
     sales/waste source types are documented no-ops until their slices extend the
     trigger. owner/TECH.
  6. `DEC-009` daily theoretical sale-consumption posting is not implemented (no
     sales source exists yet); `postStockMovements` is the idempotent primitive the
     sales slice will call. owner/TECH.
  7. `stock_balance` is written directly by the posting command while the runbook
     calls it a rebuildable projection; confirm the writer policy before
     multi-instance use (`post-stock-movement.ts`). owner/TECH.
  8. No application surface creates `location` rows (a pre-existing gap);
     `registerStorageArea` requires an existing location. owner/TECH.
  9. The `stock_movement` idempotency key is now a **per-organization**
     namespace (`stock_movement_org_idempotency_key_key` on `(organization_id,
     idempotency_key)`, migration `0018`), which **narrows** `DATA_DICTIONARY` §6's
     global "unique where not null" wording — the owner must confirm the intended
     scope (per-org, as the slice assumes). owner/TECH.
  10. The DEC-010 negative-override role set is fail-closed and uses the real
      `ROLE_CODE` vocabulary codes (`NEGATIVE_OVERRIDE_ROLES =
      ["owner", "general_manager", "location_manager"]` in
      `packages/application/src/inventory/permissions.ts`; an earlier draft used
      `manager`, which is **not** a vocabulary code and was corrected). The open
      point is the owner confirming which of those roles should grant the
      override (`DEC-066`).
      Surfaces: `post-stock-movement.ts`, `reverse-stock-movement.ts`. owner/TECH.
  (Delta note, 2026-09-20: two further accepted minors from a delta review —
  fake `saveStockBalance` throws when the row was not locked first, and
  single-posting `idempotencyKey` containing `:` is rejected; final counts 557
  passed / 135 skipped (692) without `DATABASE_URL`, 692 passed / 692 (69 files)
  with it.)
  (Review follow-up, 2026-09-20: **all ten adversarial-review findings are now
  addressed.** Findings 1–4 were fixed earlier (DEC-010 manager-permission gate
  via `assertNegativeOverrideAuthorized`; per-org idempotency key via migration
  `0018`; domain `deriveAverageUnitCost`; shared `postRevaluationCorrection`).
  Findings 5–10 are fixed too: batch posting memoises transaction-immutable
  reference lookups; `getStockBalanceAsOf` uses the SQL aggregate
  `sumStockMovementsAsOf` (no in-memory ledger scan) plus the domain average
  helper; migration `0019` adds `stock_movement_org_occurred_idx`; the
  negative-override guard and `isBlank` are de-duplicated; the dead wrapper
  `getCurrentStockBalance` and the test-only persistence exports
  (`createStockLot`, `findStockLotByNumber`, `listStorageAreas`) were removed.
  `listStockMovements` is deliberately retained as a ledger read API (used only
   by its persistence test for now; slice 9 will need it). The open points above
   remain open.)
- **Slice-9 counts/transfers/waste open points (deliberate; recorded not decided)** —
  surfaced by the slice-8/9 implementation (slice-9 persistence
  committed in `b525f30`, migration `0020`; Wave 2b application/API/screens in
  flight); record each owner/TECH resolution in `12_OPEN_DECISIONS.md` (next free id
  **`DEC-066`**); do not resolve silently. (Where an item overlaps a slice-8 point
  above, the slice-8 numbering is retained and noted.)
  1. Receipts are not wired to the ledger: a receipt still has no destination
     storage area, so it does not post a stock movement (overlaps slice-8 point 1).
     owner/TECH.
  2. Per-source reversal semantics (`DEC-028`) are not implemented in
     `reverseStockMovement` (overlaps slice-8 point 2). owner/TECH.
  3. `lotTracked` is unenforced (overlaps slice-8 point 3). owner/TECH.
  4. The `DEC-028` reconciled-downstream-sales reversal gate is deferred (overlaps
     slice-8 point 4). owner/TECH.
  5. The source guard now covers `stock_count`/`transfer`/`waste_event`
     (migration `0020`) but no other source types; production/sales remain
     documented no-ops. owner/TECH.
  6. `DEC-009` daily theoretical sale consumption is not implemented (overlaps
     slice-8 point 6). owner/TECH.
  7. `stock_balance` is written directly by the posting command (overlaps slice-8
     point 7); confirm the writer policy before multi-instance use. owner/TECH.
  8. No application surface creates `location` rows (overlaps slice-8 point 8).
     owner/TECH.
  9. **No transfer line table exists** — a transfer is a header plus paired
     `stock_movement.transfer_id` movements; the per-item discrepancy is derived.
     Owner/TECH to confirm this shape or require a line table later. owner/TECH.
  10. The `unit_cost` source for a **positive** count variance (a found-item surplus)
      is undecided (the ledger's moving average is the working assumption).
      owner/FIN.
  11. `waste_event.value_method`/`value` vs the ledger's moving average at waste
      posting time is undecided (which value the waste record is judged against,
      and whether they may diverge). owner/FIN.
  12. Count `scope` shape (whole area vs item subset) and the recount thresholds
      are undefined (`DEC-017`/`DEC-029` leave the escalation rule open). owner/FIN.
  13. No transfer-discrepancy exception table exists; a discrepancy between the
      shipped and received movements is currently only derivable from the ledger.
      owner/TECH.
  (Process note: the slice-8/9 backlog was committed in dependency-ordered **layer
  commits** — persistence → domain → application → web/ui → infra — because the
  migrations/schema barrels shared files across tasks; per-task feature commits
  resume from here.)
- **Slice-9/10 accepted technical decisions (`DEC-066`–`DEC-071`, 2026-09-20)** — the
  technical defaults implemented by the slice-9/10 code, consistent with `ADR-0005`,
  are now recorded as accepted decisions in `12_OPEN_DECISIONS.md`: `DEC-066`
  transfers as a header plus paired `stock_movement.transfer_id` movements (no line
  table; the discrepancy is derived; `discrepancy_note` is the interim exception
  record); `DEC-067` positive count variance valued at a caller-supplied `unit_cost`
  falling back to `item.current_cost` (provisional — FIN to confirm the valuation
  source); `DEC-068` operational waste valued at the ledger's moving weighted average
  at posting (`cost_selection`/`latest_price`/`manual` unimplemented); `DEC-069`
  production batches have no business number yet (deterministic caller id until
  OPS+TECH define one); `DEC-070` expected trim/cooking loss never posts a `waste`
  movement (only actual abnormal loss becomes a `waste_event`); `DEC-071`
  `production_batch_output.kind` uses a provisional local vocabulary pending a
   `domain-enums.yaml` key. Next free decision id **`DEC-079`**.
- **Slice-9/10 open owner questions (deliberate; recorded not decided)** — surfaced
  by the concurrent slice-9/10 build (uncommitted working tree at HEAD `2a5799e`);
   record each resolution in `12_OPEN_DECISIONS.md` (next free id **`DEC-079`**); do
   not resolve silently:
   1. Output-cost allocation across multiple outputs/by-products of one batch.
     owner/FIN.
  2. Yield-variance tolerance and the exception store (`PROD-003`). owner/FIN+TECH.
  3. Work-in-progress / source-draw storage area for production batches.
     owner/OPS+TECH.
  4. `production_plan` line/quantity model and status vocabulary. owner/OPS+TECH.
  5. Lot-tracked cross-location transfer policy. owner/OPS.
  6. Per-source reversal semantics (`DEC-028`) are not yet implemented (overlaps
     slice-8 point 2). owner/TECH.
  7. Receipts are not wired to the ledger (overlaps slice-8 point 1). owner/TECH.
  8. `lotTracked` is unenforced (overlaps slice-8 point 3). owner/TECH.
  9. `DEC-009` daily theoretical consumption is not implemented (overlaps slice-8
      point 6). owner/TECH.
- **Row-11 import-framework open points (deliberate; recorded not decided)** —
  surfaced by the row-11 build (uncommitted working tree at HEAD `7f6aa78`);
   record each resolution in `12_OPEN_DECISIONS.md` (next free id **`DEC-079`**);
  do not resolve silently:
  1. ~~Row 12 is gated on `ADR-0008` acceptance~~ resolved 2026-09-20:
     `ADR-0008` is accepted (owner-delegated in-session); the I1 channel/SKU
     confirmations remain recorded inputs and the import slice still stops at
     `validated`/`needs_review` until row 12 lands.
  2. ~~Row 13 (close/dashboards) is gated on `ADR-0007` (still Proposed)~~
     resolved 2026-09-20: `ADR-0007` is accepted (owner-delegated); history/grain
     quality remains the data gate.
  3. Sales/consumption grain ambiguity: `DEC-009` daily-per-location vs a single
     `sales_line` `source_id` — unresolved. owner/TECH.
  4. No import-profile table exists (profiles are implicit in the run payload).
      owner/TECH.
  5. ~~No tolerance-configuration table exists~~ resolved 2026-09-20 (`DEC-072`):
      an effective-dated `reconciliation_tolerance` table (migration `0024`);
      missing config blocks close.
  6. `file_object` is absent from the schema, so `import_run.file_object_id` is a
      plain uuid with no FK target. owner/TECH.
  7. Dispositions live in `import_run.diagnostics.dispositions` (jsonb), not a
      table. owner/TECH.
  8. ~~Two routes return 404 by matching the text `/not found/i` on the
      `DomainError` message~~ resolved 2026-09-20 (`DEC-076`): a typed
      `NotFoundError` maps to 404 by `instanceof`.
  9. ~~`MAPPING_STATE` has no `conflict` value~~ resolved 2026-09-20
      (`DEC-074`): `conflict` is a first-class value (migration `0025`).
  (Local note: a live-check left one dev `import_run` row in the local database —
  a local dev-data artefact, no repository impact.)
- **Row-12 sales/reconciliation open points (deliberate; recorded not decided)** —
  surfaced by the row-12 build (uncommitted working tree on top of HEAD
   `c324418`); record each resolution in `12_OPEN_DECISIONS.md` (next free id
   **`DEC-079`**); do not resolve silently:
  1. Consumption grain A1: `DEC-009` daily-per-location vs a single `sales_line`
     `source_id` — unresolved. owner/TECH.
  2. ~~No tolerance-configuration table exists; the `DEC-026` tolerance is
      hardcoded in the domain evaluator~~ resolved 2026-09-20 (`DEC-072`): an
      effective-dated `reconciliation_tolerance` table (migration `0024`);
      missing config blocks close.
  3. ~~`tax_code_id` vs `tax_rule_id` + `applied_tax_rate` authority (A4)~~
      resolved 2026-09-20 (`DEC-075`): `tax_rule_id` is canonical;
      `applied_tax_rate` is the captured applied rate.
  4. ~~`DEC-028` sales-line reversal semantics are not implemented~~ resolved
      2026-09-20 (`DEC-073`): a new negated `sales_line` with `reversal_of_id`,
      mandatory reason, linked consumption reversed via `reverseStockMovement`.
  5. ~~`settlement.status` and `reconciliation.scope_type` have no vocabulary
      (free status strings today)~~ resolved 2026-09-21 (`DEC-078`):
      `settlement.status` is constrained to `{received, paid, void}`
      (default `received`) and `reconciliation.scope_type` to the new
      `reconciliation_scope_type` `{import_run, sales_source, settlement,
      supplier_invoice}` (migration `0028` check constraints;
      `assertReconciliationScopeType` rejects an unknown scope before any write).
  6. A pre-existing inventory test posted a `sales_line` movement with a fake
     source id and was fixed — the new `sales_line` branch in
     `stock_movement_source_guard` correctly rejects it. TECH (fixed).
  7. The legacy I19 import carries no resolvable `location_id`, so the demo
     theoretical consumption posts zero recipe-bearing lines. owner/TECH.
  8. A local dev-DB side effect: the demo import run left a
     `partially_posted` import run and a reconciliation reopened to `pending`
     in the local database. Local dev-data artefact, no repository impact.
- **Next unblocked task (2026-09-21, after `DEC-078`):** with rows 13–18 gated
  (row 13 data-gated on history/grain quality I11; row 14 owner-gated on the
  privacy review / access matrix; rows 15–18 blocked on data /
  `ADR-0009`–`0011`), no roadmap slice is buildable purely from code without
  owner inputs or real history. The recorded low-risk open points resolved so
  far are decisions `DEC-072`–`DEC-078` (2026-09-20/21; tolerance table
  `DEC-072`, sales-line reversal `DEC-073`, `MAPPING_STATE` `conflict`
  `DEC-074`, `tax_rule_id`/`applied_tax_rate` `DEC-075`, typed not-found error
  `DEC-076`, the price-version slice `DEC-077`, and the `settlement.status`/
  `reconciliation.scope_type` vocabularies + `lotTracked` enforcement
  `DEC-078`). The next buildable TECH-owned task is the
  **cross-organization referential-integrity / deferred-FK hardening** —
  `DEC-054`'s `recipe_allergen.allergen_id` and `recipe_line.item_id`/
  `sub_recipe_id` FKs plus the `goods_receipt_line` composite FKs — using the
  runbook's `NOT VALID` → `VALIDATE CONSTRAINT` pattern (fallback if it hits
  a gate: the `data_quality_exception` table, `DEC-066`'s interim replacement
  for `stock_transfer.discrepancy_note`). The remaining recorded open points
  above stay open. Next free decision id **`DEC-079`**.
- **Unit `m` vs the missing `length` dimension** — a dimension-vocabulary mismatch in
  `schemas/domain-enums.yaml` surfaced by slice 3; owner/TECH to resolve (FND-003).
- **`numeric(19,6)` digit cap in `packages/domain/src/decimal.ts`** — the domain decimal
  type lacks the cap; TECH, before a slice relies on it.
- **UI palette hex values + data-viz palette semantics** — owner (BUS) sign-off of the
  design-token palette; the data-viz palette semantics are undefined.
- **Shared rate-limit store** — the auth per-IP limiter is per-process; a shared store
  (a migration) is needed before multi-instance deployment (TECH; pairs with
  `ADR-0004`).
- **Reset-token delivery** — `deliverResetToken` is a no-op stub until the
  email/notification slice; owner to pick the delivery channel.
- **Golden-fixture signatures (six)** — `docs/phase0/GOLDEN_FIXTURES.md` §5; finance +
  product owner, based on I4/I5/I8 and the I9 ruling.
- **Source files I4, I5, I7, I8** — `docs/phase0/SOURCE_DATA_REQUEST.md` and
  `docs/phase0/UNBLOCK_CHECKLIST.md` (the three genuine Phase 1 blockers are I4, I5, I8).
- **Frontline data-shape confirmations (I1/I15)** — item-level sales lines, channel/applied
  tax per line, SKU, on-sale representation; `docs/phase0/POS_WOLT_NOTES.md`,
  `SOURCE_DATA_REQUEST.md`; `DEC-041`/`DEC-042`/`DEC-043`.
- **Accountant ruling (I9)** — VAT/recoverability defaults and the staff-meal /
  own-consumption caveat in `CALCULATION_CONTRACT.md` §15; `ACCOUNTANT_QUESTIONS.md`.
- **Fiken kontoplan/VAT codes/posting structure + API token (I10)** —
  `docs/phase0/ACCOUNTING_FIKEN_NOTES.md`.
- **LLM provider DPA/privacy review (I16)** — before slice 17 (`DEC-039`, `ADR-0009`).
- **Per-source write approvals + named credentials owners (I18)** — before slice 16
  (`DEC-015`, `ADR-0011`).
- **Approved competitor sources (I17)** — before slice 18 (`DEC-020`, `ADR-0010`).

## 6. Status legend

- `todo` — not started; ready unless a gate says otherwise.
- `in progress` — being worked in the current or most recent session.
- `done` — implemented and verified per `10_DELIVERY_PLAN.md` §10.7 and committed.
- `blocked (owner)` — an owner/tech acceptance or approval named in the gate is required.
- `blocked (data)` — a measured input (history/grain quality) is required.
