# Project context

Canonical orientation for this repository: read this first when resuming work,
and update it at the end of any session that changes anything (code, docs,
decisions, data) — per `AGENTS.md` Rule 1. Reference artifacts by path; don't
duplicate their content.

## Resume here (next session)

**Say "resume the work" and start here.** A fresh session must be able to continue
from this section alone.

**Next task:** **slice 8 — stock ledger + balances + lots/storage** — now
**UNBLOCKED**: the owner accepted `ADR-0005` (`docs/adr/`, the
stock-inventory/valuation model) on 2026-09-20, lifting the slice-8 gate from
`docs/BUILD_ROADMAP.md` §3/§4. Read `docs/BUILD_ROADMAP.md` §4 row 8 (refs
`INV-001`–`003`, `INV-008`, `PROD-002`, `WASTE-002`, `COST-008`; `DEC-008`,
`DEC-009`, `DEC-010`, `DEC-028`, `DEC-034`) and run the §2 execution loop from
step 1 (pre-flight → design → implement → verify → reviews → reconcile → atomic
commit).

**Scope (do):** implement slice 8 per `docs/BUILD_ROADMAP.md` §2/§4 row 8 —
domain, application and persistence work plus migration `0017+` — never treating
calculated costs as "verified" before the golden fixtures are signed; record any
genuinely new decision in `12_OPEN_DECISIONS.md` from **`DEC-066`**.

**Scope (do not):** do not rework the committed auth/UI/master-data/receiving/
recipe/costing workstreams or slice 7's application logic; do not edit migrations
`0000–0016`; invent no decision (append from `DEC-066` only if genuinely needed);
no external writes; do not deploy (`infra/` stays unapplied and gated on the
owner inputs below).

**Files/paths:** `packages/domain/src/`, `packages/application/src/`,
`packages/persistence/src/` + `drizzle/` (`0017+`), `docs/BUILD_ROADMAP.md`,
`12_OPEN_DECISIONS.md` (only if a new decision is needed, from `DEC-066`),
`CONTEXT.md`.

**Acceptance / verification:** the slice-8 requirements of `docs/BUILD_ROADMAP.md`
§4 row 8 are met. After any (code) change: `npm run lint`, `npm run typecheck`,
`npm run test` (both with and without `DATABASE_URL`), `npm run build` and
`npm run format:check` pass; `npm audit --omit=dev` = 0; migration `0017+` applies,
re-runs as a no-op and has a rehearsed down path.

**Parallel owner action — golden-fixture sign-off:** the six golden fixtures are
now prepared as machine-readable JSON under `tests/fixtures/` (`DEC-065`) with the
sign-off trail ready (six files, the reconciliation test
`packages/domain/src/golden-fixtures.test.ts`, and the sign-off mechanics — see
`docs/phase0/GOLDEN_FIXTURES.md`); finance + product owner sign. Until signed, no
cost is "verified"; `I8`/`I9` still gate the real rates behind the fixtures.

**After this task:** per `DEC-064`, **price versions + PRICE-002/003** are the next
pricing slice after slice 8. Subsequent: slice 9 (counts + transfers + waste)
depends on slice 8; then the deployment/apply gates (jobs runtime and
multi-tenancy are now decided — `DEC-062`/`DEC-061`).

## What this is

**Aquarela Business Control** — a secure, testable modular monolith for an Oslo
café with two locations, covering costing, pricing, inventory, production,
sales/imports, workforce and reporting. It is **documentation-first**: Phase 0 is
complete (specification, 65 accepted decisions, artifacts and ADRs); the
foundation scaffold, the Phase 1–2 persistence core, the auth slices (1a–1e), the
UI token foundation, master-data slices 2–3, slice 4 (receipt + price history +
landed cost), slice 5 (recipes), slice 6 (operating costs + labour + allocation)
and slice 7 (cost card + snapshots + price scenario + approval) are built.

## Where things live

- `00_README.md` … `13_AGENT_BUILD_BRIEF.md` — the specification package
  (inputs, rarely edited). Start with `00_README.md`.
- `12_OPEN_DECISIONS.md` — the accepted decisions (DEC-001…DEC-065); the
  authority. New decisions are appended here.
- `docs/phase0/` — close-out plan, calculation contract, data dictionary, golden
  fixtures, source-data request, notes. See `docs/phase0/PHASE0_CLOSEOUT_PLAN.md`
  and `docs/phase0/CALCULATION_CONTRACT.md`.
- `docs/adr/` — architecture decision records `0001`–`0012` (`ADR-0005` accepted
  2026-09-20).
- `docs/runbooks/` — operator runbooks (`persistence-migrations.md`, `deployment.md`).
- `docs/BUILD_ROADMAP.md` — the ordered slice backlog and per-slice execution loop (a
  derived execution tracker; decisions and accepted ADRs stay the authority).
- `schemas/` — draft DDL and domain enums (`schemas/phase1_2_draft.sql`,
  `schemas/domain-enums.yaml`).
- `samples/` — real POS exports, screenshots and templates (reference data).
- `packages/*` and `apps/*` — code (config, logger, domain, application,
  persistence; `web`, `worker` and `scheduler` runtimes).
- `AGENTS.md` — the rules (handoff/work log, reversibility, decisions).
- `CONTEXT.md` — this file.

## Current status

- **As of:** 2026-09-20 — branch `main`; HEAD `083106a`. **Slice 7 (cost card +
  snapshots + price scenario + approval) is complete, reviewed, verified and
  committed (`400c95b`, with its review fixes in `60f3ec5`, `c82a30f` and
  `083106a`).** This session the owner accepted **`ADR-0005`** (stock
  valuation/consumption — unblocking slice 8) and made five decisions:
  `DEC-061` (multi-tenancy: shared schema with `organization_id` row scoping; RLS
  possible later, no schema/DB-per-tenant), `DEC-062` (background jobs runtime:
  **pg-boss** over the existing PostgreSQL, worker/scheduler long-lived),
  `DEC-063` (price-scenario target is contribution over net price — a 6 dp
  fraction, not gross margin, not markup), `DEC-064` (`price_version` +
  PRICE-002/003 are the next pricing slice after slice 8) and `DEC-065` (golden
  fixtures are machine-readable JSON under `tests/fixtures/`, with the sign-off
  trail prepared: six files, the reconciliation test
  `packages/domain/src/golden-fixtures.test.ts`, and the sign-off mechanics).
  Nothing has been applied to DigitalOcean.
- **Auth complete and security-reviewed (slices 1a–1e):** domain primitives (1a);
  persistence layer (1b-i); application flow (1b-ii); password reset + access
  control (1b-iii, `2ce8847`; reset neutrality `5776914`); hardening (`60ac52e`:
  fail-closed MFA config, 32-byte key validation, `isAuthorizedFor` throws on an
  empty requirement, audit before/after the secret guard); the HTTP surface (1c,
  `5c42c1d`: routes, cookies, CSRF/same-origin, per-IP limiter, login/2FA/reset
  pages); TOTP enrolment + recovery codes (1d, `07af21d`); first-owner bootstrap +
  MFA enrolment surface (1e, `e51a957`); atomic MFA disable + bootstrap `--dry-run`
  (`0cce93b`).
- **Master data done:** slice 2 — unit + supplier-pack value objects (`87f9ced`,
  strict package-to-base fix `4ccfb23`); slice 3 — master-data schema + conversion
  graph (`a869227`, migration `0004`), `unit_conversion` overlap invariants
  (migration `0005`) + conversion-graph hardening and `DEC-050`/`DEC-051`
  (`b8897bf`).
- **Costing slices done:** slice 4 — receipt + price history + landed cost —
  done (`e3706c0`, including its review fixes and migrations `0007`/`0008`,
  `DEC-052`); slice 5 — recipes / sub-recipes / version / yield / allergens — done
  (`841da96`/`13a29b7`/`15b9b68`, migration `0009`, `DEC-052`–`DEC-054`; its two
  adversarial reviews were reconciled in `13a29b7`/`15b9b68`); slice 6 — operating
  costs + labour + allocation — **committed** (`8f3ac5d`, migrations `0011`–`0013`,
  `DEC-055`–`DEC-057`); slice 7 — cost card + snapshot + price scenario + approval —
  **committed and reviewed** (`400c95b` + review-fix commits `60f3ec5`, `c82a30f`,
  `083106a`; migrations `0014`–`0016`; domain `pricing.ts`/`cost-card.ts`,
  application `CostCardStore`/`PriceScenarioStore`; `DEC-058`–`DEC-060`; its three
  adversarial reviews were run and reconciled — see the work log). `c82a30f` added
  cross-organization guards to `calculateCostCard`/`calculatePriceScenario` and
  documented `0015`/`0016` in the migration runbook; `083106a` wired the pinned
  pricing primitives into the scenario outcome, removed two dead read APIs,
  de-duplicated the contribution boundary and added the `0014`/`0016` pre-apply
  preflight notes.
- **UI foundation:** design tokens package (`aa2eff5`), token-driven UI primitives
  (`a83a312`), layout reference note (`dad2ff0`), accessibility/form-wiring fixes
  (`74ac467`).
- **Decision briefs + cost estimate:** DEC-049 assessment (`c8e86e0`), deployment
  cost estimate (`21e9c72`), multi-tenancy posture (`018930d`), jobs-runtime
  comparison recommending pg-boss (`3505aa8`), runbook pre-apply inputs
  (`bfc5f74`).
- **DEC-049 closed:** drizzle-orm 0.45.2 / drizzle-kit 0.31.10 upgrade (`cc86f13`);
  `npm audit --omit=dev` = 0.
- **Tests:** 475 passed / 113 skipped (588) without `DATABASE_URL`; **588 passed /
  588 (60 files + the new golden-fixture test)** with it (recorded 2026-09-20 at
  HEAD `083106a`; re-verify with `npm run test` and update if they differ).
  Open verification debt: the per-process rate limiter needs a shared
  store before multi-instance deployment; the reset-token delivery is a no-op stub
  until the email slice; the palette hex values and data-viz palette semantics
  await owner sign-off (see "Open decisions / inputs"); the six golden fixtures
  remain unsigned and are the "verified" gate.
- **Persistence core + deployment foundation (committed):** Drizzle schema,
  migrations `0000_enable_extensions` → `0016` additive with tested down paths
  (`0011_cost_allocation.sql` adds the four slice-6 tables; `0014_cost_card_pricing`
  adds four deferred `price_scenario` columns + `snapshot_component_kind_check`;
  `0015` adds `calculation_snapshot_cost_card_index`; the hand-written `0016` adds
  the `cost_card_approved_scope` invariant — a partial unique
  `cost_card_approved_scope_key` (`NULLS NOT DISTINCT WHERE state = 'approved'`);
  ledger 17 rows through `0016`; the `asset`
  register is deliberately deferred), the
  advisory-locked migrator, worker/scheduler
  stubs and the `infra/` Terraform scaffold validated offline. Not applied.
- **Not yet built:** business slices 8+; the deferred tables
  (workforce, integrations, competitor, AI, sales, procurement, production,
  counts/transfers, period close, platform job/file/approval — note the
  `approval` platform table from DATA_DICTIONARY §9 does not exist yet — and the
  `asset` register).

## Next up (prioritised)

`docs/BUILD_ROADMAP.md` is the ordered execution tracker for these slices (slice 0 and
1a–1e, 2, 3, 4, 5, 6 and 7 done; **slice 8 next and unblocked by the `ADR-0005`
acceptance**). The list below is the short narrative form.

1. **Slice 8 — stock ledger + balances + lots/storage** (`INV-001`–`003`, `INV-008`,
   `PROD-002`, `WASTE-002`, `COST-008`; `DEC-008`/`009`/`010`/`028`/`034`;
   `ADR-0005`) — **UNBLOCKED: the owner accepted `ADR-0005` (2026-09-20)**. This is
   the next task (see "Resume here").
2. **Price versions + PRICE-002/003** (`DEC-064`) — the next pricing slice after
   slice 8.
3. **Golden-fixture sign-off** — the six fixtures are prepared as machine-readable
   JSON under `tests/fixtures/` (`DEC-065`); finance + product owner sign (the
   "verified" gate); `I8`/`I9` still gate the real rates behind them.
4. **Deployment foundation — scaffolded and validated offline (committed); not
   applied.** `infra/` Terraform (project, database, spaces, networking,
   app-platform, monitoring, dns) + the App Platform app spec are done, and the
   `apps/worker` / `apps/scheduler` stubs exist. The jobs runtime (`DEC-062`,
   pg-boss) and the multi-tenancy posture (`DEC-061`) are now decided. Before any
   `apply`: real DO credentials and a provisioned Spaces state bucket, and a
   single-runner apply. See `docs/adr/0012-deployment-topology-and-service-runtimes.md`
   and `docs/runbooks/deployment.md`.
   decisions under "Open decisions / inputs", real DO credentials and a
   provisioned Spaces state bucket, and a single-runner apply. See
   `docs/adr/0012-deployment-topology-and-service-runtimes.md` and
   `docs/runbooks/deployment.md`.
5. **Costing verification** — against `docs/phase0/CALCULATION_CONTRACT.md` with
   synthetic fixtures, then real data; **owner sign-off of the six golden
   fixtures** (`docs/phase0/GOLDEN_FIXTURES.md`, prepared per `DEC-065`) is the
   gate for treating any cost as "verified" (slice 7 surfaces the sign-off trail).
   Still unsigned.

## Open decisions / inputs (do not block development)

- **Resolved this session (2026-09-20):** `ADR-0005` is **Accepted** (stock
  valuation/consumption — slice 8 unblocked); **`DEC-061`** multi-tenancy = shared
  schema with `organization_id` row scoping (RLS possible later; no schema/DB per
  tenant); **`DEC-062`** background jobs runtime = **pg-boss** over the existing
  PostgreSQL, worker/scheduler long-lived; **`DEC-063`** the price-scenario target
  is contribution over net price (a 6 dp fraction, not gross margin, not markup);
  **`DEC-064`** `price_version` + PRICE-002/003 are the next pricing slice after
  slice 8; **`DEC-065`** golden fixtures are machine-readable JSON under
  `tests/fixtures/` with the sign-off trail prepared.
- External inputs still outstanding: supplier costs/receipts (I4), recipes +
  yields (I5), productive-hours % (I8 remainder), opening counts (I7), and the
  Frontline data-shape confirmations (item-level sales lines, per-line
  channel/applied tax, SKU, add-on representation). See
  `docs/phase0/SOURCE_DATA_REQUEST.md` and `docs/phase0/UNBLOCK_CHECKLIST.md`.
- Surfaced by the 2026-09-19 slices (also tracked in `docs/BUILD_ROADMAP.md` §5):
  - unit `m` vs the missing `length` dimension — a dimension-vocabulary mismatch
    (`schemas/domain-enums.yaml`) to resolve with the owner;
  - the missing `numeric(19,6)` digit cap in `packages/domain/src/decimal.ts`;
  - the palette hex values need owner sign-off, and the data-viz palette
    semantics are undefined;
  - the per-IP rate limiter is per-process — a shared store (a migration) is
    needed before multi-instance deployment;
  - reset-token delivery is a no-op stub (`deliverResetToken` port) until the
    email slice;
  - the deferred-FK hardening on `goods_receipt_line` (a `supplier_item_id` or
    `item_id` from another organization, a mismatched supplier, or a unit that
    does not match the item is guarded only in the application until those FKs
    are added — make them composite and validate per the runbook's
    `NOT VALID` → `VALIDATE` pattern; the `effective_to = effective_from` empty
    window is allowed by `DEC-052`);
  - `DEC-054` open policy points: deleting a recipe version cascades
    `recipe_allergen` (allergen history is dropped before any audit) and a zero
    `current_cost` is accepted for an item — both need a policy decision; and
    cross-organization referential integrity on the recipe FKs stays
    application-guarded until the composite-FK/trigger invariants land;
- Surfaced by slice 6 (`8f3ac5d`; deliberate deferrals for a decision — also
  tracked in `docs/BUILD_ROADMAP.md` §5; do not resolve silently):
  1. how the `cost_pool` amount is derived from `operating_cost` rows is currently
     an application convention, not a documented derivation rule — needs an owner
     decision (next free id `DEC-066`);
  2. `allocation_rule.denominator_source` is accepted free-text (a closed
     vocabulary would have invented values) — the owner should enumerate the
     denominators later;
  3. `scope_type` on `cost_pool`/`operating_cost` reuses the existing shared
     scope vocabulary rather than a structural per-table split — deferred;
  4. the `asset` cost register is deliberately deferred (only the four slice-6
     tables exist);
  5. imputed owner labour awaits the I8 remainder (productive-hours %, insurance,
     role→location) and the I9 accountant ruling — `DEC-055` records the
     provisional figures.
- Surfaced by slice 7 (`400c95b`): the 16 slice-7 cost-card/pricing open (owner)
  points are recorded in `docs/BUILD_ROADMAP.md` §5 ("Slice-7 cost-card / pricing
  open points"); record each owner resolution in `12_OPEN_DECISIONS.md` (next free
  id **`DEC-066`**); do not resolve silently. The golden fixtures remain unsigned
  and are the gate for "verified".
- Surfaced by slice 5 (`841da96`, deliberate ambiguities left for a decision —
  also tracked in `docs/BUILD_ROADMAP.md` §5; do not resolve silently):
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
- `DEC-049` is **closed** (2026-09-19): the drizzle-orm 0.45.2 /
  drizzle-kit 0.31.10 upgrade is committed (`cc86f13`) and `npm audit --omit=dev`
  reports 0; it is no longer an open security regression.
- Deployment/apply gates (updated 2026-09-20): **ADR-0004 acceptance**; the jobs
  runtime is now decided (**`DEC-062`**: pg-boss, worker/scheduler long-lived) and
  the multi-tenancy posture is decided (**`DEC-061`**: shared schema +
  `organization_id` row scoping); the
  **scheduler `SCHEDULED` provider gap** (DO provider v2.101.1 has no `SCHEDULED`
  job kind, so `scheduler` is a long-lived worker + tick loop until the
  provider/API exposes it or ADR-0004 picks a scheduler); Terraform state locking
  (**Spaces has none** — a single-runner apply is the serialization) plus the
  **out-of-band state-bucket bootstrap**; **component cost
  estimate** (`21e9c72`); staging data-sanitization owner; the **legacy
  instance-slug check** before apply; **real DO credentials** and a provisioned
  state bucket. Dockerfile/migrator packaging is **resolved** (one parameterized
  Dockerfile whose runner keeps devDependencies so the migrator carries
  `drizzle-kit`). **Required pre-apply step:** run
  `infra/bootstrap/database-grants.sql` once as `doadmin` after the cluster/users
  exist and **before the first deploy** (without it `migrator` has no DDL
  privileges and `app` cannot read) — see `docs/runbooks/deployment.md`
  ("Database privilege bootstrap") and the runbook's proxy/dry-run notes
  (`bfc5f74`).
- Persistence-slice reconciliation: vocabulary authority is
  `schemas/domain-enums.yaml`; accepted/deferred review items are the
  `stock_balance` projection convention, the `component_kind` vocabulary
  (deferred to the costing slice), the per-`source_type` validation trigger for
  `stock_movement.source_id`, and deferred-FK additions using `NOT VALID` →
  `VALIDATE CONSTRAINT`.
- The six golden fixtures must be **signed** before Phase 1 costing is treated as
  verified.

## How to verify / environment

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
npm run lint && npm run typecheck && npm run test && npm run build && npm run format:check
```

Runtime stubs (each prints its start line and exits 0 after one tick):

```bash
WORKER_TICKS=1 npm run start --workspace @aquarela/worker
SCHEDULER_TICKS=1 npm run start --workspace @aquarela/scheduler
```

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

Terraform (binary pinned by `.terraform-version`; validated locally with Terraform
1.16.3 darwin_arm64). The S3/Spaces backend is deliberately partial, so offline
validation uses `-backend=false` (a real `init` supplies the bucket and keys via
`-backend-config` or the environment):

```bash
cd infra && terraform fmt -check -recursive
cd envs/staging && terraform init -backend=false && terraform validate
DIGITALOCEAN_TOKEN=dop_v1_dummy terraform plan -refresh=false -lock=false -input=false -var-file=staging.tfvars
# same three for envs/production with production.tfvars
```

`terraform plan` works offline with a dummy token (no API calls with
`-refresh=false`). If the backend block is present, `init -backend=false` followed by
`plan` reports "Backend initialization required"; run the offline plan from a
**scratch copy with `backend.tf` removed** (or a local backend override) rather than
mutating the repo — never run `apply` in this state. A real `init` supplies `bucket`
and Spaces credentials via `-backend-config` / `AWS_ACCESS_KEY_ID` +
`AWS_SECRET_ACCESS_KEY`; the state bucket itself must be created out of band first
(see `docs/runbooks/deployment.md`).

## Reversibility

- Revert any commit with `git revert <sha>`; no destructive git operations.
- **Everything through `083106a` is committed** (slices 4–7 and their review fixes
  included, with migrations `0006`–`0016` and additive down paths); `git revert`
  any commit.
- **Slice 7 (`400c95b`)**: `git revert 400c95b` removes the domain
  (`pricing.ts`/`cost-card.ts`), application (`CostCardStore`/`PriceScenarioStore`),
  migrations `0014`–`0016` and the `DEC-058`–`DEC-060` entries together;
  migrations `0014`–`0016` are additive with unjournaled `_down.sql` companions —
  the `0015`/`0016` down paths were rehearsed (drop the indexes/invariant, delete
  the ledger rows, re-migrate).
- **Slice-7 review fixes (`c82a30f`, `083106a`)**: each is an independent commit —
  `git revert c82a30f` removes the cross-organization reference guards on
  `calculateCostCard`/`calculatePriceScenario` plus the `0015`/`0016` runbook
  entries; `git revert 083106a` removes the pricing-primitive wiring into the
  scenario outcome, the two dead read-API removals, the contribution-boundary
  de-duplication and the `0014`/`0016` pre-apply preflight notes. Neither touched
  a migration or a generated file, so neither has a data-recovery concern.
- The `infra/` scaffold, runtime stubs and persistence core are committed; revert
  them with `git revert` if needed. **No cloud resource was created — only offline
  `fmt`/`validate`/`plan` ran, never `apply`; no Terraform state exists, and
  nothing has been applied to DigitalOcean.**
- Migrations 0000–0016 are additive with tested down paths (`0011` down drops the
  four slice-6 tables; `0012` down drops the three EXCLUDE constraints; `0015`/
  `0016` down drop their indexes/invariant — rehearsed). While the database is
  empty the tested recovery is `DROP SCHEMA public CASCADE; DROP SCHEMA drizzle
CASCADE; CREATE SCHEMA public; npm run db:migrate` (see the runbook). Once data
  exists, migrations must be additive (expand → migrate → contract) with a tested
  data-preserving down path (see `AGENTS.md` Rule 2).
- External writes require a documented rollback and per-source approval
  (`DEC-015`).

## Work log (append-only, newest first)

### 2026-09-20 — Slice-7 review-fix commits (`c82a30f`, `083106a`); five owner decisions + `ADR-0005` accepted; handoff updated

Two atomic commits on `main` since the last handoff update (which recorded the
slice-7 review fixes as an uncommitted working tree at HEAD `60f3ec5`; the tree is
now clean at HEAD `083106a`; nothing applied to DigitalOcean):

- **`c82a30f` — cross-organization reference guards + runbook `0015`/`0016`.**
  Committed the two accepted slice-7 review fixes: `calculateCostCard` and
  `calculatePriceScenario` now org-check every reference (not just
  `productVariantId`) inside `withTransaction`, throwing
  `DomainError("<ref> belongs to another organization")` / `"<ref> not found"`;
  ports gained `findLocation`/`findChannel`/`findRecipeVersion`; and
  `docs/runbooks/persistence-migrations.md` documents migrations `0015`/`0016`
  (order, bullets, down companions, ledger keys, corrected recovery range
  `0000–0016`).
- **`083106a` — pricing-primitive wiring + preflight notes.** Wired the pinned
  domain pricing primitives into the price-scenario outcome, removed two dead
  read APIs, de-duplicated the contribution boundary onto the domain primitive,
  and added the `0014`/`0016` pre-apply preflight notes to the deployment
  runbook. No migration touched.

Owner actions this session: **`ADR-0005` (stock valuation/consumption) is
Accepted** — slice 8 (stock ledger + balances + lots/storage) is unblocked and is
the next task. Five new decisions in `12_OPEN_DECISIONS.md`: `DEC-061`
(multi-tenancy: shared schema with `organization_id` row scoping, RLS possible
later, no schema/DB-per-tenant), `DEC-062` (jobs runtime: pg-boss over the existing
PostgreSQL, worker/scheduler long-lived), `DEC-063` (price-scenario target =
contribution over net price, 6 dp fraction), `DEC-064` (`price_version` +
PRICE-002/003 are the next pricing slice after slice 8), `DEC-065` (golden
fixtures are machine-readable JSON under `tests/fixtures/`; the sign-off trail is
prepared — six files, the reconciliation test
`packages/domain/src/golden-fixtures.test.ts`, and the sign-off mechanics).
Decision count is now 65; next free id `DEC-066`.

Verified (exact): `npm run lint`, `npm run typecheck`, `npm run build` and
`npm run format:check` pass; without `DATABASE_URL` **475 passed / 113 skipped
(588)**; with it **588 passed / 588 (60 files + the new golden-fixture test)**;
`npm audit --omit=dev` = 0.

Rollback: `git revert c82a30f` or `git revert 083106a` independently — neither
touched a migration or generated file. Next: **slice 8 — stock ledger + balances +
lots/storage** (see "Resume here").

### 2026-09-20 — Slice 7 review fixes: cross-org reference guards + runbook 0015/0016 (uncommitted)

Applied the two accepted slice-7 code-review findings on the committed slice-7
tree (HEAD `60f3ec5`; nothing applied to DigitalOcean). No migration or generated
file was touched.

- **Fix 1 (blocker) — cross-organization references were unguarded.**
  `calculateCostCard` and `calculatePriceScenario` org-checked only
  `productVariantId`; the single-column, org-agnostic FKs accepted a
  `location_id`/`channel_id`/`recipe_version_id` from another organization.
  Both commands now resolve every org-scoped reference **inside**
  `withTransaction` and throw `DomainError("<ref> not found")` /
  `DomainError("<ref> belongs to another organization")`, matching
  `registerOperatingCost`. Cost card guards `locationId` (required), `channelId`
  and `recipeVersionId`; price scenario guards `locationId` and `channelId`
  (both optional). `recipe_version` is org-scoped through its parent `recipe`.
  Ports gained `findLocation`/`findChannel` (both stores) and
  `findRecipeVersion` (cost-card store, returning `{ id, organizationId }`);
  implemented in the Postgres adapters (relational queries; a two-step
  `recipe_version` → `recipe` lookup) and in the fakes as seedable public maps.
  Tests: unit rejections (missing/foreign location, foreign channel, foreign
  recipe version; foreign/missing location+channel for the scenario) and one
  cross-org location rejection per Postgres integration test (raw inserts in the
  existing file style — the persistence `test-support` helpers are not exported
  across the package boundary).
- **Fix 2 — runbook.** `docs/runbooks/persistence-migrations.md` now documents
  `0015_calculation_snapshot_cost_card_index.sql`
  (`calculation_snapshot_cost_card_idx`, ledger `1789867750326`) and
  `0016_cost_card_approved_scope.sql` (`cost_card_approved_scope_key` partial
  unique `NULLS NOT DISTINCT WHERE state='approved'`, ledger `1789867797172`):
  migration-order rows, per-migration bullets, down companions, the ledger
  re-apply keys, the empty-database recovery range corrected to `0000–0016`, the
  `0016` index added to the raw-SQL inventory and the never-`push` warning, plus
  invariant-check entries.

Verified (exact): `npm run lint`, `npm run typecheck`, `npm run build` and
`npm run format:check` pass; without `DATABASE_URL` **472 passed / 114 skipped
(586)**; with it **586 passed / 586 (60 files)**. `npx prettier --write` run on
every touched TypeScript file; `docs/` is prettier-ignored and matched by eye.
Rollback: revert/discard the working tree — the change is additive and touches
no migration or generated file. Next: commit (Rule 2), then the owner-gated
slice 8 (see "Resume here").

### 2026-09-20 — Slice 7 cost card + snapshots + price scenario + approval committed (`400c95b`)

Implemented, verified and committed slice 7 per `docs/BUILD_ROADMAP.md` (§4 row 7) on
`main`, at HEAD `8f3ac5d` (slice 6) beforehand:

- **Domain:** new `packages/domain/src/pricing.ts` (the `CALCULATION_CONTRACT.md`
  §10 price-scenario maths: required net price from the target contribution, unit
  contribution before/after labour, break-even input helpers) and
  `packages/domain/src/cost-card.ts` (the §3/§8 cost-card semantics with the
  `DEC-047` cost-source precedence and `DEC-060` calculate/snapshot/approve flow),
  both unit-tested and exported from the domain barrel.
- **Application:** new `CostCardStore` and `PriceScenarioStore` ports and services
  under `packages/application/src/costing/` (`calculateCostCard`,
  `snapshotCostCard`, `approveCostCard` with the supersede rule, `calculatePriceScenario`,
  `submitPriceScenario`, `approvePriceScenario`), plus audit actions and validation.
- **Persistence:** generated migrations `0014_cost_card_pricing` (four deferred
  `price_scenario` columns + `snapshot_component_kind_check`; journal `when`
  `1789866859108`) and `0015_calculation_snapshot_cost_card_index` (the
  `calculation_snapshot_cost_card_idx` covering
  `calculation_snapshot(cost_card_id, created_at)`; `when` `1789867750326`);
  hand-written `0016_cost_card_approved_scope` (the partial-unique
  `cost_card_approved_scope_key`, `NULLS NOT DISTINCT WHERE state = 'approved'`,
  preventing two approved cards in one
  `(organization, product variant, location, channel)` scope — the approve-supersede
  race fix; `when` `1789867797172`). Each has an unjournaled `_down.sql`; 0000–0013
  untouched; ledger 17 rows through `0016`.
- **Decisions:** `DEC-058` (closed `snapshot_component_kind` vocabulary),
  `DEC-059` (the deferred `price_scenario` columns land here), `DEC-060`
  (cost-card calculation/snapshot/approval semantics; "unapprove" deliberately
  not implemented). Next free id is now `DEC-061`.

Adversarial reviews ran and were reconciled, per `docs/BUILD_ROADMAP.md` §2:
`reviewer-qwen` (the §7–§10 maths) — no blockers or majors;
`reviewer-glm` (application code) — no blockers; accepted the approve-supersede race
fix via `cost_card_approved_scope_key`, the missing rejection tests, boundary
validation and the dead-surface removal (the dead `orderBy` documented in the prior
work-log entry);
`reviewer-minimax` (schema/migrations) — clean; accepted the missing
`Calculation_snapshot(cost_card_id, created_at)` index (became `0015`) and a down-file
note. **Declined with reasons:** further index re-shaping, and lifting the
`channelId` "any channel" query limitation.

Verified (exact): `npm run lint`, `npm run typecheck`, `npm run build` and
`npm run format:check` pass; without `DATABASE_URL` **466 passed / 112 skipped
(578)**; with `DATABASE_URL` **578 passed / 578 (60 files)**; `npm audit --omit=dev`
= 0; `db:migrate` applies `0014`–`0016` and re-runs as a no-op; the `0015`/`0016`
down paths were rehearsed. The six golden fixtures in
`docs/phase0/GOLDEN_FIXTURES.md` remain **unsigned** — no cost is "verified" yet.
The 16 slice-7 open (owner) points are recorded in `docs/BUILD_ROADMAP.md` §5.

Rollback: `git revert 400c95b` removes the code, migrations `0014`–`0016` and the
`DEC-058`–`DEC-060` entries together; the migrations are additive with tested down
paths. Next: **slice 8 — stock ledger + balances + lots/storage — blocked (owner)
on `ADR-0005` acceptance (Proposed)**; the unblocked work is owner decisions/sign-offs
(see "Resume here").

### 2026-09-20 — Slice 7 reconciliation: missing tests added, dead `orderBy` removed (uncommitted)

Finished the incomplete slice-7 test surface in the still-uncommitted slice-7 working
tree at HEAD `8f3ac5d`. No migration edits and no application behaviour change beyond
removing the now-dead ordering in the repository read.

- **Dead code:** `listApprovedCostCardsForScope`
  (`packages/persistence/src/repositories/cost-card.ts`) no longer `.orderBy`s
  `calculated_at` — the `cost_card_approved_scope_key` partial unique index
  (`NULLS NOT DISTINCT`, `WHERE state = 'approved'`) guarantees at most one approved
  card per `(organization, product variant, location, channel)`. The JSDoc now states
  the index invariant. `desc` stays imported (still used by
  `listCalculationSnapshotsForCostCard`).
- **Persistence tests (`cost-card.test.ts`):** replaced the failing
  "orders approved cards by calculated_at descending" (it seeded two approved cards in
  one scope, now rejected by the index) with "returns the single approved card in
  scope and excludes drafts"; added "rejects a second approved card in the same
  channel scope" and "rejects a second company-wide approved card (null channel,
  NULLS NOT DISTINCT)" — both assert the `cost_card_approved_scope_key` message via
  `rejectionCause`; added "installs the 0015/0016 ... indexes" querying `pg_indexes`
  for `cost_card_approved_scope_key` and `calculation_snapshot_cost_card_idx`
  (mirroring `costing.test.ts`'s `pg_constraint` guard).
- **Application tests:** `approveCostCard` not-found and cross-organization rejections
  (`cost-card.test.ts`); `approvePriceScenario` from `submitted` succeeds and from
  `rejected` is rejected, plus `calculatePriceScenario` rejecting a negative
  `fixedCost` even when the unit contribution is non-positive
  (`price-scenario.test.ts`).

Verified (exact): `npm run lint`, `npm run typecheck`, `npm run build` and
`npm run format:check` pass; without `DATABASE_URL` **466 passed / 112 skipped (578)**;
with `DATABASE_URL` **578 passed / 578 (60 files)**; `npm audit --omit=dev` = 0.
`DATABASE_MIGRATIONS_URL=… npm run db:migrate` is a no-op (ledger 17 rows through
`0016`); `pg_indexes` confirms both indexes present. `npx prettier --write` run on all
four touched files.

Rollback: the whole slice-7 tree is uncommitted and purely additive — discard the
working tree (or, once committed, `git revert`); migrations `0014`–`0016` are additive
with down companions. Next: adversarial review and atomic commit of slice 7 (see
"Resume here").

### 2026-09-20 — Slice 6 code-review follow-up (uncommitted)

Applied the accepted slice-6 code-review findings to the still-uncommitted slice-6
work (working tree dirty at HEAD `15b9b68`; nothing applied to DigitalOcean). No
behavioural change beyond the added index; dead code removed and two duplications
folded onto the domain primitives.

- **Dead code removed:** `findCostPoolByCode` (interface, Postgres store, fake
  store, repository) and `listCostPools` (repository) plus their imports/assertions
  in `costing.test.ts`; the unused `CostingAuditAction` type and its re-export.
  `listCostPoolsByCode` is kept and its test now asserts the code listing.
- **Migration `0013`:** generated `0013_labor_rate_lookup_index.sql` adds
  `labor_rate_lookup_idx` on
  `(organization_id, cost_center_id, role_code, effective_from)` to cover the
  `findEffectiveLaborRate` as-of lookup; hand-written
  `0013_labor_rate_lookup_index_down.sql` drops it (not in `_journal.json`). Journal
  `when` `1789864504597`; 47 tables total (index only, no table).
- **De-duplication:** `packages/domain/src/index.ts` now re-exports `rescale` and
  `normalizeCurrency`; `toLoadedHourlyRate` delegates to `rescale` and
  `registerOperatingCost` to `normalizeCurrency` (its `DomainError` surfaces
  unchanged; the bad-currency test regex was updated to the shared message).
- **Half-open parity:** a Postgres-gated `findEffectiveLaborRate` test locks
  `asOf === effectiveFrom` (included) and `asOf === effectiveTo` (excluded);
  `isEffective` in the fake cross-references `repositories/costing.ts` as the
  authority.

Verified (exact): `npm run typecheck`, `npm run lint`, `npx prettier --check` on
every touched file pass; without `DATABASE_URL` **404 passed / 88 skipped (492)**;
with `DATABASE_URL` **492 passed / 492 (52 files)**; `npm run build` and
`npm run format:check` pass; `npm audit --omit=dev` = 0. `grep` confirms no source
references to `findCostPoolByCode` / `listCostPools` / `CostingAuditAction`.
Migration: `db:migrate` applies through `0013` (ledger `when` `1789864504597`),
a second run is a no-op, and the down was rehearsed (drop index → delete the
`0013` ledger row → re-migrate restores the index and the ledger row).

Rollback: the slice is uncommitted and purely additive — discard the working tree
(or, once committed, `git revert`); `0013` is additive with the tested down path
above. Next: commit the slice-6 work, then **slice 7 — cost card + snapshots +
price scenario + approval** (see "Resume here").

### 2026-09-20 — Slice 6 operating costs + labour + allocation (uncommitted)

Implemented and verified slice 6 per `docs/BUILD_ROADMAP.md`: `COST-004`, `COST-006`,
`COST-007`, `COST-011`, `COST-013` under `DEC-047`/`DEC-048`/`DEC-006`/`DEC-007`, on
`CALCULATION_CONTRACT.md` §7 and §9. **The work is UNCOMMITTED** — the working tree is
dirty at HEAD `15b9b68` (nothing applied to DigitalOcean). Slice 5's in-flight reviews
were reconciled in the committed `13a29b7`/`15b9b68`.

- **Domain:** new `packages/domain/src/labour.ts` (compounded loaded rate with 2 dp
  per-component rounding, `applyProductiveHoursPct`, `directLaborCost`,
  `labourCostViews`, `contributionBeforeAndAfterDirectLabor`) and
  `packages/domain/src/allocation.ts` (`entityDriverShare`, `allocatedPoolAmount`,
  `allocatedUnitOverhead` with `stop`/`equal_share` fallbacks, `unitFullCost`,
  `fullCostMargin`), both exported from the domain barrel and unit-tested.
- **Persistence:** four new tables in `packages/persistence/src/schema/costing.ts` —
  `operating_cost`, `labor_rate`, `cost_pool`, `allocation_rule` (the `asset`
  register deliberately deferred); new vocabularies `COST_BEHAVIOR`,
  `OPERATING_COST_RECURRENCE`, `ALLOCATION_DRIVER`, `ALLOCATION_FALLBACK`
  (`allocation_fallback` added to `schemas/domain-enums.yaml`); a `dateRange()`
  helper in `columns.ts`; new `repositories/costing.ts`; generated migration
  `0011_cost_allocation.sql` plus hand-written
  `0012_cost_allocation_invariants.sql` (the EXCLUDE constraints
  `cost_pool_no_overlap`, `labor_rate_no_overlap`, `allocation_rule_no_overlap`;
  `operating_cost` deliberately has none), each with a down companion
  (`0011_*_down.sql`, `0012_*_down.sql`). Journal `when` values `1789862475550`
  (0011) and `1789862630158` (0012); 47 tables total.
- **Application:** new `packages/application/src/costing/` — `registerLabourRate`,
  `registerOperatingCost`, `registerCostPool`, `registerAllocationRule`,
  `computeLabourCost`, `allocateCostPool`, a `CostingStore` port +
  `createPostgresCostingStore`, `FakeCostingStore`, `validation.ts` (ISO-date/range
  checks) and `COSTING_AUDIT_ACTIONS`.
- **Decisions:** `DEC-055` (loaded-rate 2 dp per-component rounding;
  `productive_hours_pct` divides the per-paid-hour rate, null = 100 %; paid +
  imputed owner labour share the effective per-productive-hour rate), `DEC-056`
  (allocation fallback `stop` default / explicit `equal_share`; round once at 4 dp),
  `DEC-057` (`cost_pool.code` is versioned, not unique; only overlapping windows
  are rejected). Next free id is now `DEC-058`.

Adversarial reviews ran and were reconciled: `reviewer-qwen` (design, on the §7/§9
maths), `reviewer-minimax` (persistence schema/migration/rollback), `reviewer-glm`
(application code). **Accepted and applied:** the missing `0011` down file (blocker);
`registerCostPool` allowing a non-overlapping successor version (blocker, both code
reviews); deterministic `findCostPoolByCode` + `listCostPoolsByCode`; ISO-date +
currency validation; `equal_share`-without-count and negative-base tests;
same-day/zero-length boundary tests; the `SCOPE_TYPE` comment; runbook notes.
**Declined with reasons:** a closed `denominator_source` vocabulary (would invent
values — recorded as an open owner decision); a shared-only `operating_cost` filter
(no caller; semantics documented); extra composite indexes (low cardinality); the
fake-store tie-break (unreachable given the overlap exclusion); valuing imputed
owner labour at the raw loaded rate instead of the effective rate (`DEC-055`
records the chosen consistent valuation); the `scope_type` structural split
(deferred, comment added).

Verified (exact): without `DATABASE_URL` — lint/typecheck/build/format:check pass,
**404 passed / 87 skipped (491)**; with `DATABASE_URL` — **491 passed / 491
(52 files)**; `npm audit --omit=dev` = 0; `db:migrate` applies through `0012` and a
re-run is a no-op; both down paths rehearsed (`0011` down drops the four tables,
both ledger rows deleted; re-migrate restores 47 tables and the three
constraints).

Rollback: the slice is uncommitted and purely additive — discard the working tree
(or, once committed, `git revert`); migrations `0011`/`0012` are additive with the
tested down paths above. Next: commit this work (Rule 2), then **slice 7 — cost
card + snapshots + price scenario + approval** (see "Resume here").

### 2026-09-19 — Slices 4 review fixes and slice 5 recipes committed (`e3706c0`, `841da96`); DEC-052; handoff updated

Two atomic commits on `main` since the last handoff update (which recorded HEAD
`52aaad8`/the slice 4 status; the tree is clean at HEAD `841da96`):

- **`e3706c0` — slice 4 review fixes.** `computeLandedCost` now throws on a negative
  net pack price; an exact-HALF_UP test was added (`0.2469 / 2 = 0.12345 → 0.1235`);
  the receipt audit payload carries `gross_total`; a same-timestamp price test covers
  the half-open window case; migration `0007` (hand-written, the
  `goods_receipt_line_accept_qty_guard` BEFORE INSERT/UPDATE trigger guarding a
  zero-accepted line on an accepted receipt, since a PostgreSQL `CHECK` cannot read
  the parent row); migration `0008` relaxes
  `supplier_price_effective_range_check` from `>` to `>=` so half-open empty windows
  are allowed. Recorded as **`DEC-052`** (accepted in `12_OPEN_DECISIONS.md`).
- **`841da96` — slice 5 recipes / sub-recipes / version / yield / allergens.** The
  recipe tables already existed from the slice-0 core (`recipe`, `recipe_version`,
  `recipe_line`, `recipe_version_no_overlap` in `0002`), so migration `0009` adds
  only `allergen` and `recipe_allergen` plus the `ALLERGEN_SOURCE` vocabulary.
  Domain adds the `CALCULATION_CONTRACT.md` §6 maths (`usableYieldRate`,
  `requiredPurchaseQuantity`, `lineCost`, `computeRecipeCost`) with HALF_UP at
  B0/B2/B3, recipe-version state/effective-dating helpers, and a sub-recipe cycle
  check. Application adds `registerRecipe`, `registerAllergen`,
  `registerRecipeVersion`, `loadRecipeVersionAsOf` and `computeRecipeCost` with the
  `DEC-047` cost-source precedence; persistence adds the recipe/allergen
  repositories.

Verified: **396 tests** with `DATABASE_URL`, **327 passed / 69 skipped** without it;
lint/typecheck/build/format/db:generate clean; the migration rehearsal applied
`0000–0009` (43 tables), with a no-op re-run rehearsed and the down path rehearsed.

Adversarial reviews: the two slice-5 reviews (`reviewer-qwen` on the §6 maths and
cost-source precedence, `reviewer-minimax` on the migration/schema) were **in flight
when `841da96` was committed** — if any finding is still unreconciled, reconcile it
first at the start of the next session (see "Resume here"). **`DEC-052`** was the only
new decision; slice 5 left **eight deliberate ambiguities** for the owner, now tracked
under "Open decisions / inputs" and in `docs/BUILD_ROADMAP.md` §5.

Rollback: both commits are independently revertible (`git revert e3706c0` would
remove the slice 4 fixes and migrations 0007/0008 together with the code; `git
revert 841da96` the slice 5 code; migrations are additive with rehearsed down
paths — see "Reversibility").

### 2026-09-19 — Auth slices 1b-iii→1e, master data (2–3), UI tokens, decision briefs, drizzle upgrade

Committed a run of slices on `main`, in order: `2ce8847` password reset + access
control (slice 1b-iii); `5776914` reset neutrality (no token in the result, a
`deliverResetToken` port, org-scoped redemption); `87f9ced` unit + supplier-pack
value objects (slice 2); `4ccfb23` slice 2 review fix (strict package-to-base);
`aa2eff5` design tokens package; `60ac52e` auth hardening (fail-closed MFA
config, 32-byte key validation, `isAuthorizedFor` throws on an empty
requirement, audit before/after the secret guard); `a83a312` token-driven UI
primitives; `dad2ff0` UI layout reference note; `c8e86e0` DEC-049 assessment;
`21e9c72` deployment cost estimate; `018930d` multi-tenancy posture; `3505aa8`
jobs-runtime comparison (recommends pg-boss); `bfc5f74` runbook pre-apply
inputs; `74ac467` UI primitive accessibility/form-wiring fixes; `5c42c1d` auth
HTTP surface (slice 1c: routes, cookies, CSRF/same-origin, per-IP limiter,
login/2FA/reset pages); `a869227` master-data schema + conversion graph (slice
3: `unit_conversion`, `supplier`, `supplier_item`, `cost_center` + migration
0004); `07af21d` TOTP enrolment + recovery codes (slice 1d); `b8897bf`
`unit_conversion` overlap invariants (migration 0005) + conversion-graph
hardening (reject self-edges, rescale per hop, 32-hop cap, round-to-zero
rejection) + `DEC-050`/`DEC-051`; `e51a957` first-owner bootstrap + MFA
enrolment surface (slice 1e); `cc86f13` drizzle-orm 0.45.2 / drizzle-kit 0.31.10
upgrade, closing DEC-049 (`npm audit --omit=dev` = 0); `0cce93b` MFA disable now
atomic (revocation inside disable's transaction) + bootstrap `--dry-run` +
runbook proxy/dry-run notes.

Verified per slice: with `DATABASE_URL` the suite grew from 318 tests before the
drizzle upgrade to 321 after; without it 265 passed / 53 skipped;
lint/typecheck/build/format:check green at each commit. Review findings
accepted: the conversion-graph invariants and hardening, the atomic MFA
disable, the neutral password reset, and token-family separation. Declined with
reasons: none new this session — the earlier declines stand as recorded (the
drizzle advisory was governed by DEC-049, now closed by the upgrade; the
domain-layer logging policy; the provisional lockout escalation). Slice 4 was
started by a parallel session and is left uncommitted in the working tree; its
resume entry is at the top of this file.

Rollback: each item above is its own commit — `git revert <sha>` per slice. The
drizzle upgrade changed lockfile and migration metadata only; migrations
0000–0005 are additive with tested down paths.

### 2026-09-19 — Auth slice 1b-iii: password reset + access control (committed `2ce8847`)

Completed the server-side auth application surface on the committed 1b-ii flow. Persistence:
new `packages/persistence/src/repositories/access.ts` (`listUserRoles`, `listUserLocationScopes`,
`listAssignableRoles`, `assignRole` — idempotent upsert against the `NULLS NOT DISTINCT`
`user_role_key`, `removeRole`, `replaceLocationScopes`) exported from the package index, with
rolled-back PostgreSQL integration tests (round-trip, duplicate grant, remove no-op, exact
scope replacement). Application: `AuthStore` gained reset-token create/find/consume,
role/scope list/assign/remove/replace and `setUserStatus`, and `createPostgresAuthStore`
implements them; `AuthDeps` gained `passwordResetTtlMinutes` and an optional
`passwordHashOptions` cost seam. New `password-reset.ts` (`beginPasswordReset` is always
neutral and stores only the token hash; the plaintext token is returned only for out-of-band
delivery and never logged/audited; `completePasswordReset` claims the token atomically,
hashes the new password, revokes every session and audits in one transaction) and `access.ts`
(`loadUserAccess`, the pure `isAuthorizedFor` with no implicit admin bypass, `assignRole`
which revokes sessions, `replaceLocationScopes`, `disableUser` which disables and revokes in
one transaction). `AUTH_AUDIT_ACTIONS` gained `auth.password_reset.{requested,completed,failed}`,
`auth.access.{role_changed,scopes_changed}` and `auth.user.disabled`; `audit()` now passes
`before`/`after` jsonb. The in-memory `FakeAuthStore` moved to `test-support.ts` and gained
the new methods; new unit tests cover the neutral reset, single-use/expiry, session
revocation after reset, role/scope allow/deny, role-change revocation and disable+reject.
No migration and no new dependency.

Verified: `lint`, `typecheck`, `build` pass and all changed/new files pass `format:check`;
slice-scoped tests **41 passed / 32 skipped** without `DATABASE_URL` and **73 passed** with
it; integration tables left with zero rows. Full-repo `test` currently also fails 3
`packages/ui/src/{contrast,tokens}.test.ts` assertions from the concurrent workstream, and
`format:check` flags those concurrent `packages/ui` files — neither is part of this slice.
Roadmap statuses are left for the commit step.

Rollback: discard this uncommitted change (or `git revert` once committed); the modules are
additive and imported by no runtime yet; the schema already existed.

### 2026-09-19 — Auth slice 1b-ii: review fixes (atomicity, MFA lockout)

Applied both review findings before 1b-iii. Concurrency: `verifyMfa` now advances the TOTP
replay counter and consumes recovery codes with atomic compare-and-sets in
`packages/persistence/src/repositories/totp.ts` (`advanceLastUsedCounter`,
`consumeRecoveryCodeHash`), replacing the read-then-write `setLastUsedCounter`; a lost
compare-and-set is treated as a replay, so two racing requests cannot both get a session.
Atomicity: `AuthStore` gains `withTransaction`, the Postgres adapter binds a store to
`db.transaction`, and `authenticate`/`verifyMfa`/`logout`/`logoutAll` run inside it so the
audit row and the state change commit together. Security gap: MFA attempts now share the
progressive lockout (`computeLockout`/`isLocked`/`recordLoginFailure`) and a successful
password step no longer resets the counter when MFA is still required, so second-factor
brute force is bounded; `openSecret` failure fails closed with a `secret_unseal_failed`
audit; `AuthUser.status` and `app_user.status` are typed as the `UserStatus` union
(type-only, `db:generate` reports no schema change). Declined: the drizzle-orm advisory is
already governed by DEC-049.

Verified: **120 tests** (18 files) with `DATABASE_URL` and **94 passed / 26 skipped**
without it; `lint`, `typecheck`, `build` and `format:check` pass; the new tests cover MFA
lockout after repeated failures, a valid code rejected once locked, a tampered sealed
secret, and single-use recovery-code consumption.

Rollback: discard this uncommitted change (or `git revert`); the compare-and-set primitives
are additive and the previous `setLastUsedCounter` behaviour is simply replaced.

### 2026-09-19 — Auth slice 1b-ii: application sign-in / MFA / session flow

Built `packages/application/src/auth/` on the 1b-i repositories: an `AuthStore` port with a
`createPostgresAuthStore` adapter (transaction-friendly, `db.transaction((tx) => ...)`),
`authenticate` (always runs one verification including the dummy path for an unknown account,
returns the single `AUTH_ERROR_GENERIC`, applies `computeLockout`/`isLocked`, resets the
counter and rehashes on success, requires MFA without issuing a session when `totpEnabled`),
`verifyMfa` (opens the sealed secret, rejects a replayed counter, consumes a recovery code
once), `verifySession`/`logout`/`logoutAll`, and an `AUTH_AUDIT_ACTIONS` vocabulary; every
outcome writes an audit row. `packages/config` gained `SESSION_TTL_MINUTES` (480),
`PASSWORD_RESET_TTL_MINUTES` (30) and an optional `TOTP_SECRET_ENCRYPTION_KEY`, and the
persistence layer gained `findUserById`.

Verified: **117 tests** (18 files) with `DATABASE_URL` against local PostgreSQL 16 and
**92 passed / 25 skipped** without it; `lint`, `typecheck`, `build` and `format:check` pass.
Password reset, role/location authorization and the admin operations are deferred to slice
1b-iii, so this slice is scoped to the sign-in path only.

Rollback: discard this uncommitted change (or `git revert` once committed); the module is
additive and imported by no runtime yet.

### 2026-09-19 — Auth slice 1b-i: accepted review findings applied

Applied the accepted external-review findings to the uncommitted 1b-i persistence layer.

- `findUserByIdentifier(db, organizationId, identifier)` — adds
  `eq(appUser.organizationId, organizationId)`, keeps the `lower(btrim(...))`
  match, selects `limit(2)` and throws on a cross-column collision (one user's
  username = another's email) instead of silently picking one.
- Fail loud: `recordLoginFailure` throws on a non-future `lockedUntil`;
  `consumeResetToken` gained `gt(expiresAt, at)`; `setLastUsedCounter` throws on a
  negative counter and on zero matched rows (no enrolment).
- `findActiveSessionByTokenHash` inner-joins `app_user` and requires
  `status = "active"`, so off-boarding/role change is a real revocation barrier
  (a session racing `revokeAllSessionsForUser` still fails validation); JSDoc
  documents the requirement.
- Caller-audit JSDoc (append the `audit_event` row in the same transaction,
  ADR-0003) added to `recordLoginSuccess`, `updatePasswordHash`, `setUserStatus`
  and `revokeAllSessionsForUser`.
- Migration down path: new `0003_user_totp_last_used_counter_down.sql` (not in
  `_journal.json`), referenced from the runbook; 0000–0002 are bootstrap-generated
  with no down companion. `_journal.json` gained its trailing newline.

Verified: `lint`/`typecheck`/`build`/`format:check` pass; **80 passed / 24 skipped**
without `DATABASE_URL` and **104 passed (17 files)** with it; integration tables
left with zero rows (`organization`, `app_user`, `auth_session`, `user_totp`,
`password_reset_token`, `audit_event`). Down rehearsal: applied the down file
(column gone), and — because drizzle-kit tracks applied migrations in the ledger —
re-applied by deleting the 0003 ledger row and re-running `db:migrate` (column and
check restored, ledger back to 4; database left migrated). No blocker findings
remained unapplied.

Rollback: discard this uncommitted change (same as the rest of 1b-i); the down
file is additive and the DB is left migrated.

### 2026-09-19 — Auth slice 1b-i: persistence access layer

Built the server-side persistence/auth access layer on the existing schema (uncommitted).

- **Domain crypto:** `packages/domain/src/auth/secret-box.ts` — `parseSecretKey` (32-byte
  base64), `sealSecret`/`openSecret` (AES-256-GCM via `node:crypto`, self-describing
  `v1.<iv>.<ciphertext>.<tag>` base64url, random 12-byte IV), exported from the auth barrel;
  `DomainError` on wrong length/key, tamper, malformed input or unknown version, and never
  partial plaintext.
- **Schema + migration:** added nullable `user_totp.last_used_counter` with
  `user_totp_last_used_counter_check` (`null or >= 0`); generated
  `0003_user_totp_last_used_counter.sql` (+ meta snapshot + journal), header records the down
  path `ALTER TABLE "user_totp" DROP COLUMN "last_used_counter";`. The migration table and
  invariant checks in `docs/runbooks/persistence-migrations.md` were updated.
- **Persistence client + repositories:** `client.ts` (`createDb(connectionString)` →
  `{ db, pool, close }`, `Database`/`NodeDatabase`/`DatabaseTransaction` types; the caller
  supplies the URL, no env reads); `repositories/{users,sessions,totp,password-reset,audit}.ts`
  all taking `db` first, using parameterised `eq`/`and`/`sql` (no identifier interpolation,
  DEC-049). `sessions` stores only the token hash; `consumeResetToken` is conditional on
  `used_at is null` (single-use); `setLastUsedCounter` is `greatest(current, next)`
  (monotonic); `audit` inserts only (the DB trigger enforces append-only). All exported from
  `packages/persistence/src/index.ts`; added `@types/pg` devDependency.

Verified: `npm run lint && npm run typecheck && npm run test && npm run build &&
npm run format:check` pass; **80 passed / 17 skipped** without `DATABASE_URL` and **97 passed
(17 files)** with it (integration files `users` 4, `sessions` 3, `totp` 3, `password-reset` 3,
`audit` 4 — each `describe.skipIf(!process.env.DATABASE_URL)` and run in rolled-back
transactions so the append-only audit rows are not left behind). Against local PostgreSQL 16:
reset the empty DB, the first `DATABASE_URL=... npm run db:migrate` applied 0000–0003 (ledger
count 4), a second run was a no-op, `\d user_totp` shows `last_used_counter integer` plus the
check, a negative value is rejected, and a re-run of `npm run db:generate` reports "No schema
changes" (schema/snapshot in sync).

Rollback: discard this uncommitted change. The code is additive (no runtime imports it yet);
migration 0003 is additive with the documented down path above, and while the DB is empty the
runbook's `DROP SCHEMA public/drizzle CASCADE` + `db:migrate` replay remains valid.

Next: **Auth slice 1b-ii** (application commands/queries on this layer).

### 2026-09-19 — Auth slice 1a: domain auth primitives

Built `packages/domain/src/auth/` (exported from `packages/domain`): Argon2id-only password
hashing/verification with a timing-equalising dummy path and `needsRehash` (algorithm,
version and all cost params), RFC 6238 TOTP on `node:crypto` (canonical base32 decode,
±window verification, replay rejection by persisted counter, fails closed on an undecodable
secret), single-use recovery codes (full-scan verify, no early exit), domain-separated
opaque session/password-reset tokens (SHA-256 at rest, constant-time compare), a progressive
lockout policy, and `AUTH_ERROR_GENERIC`. New runtime dependency: `@node-rs/argon2`
(prebuilt musl + darwin), verified loading inside the built Alpine image.

Verified: **71 tests** (11 files; +41 auth), `lint`, `typecheck`, `build`, `format:check`
pass; `docker build` succeeds and `argon2-ok` under Alpine. Two adversarial reviews
(reviewer-qwen, reviewer-glm) ran: accepted fixes were the TOTP fresh-over-stale window
ordering, failing closed on a corrupt secret, canonical base32 validation, and token-family
domain separation (plus the missing tests). Declined with reasons: logging/surfacing
corrupt-hash verification errors (the domain layer must not log; the application layer owns
that) and changing the documented 9th-failure lockout escalation (provisional, tunable). A
unit test for a TOTP collision across window counters is not constructible in reasonable
time (~3×10⁻⁶ per counter pair) and is covered by inspection of the fresh-wins loop.

Rollback: revert this commit; the module is additive and referenced by no runtime yet.

### 2026-09-19 — Deployment foundation verified end to end; DEC-049 security pin

**Review fixes (2026-09-19):** applied the accepted code-review findings. (1) **CRITICAL** — added
`infra/bootstrap/database-grants.sql`, the idempotent privilege bootstrap for the least-privilege
`migrator`/`app` users (DO API/console users get the `normal` role and no privileges; ADR-0012 keeps
the pre-deploy job on `migrator`, not `doadmin`), referenced from `infra/modules/database/main.tf`
and documented as a required first-deploy precondition in `docs/runbooks/deployment.md`. (3)
Removed the `RUN chown -R nextjs:nextjs /app` Dockerfile layer, using `COPY --chown=nextjs:nextjs`
in the runner stage instead. (4) `migrate.mjs` now passes a minimal env (`PATH`, `HOME`, `NODE_ENV`,
Windows `SystemRoot`/`SYSTEMROOT`, `DATABASE_URL`) to the `drizzle-kit` child instead of the whole
parent environment. (5) Documented that `npm run db:migrate` is the only sanctioned migration
command (`drizzle.config.ts` + `docs/runbooks/persistence-migrations.md`); a manual
`drizzle-kit migrate` must take the same `8675309` session advisory lock. (2) The `drizzle-orm`
runtime CVE gate (**DEC-049**) is now also noted in the deployment runbook's migration section.
Re-verified: lint/typecheck/test/build/format:check pass; migrations still apply and a second run is
a no-op; image builds, runs as `nextjs`, `/api/health` returns `{"status":"ok"}`; Terraform `fmt
-check -recursive` + `validate` green in both envs.

Documented and verified the deployment foundation without changing code: `infra/` is
scaffolded and validated **offline**, the `apps/worker` / `apps/scheduler` stubs and the
advisory-locked `packages/persistence/scripts/migrate.mjs` behave as designed, and the image
packages the migration SQL and tooling. **Nothing was applied** — no DO resource or Terraform
state exists.

Evidence reproduced this session: Terraform 1.16.3 (`.terraform-version`), DO provider 2.101.1
with `.terraform.lock.hcl` (linux_amd64 + darwin_arm64) committed in both env dirs;
`terraform fmt -check -recursive` clean; `init -backend=false` + `validate` Success in both
envs; offline `plan -refresh=false` with a dummy `DIGITALOCEAN_TOKEN` = **16 to add / 0 change /
0 destroy** per env (VPC, project, DB cluster/db/2 users/pool, Spaces bucket + scoped key, app,
firewall, 4 DB monitor alerts; DNS module opt-in, 0 resources). Runtimes: `WORKER_TICKS=1` and
`SCHEDULER_TICKS=1` stubs exit 0. Migrations: no URL → exit 1 naming both variables with no URL
printed; `DATABASE_MIGRATIONS_URL=... npm run db:migrate` applies 0000–0002 under the advisory
lock and a second run is a no-op. Packaging: `docker build` succeeds, the image runs as non-root
`nextjs`, contains `packages/persistence/drizzle/{0000,0001,0002}.sql` + `meta/` and
`node_modules/.bin/drizzle-kit`, and `/api/health` returns `{"status":"ok"}`. `lint`, `typecheck`,
`test` (6 files / 24 tests), `build`, `format:check` pass.

Security finding → **DEC-049**: because `drizzle-orm` is now a runtime dependency, the ADR-0002
pin `0.38.4` shows **1 high** in `npm audit --omit=dev` (GHSA-gpj5-g38j-94v9 / CWE-89). Accepted
only while identifiers/aliases are code-controlled; upgrade to `>=0.45.2` (breaking, matching
`drizzle-kit`, migration re-verification) before user input reaches identifier/alias builders and
before production. Recorded in `12_OPEN_DECISIONS.md`; ADR-0002 open items extended.

Docs updated: ADR-0012 (scheduler-as-worker deviation + refreshed open items), ADR-0002,
`docs/runbooks/deployment.md` (offline validation, state-bucket bootstrap, packaging /
`.dockerignore`, advisory-lock migration, CI jobs, verified/pending checklist),
`docs/runbooks/persistence-migrations.md` (advisory lock `8675309`, session-scoped, direct/session
only), README layout, and this file.

Post-review hardening: guarded the worker/scheduler numeric env parsing (a bad interval or
`*_TICKS` value now exits non-zero with a clear message instead of busy-looping), removed the
duplicate database→project assignment so the env-root `digitalocean_project_resources` is the
single attachment, and fixed the `aquarela-staging-staging` tag to `aquarela-staging` (both env
roots consistent). Also corrected the stale decision count in `AGENTS.md` (49 accepted, next
`DEC-050`), the README container-image claim (one parameterized image ships devDependencies on
purpose), and pinned `drizzle-orm@0.38.4` / `drizzle-kit@0.30.6` to match ADR-0002.

Next: the **Auth slice** (`DEC-013` / ADR-0003). Rollback: discard the uncommitted docs (or
`git revert` once committed); nothing was applied.

### 2026-09-18 — Terraform infrastructure scaffolded and validated (uncommitted)

Built the `infra/` Terraform layout for DigitalOcean App Platform per
`docs/runbooks/deployment.md`: modules `project`, `networking`, `spaces`,
`database`, `app-platform`, `monitoring`, `dns` (each with `main.tf`,
`variables.tf`, `outputs.tf`, `versions.tf` pinned `~> 2.101`) and env roots
`staging`/`production` (`backend.tf` partial S3/Spaces, `providers.tf`, `main.tf`,
`variables.tf`, `outputs.tf`, `*.tfvars`). Region `ams3` throughout (DEC-014).

Key shapes, verified against provider **v2.101.1** schemas (dumped with
`terraform providers schema -json`): Managed PostgreSQL 16 on the VPC with `app` +
`migrator` users, a transaction pool, and both a pooled `DATABASE_URL` and a
direct/session `DATABASE_MIGRATIONS_URL` built with `format` + `urlencode`; App
Platform spec with `web` + `worker` + `scheduler` (the scheduler is a long-lived
worker because v2.101.1 exposes **no `SCHEDULED` job kind**) + exactly one
`PRE_DEPLOY` `migrate` job; four DBaaS monitor alerts; opt-in `dns` module
(`manage_dns` default false). The database firewall and `digitalocean_project_resources`
live at the env root to avoid the database → app-platform → database cycle.
Root variables are non-secret: `digitalocean_token` defaults to null so the provider
reads `DIGITALOCEAN_TOKEN`; `slack_webhook_url` is marked sensitive and left empty.

Verified (exact commands in "How to verify"): `terraform fmt -check -recursive`
clean; `init -backend=false` + `validate` green for both envs; offline
`plan -refresh=false -lock=false -input=false -var-file=<env>.tfvars` with
`DIGITALOCEAN_TOKEN=dop_v1_dummy` = **16 to add, 0 to change, 0 to destroy** per env
(no API calls). `.terraform.lock.hcl` written for linux_amd64 + darwin_arm64 via
`providers lock`. Added `.terraform-version` (1.16.3) and Terraform ignores to
`.gitignore`; no binary or `.terraform/` committed.

Residual/deliberate: the cluster is assigned to the project twice (its own
`project_id` and the root `project_resources`) — idempotent but a drift watchpoint;
the DB URLs are assembled by hand rather than using the provider's `private_uri`
(which does not urlencode); the scheduler-as-worker is a provider-limitation
workaround with a documented upgrade path. `plan` needed `backend.tf` set aside
because `init -backend=false` cannot plan with a configured backend block; restored
byte-identical afterwards.

Rollback: discard the uncommitted `infra/` files (or `git revert` once committed).
No `apply`, so no cloud resource or state exists.

### 2026-09-18 — Runtime stubs, dependency fixes and advisory-locked migrate wrapper

Added the migrator and runtime boot stubs the App Platform spec needs.
`packages/persistence/scripts/migrate.mjs` is a plain-Node ESM wrapper that resolves
`DATABASE_MIGRATIONS_URL ?? DATABASE_URL`, takes a Postgres session advisory lock
(8675309; serialises overlapping pre-deploy jobs — Spaces has no Terraform state
locking), runs `npx --no-install drizzle-kit migrate` as a child in
`packages/persistence`, always releases the lock and propagates the child exit code;
`drizzle.config.ts` now prefers `DATABASE_MIGRATIONS_URL` too. `drizzle-orm` moved to
`dependencies` (schema modules import it at runtime) and `db:migrate` now runs the
wrapper. New `apps/worker` / `apps/scheduler` workspaces boot a long-lived process
importing `@aquarela/config` + `@aquarela/logger`, with `*_TICKS` smoke hooks and
graceful SIGTERM/SIGINT shutdown; root `tsconfig` now typechecks them and `.env.example`
documents the direct/session `DATABASE_MIGRATIONS_URL`.

Verified: lint/typecheck/test (24 tests)/format:check all pass; both stubs print their
start line and exit 0 under the `*_TICKS=1` smoke env; the wrapper exits 1 with a clear
message (no URL printed) when neither URL is set; against local Postgres 16 the first
`db:migrate` applied all 3 migrations (35 tables) and the second was a no-op; the
`DATABASE_MIGRATIONS_URL` precedence was confirmed. `tsx@4.23.13` installed. Residual:
`npm audit --omit=dev` now flags `drizzle-orm@0.38.4` (GHSA-gpj5-g38j-94v9, high)
because it is a runtime dep; the fix is the breaking 0.45.2 upgrade, deferred
(ADR-0002 pins 0.38.4).

Rollback: revert the commit (new files are additive; the wrapper only changes how
`db:migrate` is invoked). No database change beyond the already-bootstrap migrations.

### 2026-09-18 — Deployment architecture on DigitalOcean (uncommitted)

Owner decisions: application runtimes (`web`, `api`, `worker`, `scheduler`) deploy as separate
**DigitalOcean App Platform components**; **DO Managed PostgreSQL is kept**, so **DEC-014 stands
unchanged** and no new decision-register entry was required; **Terraform** provisions the
infrastructure; **DO Functions** are permitted only for stateless/webhook/light scheduled work,
never the transactional API. The repo stays a **modular monolith**, not microservices.

Docs added/revised: `docs/adr/0001-application-framework-and-deployment.md` promoted to
**Accepted**; new `docs/adr/0012-deployment-topology-and-service-runtimes.md` and
`docs/runbooks/deployment.md`; `02_ARCHITECTURE.md` and `00_README.md` reconciled to the new
topology (migration order, one-repo/multiple-runtimes wording). Two external reviews found no
architectural blockers but flagged operational gaps and two cross-document contradictions; the
accepted fixes are applied: migration ownership and safety (one `web`-owned, advisory-locked
pre-deploy job with a direct/session `DATABASE_MIGRATIONS_URL` and a tested down path; never
`drizzle-kit push`), the resolved packaging choice (one parameterized Dockerfile with
`source_dir: "."`, migrator image must carry `drizzle-kit`), Terraform state handling (no Spaces
state locking → single-runner apply), and the backup/restore/RTO runbook section.

Rollback: docs only and uncommitted — discard the working-tree changes (or `git revert` if
committed).

### 2026-09-18 — Persistence slice: Drizzle schema and first migrations (uncommitted)

Built the Drizzle persistence core for the Phase 1–2 scope in
`packages/persistence/`: 35 tables (organization/identity, catalog,
tax/fees/FX, supplier pricing, recipes, products, costing snapshots, inventory
ledger, outbox/audit), with migrations `0000_enable_extensions` →
`0001_phase1_core` → `0002_invariants` under `packages/persistence/drizzle/`.
`@aquarela/persistence` gained the `pg` driver and a `db:migrate` script; the
runbook `docs/runbooks/persistence-migrations.md` documents generate/apply and
recovery.

Two owner decisions this session: (1) the schema scope is the Phase 1–2 core
(35 tables), with the remaining domains deferred; (2) `schemas/domain-enums.yaml`
wins vocabulary conflicts, and `docs/phase0/DATA_DICTIONARY.md` and
`schemas/phase1_2_draft.sql` were reconciled to it. ADR-0002
(`docs/adr/0002-orm-and-migrations.md`) was promoted to **Accepted**.

Verified by an independent apply of every migration to an empty PostgreSQL 16
(Docker), the invariant checks recorded in the runbook (append-only rejection,
exclusion constraints, `NULLS NOT DISTINCT`, deferrable FKs), the documented
empty-DB recovery replay, and all checks (`format:check`, `lint`, `typecheck`,
`test` — 24 tests, `build`, `npm audit --omit=dev` = 0).

Post-review hardening: added five indexes (`recipe_line_version_idx`,
`cost_card_variant_idx`, `price_scenario_variant_idx`, `audit_event_entity_idx`,
partial `stock_movement_reversal_idx`), a CI `postgres:16-alpine` service with a
`db:migrate` step, shared `rangeCheck`/`approvalCheck`/`rate` column helpers
replacing hand-retyped SQL, `btrim` identifier normalization for `app_user`
username/email uniqueness (whitespace-variant duplicates now rejected), and
removed the dead `isNull` helper. The bootstrap migrations were regenerated
cleanly (`0000` → `0001` → `0002`) and re-verified end to end.

Rollback: the slice is uncommitted, so discard the working-tree changes (or, if
committed, `git revert`); the database recovery path is the forward-only
bootstrap sequence in the runbook, valid only while the database is empty.

### 2026-09-18 — Session handoff and reversibility rules (commit `e55ea23`)

Added the living handoff/work log and the mandatory reversibility rules
(`AGENTS.md` Rules 1–2); recorded the rollback approach for every change. The
handoff has since moved into this repo-local `CONTEXT.md` so orientation never
depends on files outside the repository.

### 2026-09-18 — Foundation scaffold (commit `bb464d6`)

TypeScript foundation: npm workspaces, tooling (ESLint flat config, Prettier,
tsc, Vitest), package boundaries (`config`, `logger`, `domain`, `application`,
`persistence`), a proof-of-boundary value type, CI and a multi-stage container.
Docker build and the `/api/health` check verified.

### 2026-09-18 — Baseline Phase 0 package (commit `536d63e`)

Committed the specification (`00_README.md` … `13_AGENT_BUILD_BRIEF.md`), the
decision register, the Phase 0 artifacts under `docs/phase0/`, the schema drafts,
and ADRs `0001`–`0011` under `docs/adr/`.

### 2026-09-18 — Labour assumptions and cost-source decisions (DEC-047/DEC-048)

Owner-provided labour rates and employer charges captured in
`docs/phase0/LABOUR_ASSUMPTIONS.md`; ad-hoc grocery cost-source precedence
(`DEC-047`) and owner production labour imputation (`DEC-048`).

### 2026-09-18 — Sample analysis and import artifacts

Profiled the Frontline item list + template, monthly report layout, legacy
Zettle/POSX sales export and product-setup screenshots, and generated an açaí
import in Frontline template format. See `docs/phase0/SAMPLE_ANALYSIS.md`,
`docs/phase0/FRONTLINE_PRODUCT_SETUP_NOTES.md` and `samples/generated/`.

### 2026-09-14 → 2026-09-18 — Phase 0 assessment and decision closure

All 48 decisions accepted with owners and phases (see `12_OPEN_DECISIONS.md`),
plus the Phase 0 artifact set (`docs/phase0/`) and ADRs `0001`–`0011`.

## Update protocol

Add a dated entry at the top of the work log with: date, session focus, what
changed, how it was verified, and what comes next. Rewrite the **`Resume here
(next session)`** section for the new next step at the end of every session — even
small or docs-only ones — since it is the single entry point for continuing work;
if there is no next step or it is blocked, say so explicitly and name the blocker.
When the user says **"resume the work"** (or "resume"), read that section and
continue from it without re-asking for context. Update **Current status**
(including git HEAD) and **Next up** in the same pass, and note any new open
decisions or inputs. Handoffs and context live in this repo only — never write
them to a temp directory or any path outside the repository.
