# Project context

Canonical orientation for this repository: read this first when resuming work,
and update it at the end of any session that changes anything (code, docs,
decisions, data) — per `AGENTS.md` Rule 1. Reference artifacts by path; don't
duplicate their content.

## Resume here (next session)

**Say "resume the work" and start here.** A fresh session must be able to continue
from this section alone.

**Next task:** **commit the row-11 work + the cross-cutting error-handling fix +
docs** (three commits), then take up **row 12** (sales + settlements +
reconciliation — the next slice; `ADR-0008` is accepted 2026-09-20) — otherwise
proceed to the **price-version work (`DEC-064`)** and the
**deployment rehearsal**.

**State:** `main` HEAD `7f6aa78`; the working tree has uncommitted **row 11
(import framework + external mappings)** work plus a cross-cutting error-handling
fix, about to be committed as three commits. Row 11 is **complete**: migration
`0022` (tables `import_run`, `import_staging_row`, `external_mapping`),
vocabularies `IMPORT_STATUS`/`MAPPING_STATE`/`IMPORT_POSTING_POLICY`, domain
`packages/domain/src/sales-mapping.ts` (`resolveExternalEntity` — SKU-first then
external id, with both `DEC-033` conflict directions), application
`packages/application/src/imports/**` (create/stage/validate/map/dispose/preview +
list/get), web `/api/v1/imports/**` and `(app)/sales/**` (landing + import runs
list + run detail with diagnostics, staging rows, dispositions and preview), and
`apps/web/scripts/seed-imports.ts`. The import slice deliberately stops at
`validated`/`needs_review` — **row 12 was NOT built** and is the next slice
(`ADR-0008` accepted 2026-09-20, owner-delegated in-session, together with
`ADR-0007`; the I1 channel/SKU confirmations remain recorded inputs; the
`/sales` page marks Reconciliation "not yet implemented — row 12 is owner-gated
on ADR-0008" — stale text to update when row 12 lands); row 13 is no longer
ADR-gated and follows row 12.
The cross-cutting fix: `apps/web/lib/http.ts` `jsonError` now takes a message and
`mapErrors` maps `DomainError`→400 with the authored message; all ~40 non-auth
`DomainError` branches pass `error.message`; auth routes stay generic
(`ADR-0003`).

**Programme direction (standing user instruction):** proceed autonomously — per task:
parallel background agents → adversarial review + fixes → document status and next
steps → commit → next task.

**Scope (do):** (1) commit in **three commits** — (a) the **row-11 import
slice** (migration `0022` + vocabularies + domain `sales-mapping.ts` +
application `imports/**` + web `/api/v1/imports/**` + `(app)/sales/**` +
`seed-imports.ts`), (b) the **error-handling fix** (`apps/web/lib/http.ts` +
the ~40 non-auth `DomainError` call sites; auth routes untouched), (c) the
**docs update** (`CONTEXT.md`, `docs/BUILD_ROADMAP.md`) — each with verification
evidence + rollback approach in the body (per `AGENTS.md` Rule 2); (2) start
row 12 (sales + settlements + reconciliation, `docs/BUILD_ROADMAP.md` §4 row 12
— `ADR-0008` accepted 2026-09-20; the I1 channel/SKU confirmations remain
recorded inputs); otherwise proceed to the
price-version work (`DEC-064`) and/or the deployment rehearsal (parked on its
owner inputs).

**Scope (do not):** do not build row 12 or touch reconciliation until the row-11
commits land (`ADR-0008` is now accepted 2026-09-20; row 12 is the next slice
after that); do not amend or rewrite history
(nothing pushed); do not edit migrations `0000–0022`; do not deploy,
`terraform apply`, or write externally (per-source approval remains `DEC-015`);
invent no decision — append from **`DEC-072`** only if genuinely needed; do not
rewrite the specification inputs (`00_README.md` … `13_`, `docs/phase0/`,
`schemas/`, `samples/`).

**Files/paths:** the working tree above (already written; commit it);
`docs/BUILD_ROADMAP.md` §1/§4/§5 (already updated in the tree); `CONTEXT.md`
(this file); `12_OPEN_DECISIONS.md` only if a new decision is needed, from
`DEC-072`; `docs/runbooks/persistence-migrations.md` only if `0022`'s entry
needs correction.

**Authoritative docs to read first:** `docs/BUILD_ROADMAP.md` §1 (current
position) and §4 rows 11–12; `12_OPEN_DECISIONS.md` (`DEC-033`, next free id
`DEC-072`); `docs/adr/0008-*` (Proposed — the row-12 gate); this file's
"Open decisions / inputs".

**Acceptance / verification:** `nvm use 22`, then `npm run lint`, `npm run
typecheck`, `npm run test` (with `DATABASE_URL` — current baseline:
**1087/1087**; without it 880 passed / 207 skipped), `npm run build`,
`npm run format:check`, `npm audit --omit=dev` = 0; `db:migrate` through `0022`
is a no-op on re-run; the `0022` down path was rehearsed; after committing,
re-run the suite at the clean tree and confirm HEAD advanced by three commits.

**Open inputs (recorded, do not decide):** row 12's I1 channel/SKU
confirmations (`ADR-0008` is accepted 2026-09-20); row 13's history/grain
quality (`ADR-0007` is accepted 2026-09-20); the sales/consumption
grain ambiguity (`DEC-009` daily-per-location vs a single `sales_line`
`source_id`); no import-profile table; no tolerance-configuration table;
`file_object` absent so `file_object_id` is a plain uuid; dispositions live in
`diagnostics.dispositions` (no table); two routes return 404 by matching the
text `/not found/i` on the `DomainError` message (`recipes/[id]`,
`recipes/[id]/versions`) — a brittle pattern to replace with a typed not-found
error; `MAPPING_STATE` has no `conflict` value (conflicts are `error` +
`error_code=mapping_conflict`); a live-check left one dev `import_run` row in
the local database. All tracked in `docs/BUILD_ROADMAP.md` §5 ("Row-11
import-framework open points"); next free decision id `DEC-072`.

**Parallel owner action — golden-fixture sign-off:** the six golden fixtures are
prepared as machine-readable JSON under `tests/fixtures/` (`DEC-065`) with the
sign-off trail ready; finance + product owner sign. Until signed, no cost is
"verified"; `I8`/`I9` still gate the real rates behind the fixtures.

**After the row-11 commits:** row 12 (`ADR-0008` accepted 2026-09-20; the I1
inputs remain), then row 13 (`ADR-0007` accepted 2026-09-20), then the remaining
open owner questions.

## What this is

**Aquarela Business Control** — a secure, testable modular monolith for an Oslo
café with two locations, covering costing, pricing, inventory, production,
sales/imports, workforce and reporting. It is **documentation-first**: Phase 0 is
complete (specification, 65 accepted decisions, artifacts and ADRs); the
foundation scaffold, the Phase 1–2 persistence core, the auth slices (1a–1e), the
UI token foundation, master-data slices 2–3, slice 4 (receipt + price history +
landed cost), slice 5 (recipes), slice 6 (operating costs + labour + allocation),
slice 7 (cost card + snapshots + price scenario + approval), slice 8 (stock
ledger + balances + lots/storage) and the design system/app shell/screens — all
committed — with slices 9 (counts + transfers + waste) and 10 (production
planning + batches, including the web layer) complete and **row 11 (import
framework + external mappings) complete but uncommitted**, together with a
cross-cutting error-handling fix (both about to be committed as three commits).

## Where things live

- `00_README.md` … `13_AGENT_BUILD_BRIEF.md` — the specification package
  (inputs, rarely edited). Start with `00_README.md`.
- `12_OPEN_DECISIONS.md` — the accepted decisions (DEC-001…DEC-071); the
  authority. New decisions are appended here.
- `docs/phase0/` — close-out plan, calculation contract, data dictionary, golden
  fixtures, source-data request, notes. See `docs/phase0/PHASE0_CLOSEOUT_PLAN.md`
  and `docs/phase0/CALCULATION_CONTRACT.md`.
- `docs/adr/` — architecture decision records `0001`–`0012` (`ADR-0005`,
  `ADR-0007` and `ADR-0008` accepted 2026-09-20).
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

- **As of:** 2026-09-20 — branch `main`; HEAD `7f6aa78`; nothing pushed.
  **Row 11 (import framework + external mappings) is COMPLETE and UNCOMMITTED**
  on top of the committed layer stack (slices 0–10, auth 1a–1e, all committed;
  previous HEAD `2a5799e` was the docs commit before the slice-9/10
  stock-ops/production-web commits landed).
  **Row 11 delivered:** migration `0022` (tables `import_run`,
  `import_staging_row`, `external_mapping`), vocabularies
  `IMPORT_STATUS`/`MAPPING_STATE`/`IMPORT_POSTING_POLICY`, domain
  `packages/domain/src/sales-mapping.ts` (`resolveExternalEntity` — SKU-first
  then external id, with both `DEC-033` conflict directions), application
  `packages/application/src/imports/**` (create/stage/validate/map/dispose/
  preview + list/get), web `/api/v1/imports/**` and `(app)/sales/**` (landing +
  import runs list + run detail with diagnostics, staging rows, dispositions and
  preview), and `apps/web/scripts/seed-imports.ts`. **Row 12 (sales +
  settlements + reconciliation) was deliberately NOT built** — it is the next
  slice (`ADR-0008` accepted 2026-09-20, owner-delegated; the I1 channel/SKU
  confirmations remain recorded inputs); the import slice stops at
  `validated`/`needs_review` and the `/sales` page marks Reconciliation "not yet
  implemented — row 12 is owner-gated on ADR-0008" (stale text to update when
  row 12 lands). Row 13 is no longer ADR-gated (`ADR-0007` accepted
  2026-09-20) and follows row 12.
  **Cross-cutting fix (uncommitted, same tree):** `apps/web/lib/http.ts`
  `jsonError` now takes a message and `mapErrors` maps `DomainError`→400 with
  the authored message; all ~40 non-auth `DomainError` branches pass
  `error.message`; auth routes stay generic (`ADR-0003`). Verified live: a
  duplicate import hash returns `{"error":"duplicate import file hash …"}`
  instead of "Invalid email or password".
  **Verification at the current working tree:** `typecheck`, `lint`, `build`,
  `format:check` clean; **1087/1087 tests with `DATABASE_URL`** (880 passed /
  207 skipped without); `npm audit --omit=dev` 0; `db:migrate` through `0022` is
  a no-op; the `0022` down path was rehearsed.
  **In flight: the three commits** — row 11, the error-handling fix, docs (see
  "Resume here").
  Programme direction (user instruction): proceed autonomously — review/fix,
  document status + next steps, commit, then row 12 (`ADR-0008` accepted
  2026-09-20; the I1 inputs remain; else the price-version work `DEC-064` /
  the deployment rehearsal), then row 13 (`ADR-0007` accepted 2026-09-20).
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
- **Tests:** without `DATABASE_URL` the integration tests skip; with it
  **1087/1087 passed** (880 passed / 207 skipped without it) — recorded
  2026-09-20 at the current uncommitted row-11 working tree (HEAD `7f6aa78`;
  lint/typecheck/build/format:check pass; `db:migrate` through `0022` is a
  no-op, and the `0022` down path was rehearsed). Re-verify with `npm run test`
  and update if they differ.
  Open verification debt: the per-process rate limiter needs a shared
  store before multi-instance deployment; the reset-token delivery is a no-op stub
  until the email slice; the palette hex values and data-viz palette semantics
  await owner sign-off (see "Open decisions / inputs"); the six golden fixtures
  remain unsigned and are the "verified" gate.
- **Persistence core + deployment foundation (committed):** Drizzle schema,
  migrations `0000_enable_extensions` → `0021` additive with tested down paths
  (`0011_cost_allocation.sql` adds the four slice-6 tables; `0014_cost_card_pricing`
  adds four deferred `price_scenario` columns + `snapshot_component_kind_check`;
  `0015` adds `calculation_snapshot_cost_card_index`; the hand-written `0016` adds
  the `cost_card_approved_scope` invariant — a partial unique
  `cost_card_approved_scope_key` (`NULLS NOT DISTINCT WHERE state = 'approved'`);
  `0018` scopes the stock-movement idempotency key per organization and `0019`
  adds the `stock_movement_org_occurred_idx` as-of index; `0020` adds the
  slice-9 stock-ops tables (`stock_count`/`stock_count_line`/`stock_transfer`,
  `stock_movement.transfer_id`) and extends the source guard; `0021`
  adds the slice-10 production tables (`production_plan`, `production_batch`,
  `production_batch_input`, `production_batch_output`,
  `waste_event.production_batch_id` FK) and extends the source guard to
  `production_batch`; **`0022` (uncommitted)** adds the row-11 tables
  `import_run`/`import_staging_row`/`external_mapping` and vocabularies
  `IMPORT_STATUS`/`MAPPING_STATE`/`IMPORT_POSTING_POLICY`; ledger 22 rows
  through `0022`; the `asset`
  register is deliberately deferred), the
  advisory-locked migrator, worker/scheduler
  stubs and the `infra/` Terraform scaffold validated offline. Not applied.
- **Not yet built:** row 12 (sales + settlements + reconciliation —
  owner-gated on `ADR-0008`) and rows 13+; also
  the deferred tables
  (workforce, integrations, competitor, AI, procurement, period close,
  platform job/file/approval — note the
  `approval` platform table from DATA_DICTIONARY §9 does not exist yet, and the
  `file_object` table is absent so `import_run.file_object_id` is a plain uuid —
  and the
  `asset` register).

## Next up (prioritised)

`docs/BUILD_ROADMAP.md` is the ordered execution tracker for these slices (slice 0,
1a–1e and 2–10 done; **row 11 done (uncommitted)**; row 12 `todo` — the next
slice, with row 13 `todo` after it).
The list below is the short narrative form.

1. **Commit the row-11 work + the error fix + docs** — three commits: (a) the
   row-11 import slice (migration `0022`, domain `sales-mapping.ts`,
   application `imports/**`, `/api/v1/imports/**`, `(app)/sales/**`,
   `seed-imports.ts`); (b) the cross-cutting error-handling fix
   (`apps/web/lib/http.ts` + the ~40 non-auth `DomainError` call sites); (c)
   the docs update (`CONTEXT.md`, `docs/BUILD_ROADMAP.md`) — each with
   verification evidence + rollback approach in the body (see "Resume here").
   Programme direction: proceed autonomously (agents → review/fix → document →
   commit → next task).
2. **Row 12 — sales + settlements + reconciliation** (`docs/BUILD_ROADMAP.md`
   §4 row 12) — **the next slice**: `ADR-0008` is accepted (2026-09-20,
   owner-delegated); the remaining recorded inputs are the I1 channel/SKU
   confirmations (they gate real profiles, not the start — see the roadmap
   convention); then insights/month-close territory is row 13.
   The import slice stops at `validated`/`needs_review` until then.
3. **Row 13 — close + dashboards + menu engineering** — `ADR-0007` is accepted
   (2026-09-20, owner-delegated); history/grain quality remains the data gate
   (synthetic fixtures until real data).
4. **Price versions + PRICE-002/003** (`DEC-064`) — the next pricing work while
   rows 12/13 are not yet built.
5. **Test-deployment rehearsal** — per `docs/runbooks/deployment.md`, staging first
   with sanitized/synthetic data only; blocked on the deployment prerequisite inputs
   (see "Open decisions / inputs"); proceeds after the current slices in the
   meantime.
6. **Golden-fixture sign-off** — the six fixtures are prepared as machine-readable
   JSON under `tests/fixtures/` (`DEC-065`); finance + product owner sign (the
   "verified" gate); `I8`/`I9` still gate the real rates behind them.
7. **Deployment foundation — scaffolded and validated offline (committed); not
   applied.** `infra/` Terraform (project, database, spaces, networking,
   app-platform, monitoring, dns) + the App Platform app spec are done, and the
   `apps/worker` / `apps/scheduler` stubs exist. The jobs runtime (`DEC-062`,
   pg-boss) and the multi-tenancy posture (`DEC-061`) are now decided. The env-var
   wiring is done and committed (`583da3f`): `ORGANIZATION_ID` and
   `TOTP_SECRET_ENCRYPTION_KEY` are wired conditionally into the app-platform
   module and both env roots; the offline plan is still **16 to add / 0 change / 0
   destroy** per env. Before any `apply`: the decisions under "Open decisions /
   inputs", real DO credentials and a provisioned Spaces state bucket, and a
   single-runner apply. See
   `docs/adr/0012-deployment-topology-and-service-runtimes.md` and
   `docs/runbooks/deployment.md`.
8. **Costing verification** — against `docs/phase0/CALCULATION_CONTRACT.md` with
   synthetic fixtures, then real data; **owner sign-off of the six golden
   fixtures** (`docs/phase0/GOLDEN_FIXTURES.md`, prepared per `DEC-065`) is the
   gate for treating any cost as "verified" (slice 7 surfaces the sign-off trail).
   Still unsigned.

## Open decisions / inputs (do not block development)

- **Resolved this session (2026-09-20):** `ADR-0005` is **Accepted** (stock
  valuation/consumption — slice 8 unblocked); `ADR-0007` (reporting aggregates)
  and `ADR-0008` (integration ownership) are **Accepted** (2026-09-20,
  owner-delegated in-session, revertible) — rows 12 and 13 are no longer
  ADR-gated; their ADR **open items** remain recorded inputs (row 12's I1
  channel/SKU confirmations; per-integration ownership records, POS/Wolt API
  availability, allowed-operations approval); **`DEC-061`** multi-tenancy = shared
  schema with `organization_id` row scoping (RLS possible later; no schema/DB per
  tenant); **`DEC-062`** background jobs runtime = **pg-boss** over the existing
  PostgreSQL, worker/scheduler long-lived; **`DEC-063`** the price-scenario target
  is contribution over net price (a 6 dp fraction, not gross margin, not markup);
  **`DEC-064`** `price_version` + PRICE-002/003 are the next pricing slice after
  slice 8; **`DEC-065`** golden fixtures are machine-readable JSON under
  `tests/fixtures/` with the sign-off trail prepared; **`DEC-066`–`DEC-071`** the
  slice-9/10 technical defaults (transfer = header + paired movements, no line
  table; positive count variance via caller `unit_cost` → `item.current_cost`;
  waste valued at the ledger's moving average; production batch without a business
  number yet; recipe yield loss never posts waste; provisional
  `production_batch_output.kind` vocabulary).
- **Row-11 import-framework open points (2026-09-20; also tracked in
  `docs/BUILD_ROADMAP.md` §5 "Row-11 import-framework open points"; recorded,
  not decided — do not resolve silently):** row 12 (sales + settlements +
  reconciliation) is no longer ADR-gated (`ADR-0008` accepted 2026-09-20,
  owner-delegated) but still awaits the I1 channel/SKU confirmations (owner);
  row 13 is no longer ADR-gated (`ADR-0007` accepted 2026-09-20) — history/grain
  quality remains the data gate; the
  sales/consumption grain ambiguity (`DEC-009` daily-per-location vs a single
  `sales_line` `source_id`, FIN+TECH); no import-profile table (TECH); no
  tolerance-configuration table (FIN); `file_object` is absent, so
  `import_run.file_object_id` is a plain uuid (TECH); dispositions live in
  `diagnostics.dispositions` jsonb, not a table (TECH); two routes return 404 by
  matching the text `/not found/i` on the `DomainError` message
  (`recipes/[id]`, `recipes/[id]/versions`) — a brittle pattern to replace with
  a typed not-found error (TECH); `MAPPING_STATE` has no `conflict` value —
  conflicts are `error` + `error_code=mapping_conflict` (TECH). Also a live-check
  left one dev `import_run` row in the local database (see "Local dev-DB
  cleanup" below). Record each resolution in `12_OPEN_DECISIONS.md` (next free
  id **`DEC-072`**); do not resolve silently.
- **Slice-9/10 open owner questions (2026-09-20; also tracked in
  `docs/BUILD_ROADMAP.md` §5 "Slice-9/10 open owner questions"):** output-cost
  allocation across multiple outputs/by-products (FIN); yield-variance tolerance
  and exception store (`PROD-003`, FIN+TECH); work-in-progress/source-draw storage
  area (OPS+TECH); `production_plan` line/quantity model and status vocabulary
  (OPS+TECH); lot-tracked cross-location transfer policy (OPS); per-source reversal
  semantics (`DEC-028`) not yet implemented (TECH); receipts not wired to the
  ledger (TECH); `lotTracked` unenforced (TECH); `DEC-009` daily theoretical
  consumption not implemented (TECH). Record each resolution in
  `12_OPEN_DECISIONS.md` (next free id **`DEC-072`**); do not resolve silently.
- **Deployment prerequisite inputs (owner; before any real `apply`):** `ADR-0004`
  acceptance; a real scoped `DIGITALOCEAN_TOKEN`; a provisioned private Spaces
  state bucket + state credentials; the sanitized-data owner; the legacy
  instance-slug/manual-scaling check; domain names (optional). The runbook
  (`docs/runbooks/deployment.md`) mandates the first real `apply` be **staging**
  with sanitized/synthetic data only — never a raw production copy (a raw
  production copy is only sanctioned via an isolated PITR restore for a data
  rollback). Nothing has been applied to DigitalOcean.
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
- **Surfaced by slice 8** (uncommitted working tree at HEAD `f7b1db7`): eight
  stock-ledger open (owner/TECH) points are recorded in `docs/BUILD_ROADMAP.md` §5
  ("Slice-8 stock-ledger open points"); record each resolution in
  `12_OPEN_DECISIONS.md` (next free id **`DEC-066`**); do not resolve silently:
  goods-receipt acceptance is not yet wired to the ledger (no destination
  `storage_area_id` on a receipt; the receipt→movement integration and its
  storage-area policy are unresolved, `post-stock-movement.ts`); per-source
  reversal semantics are not enumerated (a non-receipt reversal posts movement
  type `correction`; only `receipt` → `receipt_reversal`; `DEC-028` defines the
  semantics per source type, `reverse-stock-movement.ts`); `lotTracked` is not
  enforced (a lot-tracked item can post with `lotId` null,
  `post-stock-movement.ts`); the `DEC-028` "reversal blocked when reconciled
  downstream sales depend on the original" gate is deferred until the sales slice
  exposes reconciliation state (reversal always requires an explicit reason
  today); the `0017` `source_id` guard originally covered only
  `source_type='goods_receipt'` and — slice-9 persistence, migration `0020`
  (committed in `b525f30`) — now covers `stock_count`/`transfer`/`waste_event` too
  (production/sales remain documented no-ops until their slices
  extend the trigger); `DEC-009` daily theoretical sale-consumption posting is
  not implemented (no sales source exists yet; `postStockMovements` is the
  idempotent primitive the sales slice will call); `stock_balance` is written
  directly by the posting command while the runbook calls it a rebuildable
  projection (confirm the writer policy before multi-instance use); no
  application surface creates `location` rows (a pre-existing gap;
  `registerStorageArea` requires an existing location).
  Two further points from the finding fixes: the idempotency key is now a
  **per-organization** namespace (`stock_movement_org_idempotency_key_key`,
  migration `0018`), which narrows `DATA_DICTIONARY` §6's global "unique where
  not null" wording; and the DEC-010 negative-override role set
  (`NEGATIVE_OVERRIDE_ROLES = ["owner", "general_manager", "location_manager"]`,
  `packages/application/src/inventory/permissions.ts`) is fail-closed — the
  residual open point is which of those roles should grant the override
  (`DEC-066`).
- **Surfaced by slice 9** (persistence committed in `b525f30`, migration `0020`;
  Wave 2b application/API/screens in flight in three parallel agents): five
  slice-9 open (owner/TECH) points, also tracked in `docs/BUILD_ROADMAP.md` §5
  ("Slice-9 counts/transfers/waste open points", which also cross-references the
  slice-8 points above); record each resolution in `12_OPEN_DECISIONS.md` (next
  free id **`DEC-066`**); do not resolve silently:
  **no transfer line table exists** (a transfer is a header plus paired
  `stock_movement.transfer_id` movements; the per-item discrepancy is derived —
  owner/TECH to confirm the shape); the **positive count-variance `unit_cost`
  source is undecided** (the ledger's moving average is the working
  assumption — owner/FIN); **`waste_event.value_method`/`value` vs the ledger's
  moving average is undecided** (which value the waste record is judged against,
  and whether they may diverge — owner/FIN); **count `scope` shape and recount
  thresholds are undefined** (whole area vs item subset, plus the escalation
  rule, `DEC-017`/`DEC-029` — owner/FIN); **no transfer-discrepancy exception
  table exists** (a discrepancy between shipped and received movements is only
  derivable from the ledger — owner/TECH).
- **Local dev-DB cleanup (not a code issue):** an ad-hoc reviewer probe left 3
  `stock_movement` rows under a throwaway org in the local dev database; the
  append-only trigger makes them undeletable (the documented destructive replay
  would clear them). Local dev-data artefact only — no repository impact.
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

Runtime stubs (each prints its start line and exits 0 after one tick; the worker
and scheduler ticks pass only when `DATABASE_URL` is set):

```bash
DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela WORKER_TICKS=1 npm run start --workspace @aquarela/worker
DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela SCHEDULER_TICKS=1 npm run start --workspace @aquarela/scheduler
```

Environment note: `docker` and `terraform` are **not on PATH** in this environment
— the container build and credentialed Terraform steps cannot be run here (the
Terraform offline validation was run from a downloaded 1.16.3 binary).

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
- **Everything through `aa4ab29` is committed** (slices 4–7 and their review fixes
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
- **Slice 8 + slice-9 persistence + web layers (committed as five layer commits;
  nothing pushed; HEAD `6c69f7f`)**: each is independently revertible with
  `git revert <sha>` — `583da3f` (infra deploy env vars), `b525f30` (stock ledger +
  stock-ops persistence, repositories, migrations `0017`–`0020`),
  `40e736b` (stock-valuation domain + client-safe subpath exports), `c91e512`
  (application slices), `6c69f7f` (design system, app shell, screens). Because they
  are layer commits over shared files, reverting the earliest layer (`b525f30`)
  alone may leave later layers referencing missing exports — revert the cohort
  together (or in reverse order) if reverting more than the topmost commit.
  Migrations `0017` (deferred FK + `goods_receipt` source guard), `0018` (per-org
  idempotency key), `0019` (`stock_movement_org_occurred_idx`) and `0020`
  (slice-9 `stock_count`/`stock_count_line`/`stock_transfer` tables +
  `stock_movement.transfer_id` + the extended source guard) are additive with
  rehearsed down paths (drop the added objects/tables/columns, delete the ledger
  row, re-migrate).
- **Row 11 + the error-fix (UNCOMMITTED at HEAD `7f6aa78`)**: the row-11
  import slice (migration `0022`, vocabularies `IMPORT_STATUS`/
  `MAPPING_STATE`/`IMPORT_POSTING_POLICY`, domain `sales-mapping.ts`, application
  `imports/**`, web `/api/v1/imports/**` + `(app)/sales/**` + seed) and the
  cross-cutting `jsonError`/`mapErrors` error-handling fix live only in the
  working tree, together with the `CONTEXT.md`/`docs/BUILD_ROADMAP.md` doc
  update — recovery is `git checkout -- <paths>` / `git stash` until the three
  planned commits land (row 11, the error fix, docs; then `git revert <sha>` per
  commit). Migration `0022` is **additive with a rehearsed down path** (drop
  the three added tables, delete the ledger row, re-migrate); the error fix
  touches no migration or generated file, so it has no data-recovery concern.
- **Slice 9 + slice-10 backend (committed as layer commits between `2a5799e`
  and `7f6aa78`)**: the counts/transfers/waste and production work (migration
  `0021`, domain `production.ts`, application `production/**`, the production
  web layer) is committed on `main`; each commit is revertible with
  `git revert <sha>`. Migrations `0020` (slice-9 stock-ops tables, committed in
  `b525f30`) and `0021` (slice-10 production tables) are **additive with
  rehearsed down paths** (drop the added tables/columns/FKs, delete the ledger
  row, re-migrate). Note: slices 9 and 10 shared barrel files
  (`packages/application/src/index.ts`, `packages/domain/src/index.ts`,
  `packages/persistence/src/index.ts`, `schema/index.ts`, `vocabularies.ts`,
  `_journal.json`), so their commits were able to be split only along those
  shared-file boundaries.
- **Deployment env vars (`583da3f`)**: the `ORGANIZATION_ID` /
  `TOTP_SECRET_ENCRYPTION_KEY` wiring in `infra/` is additive and conditional
  (unset adds no env var) — it changes no plan count (still **16 to add / 0
  change / 0 destroy** per env offline); `git revert 583da3f` undoes it. **No
  cloud resource was created and nothing has been applied to DigitalOcean.**
- **Decisions + fixture trail (`aa4ab29`)**: documentation only — the five
  `DEC-061`–`DEC-065` entries, the `ADR-0005` acceptance and the additive golden
  fixture trail/test (`tests/fixtures/`,
  `packages/domain/src/golden-fixtures.test.ts`). No migration or production
  code; `git revert aa4ab29` restores the prior state.
- The `infra/` scaffold, runtime stubs and persistence core are committed; revert
  them with `git revert` if needed. **No cloud resource was created — only offline
  `fmt`/`validate`/`plan` ran, never `apply`; no Terraform state exists, and
  nothing has been applied to DigitalOcean.**
- Migrations 0000–0022 are additive with tested down paths (`0011` down drops the
  four slice-6 tables; `0012` down drops the three EXCLUDE constraints; `0015`/
  `0016` down drop their indexes/invariant — rehearsed; `0017`–`0022` down are
  rehearsed — see the slice-8 bullet and the slice-9/10 and row-11 bullets
  above). While the
  database is
  empty the tested recovery is `DROP SCHEMA public CASCADE; DROP SCHEMA drizzle
CASCADE; CREATE SCHEMA public; npm run db:migrate` (see the runbook). Once data
  exists, migrations must be additive (expand → migrate → contract) with a tested
  data-preserving down path (see `AGENTS.md` Rule 2).
- External writes require a documented rollback and per-source approval
  (`DEC-015`).

## Work log (append-only, newest first)

### 2026-09-20 — Row 11 (import framework + external mappings) complete + cross-cutting error-handling fix (uncommitted); handoff updated

`main` HEAD `7f6aa78`; the working tree holds uncommitted **row 11** work plus a
cross-cutting error-handling fix and this handoff update — about to be committed
as **three commits** (row 11, the error fix, docs; nothing pushed; nothing
applied to DigitalOcean). No handoff/code file outside `CONTEXT.md` and
`docs/BUILD_ROADMAP.md` was touched by this update.

- **Row 11 — complete.** Migration `0022` (tables `import_run`,
  `import_staging_row`, `external_mapping`), vocabularies
  `IMPORT_STATUS`/`MAPPING_STATE`/`IMPORT_POSTING_POLICY`, domain
  `packages/domain/src/sales-mapping.ts` (`resolveExternalEntity` — SKU-first
  then external id, with both `DEC-033` conflict directions), application
  `packages/application/src/imports/**` (create/stage/validate/map/dispose/
  preview + list/get), web `/api/v1/imports/**` and `(app)/sales/**` (landing +
  import runs list + run detail with diagnostics, staging rows, dispositions
  and preview), and `apps/web/scripts/seed-imports.ts`. **Row 12 (sales +
  settlements + reconciliation) was deliberately NOT built** — it remains
  `blocked (owner)` on `ADR-0008` (still Proposed); the import slice stops at
  `validated`/`needs_review` and the `/sales` page marks Reconciliation "not
  yet implemented — row 12 is owner-gated on ADR-0008". `ADR-0007` (Proposed)
  still gates row 13.
- **Cross-cutting fix (uncommitted).** `apps/web/lib/http.ts` `jsonError` now
  takes a message and `mapErrors` maps `DomainError`→400 with the authored
  message; all ~40 non-auth `DomainError` branches pass `error.message`; auth
  routes stay generic (`ADR-0003`). Verified live: a duplicate import hash now
  returns `{"error":"duplicate import file hash …"}` instead of "Invalid email
  or password".
- **Open points recorded, not decided** (see "Open decisions / inputs" and
  `docs/BUILD_ROADMAP.md` §5 "Row-11 import-framework open points"): the
  row-12/13 gates; the sales/consumption grain ambiguity (`DEC-009`
  daily-per-location vs a single `sales_line` `source_id`); no import-profile
  table; no tolerance-configuration table; `file_object` absent so
  `file_object_id` is a plain uuid; dispositions in `diagnostics.dispositions`
  (no table); two routes return 404 by matching the text `/not found/i` on the
  `DomainError` message (`recipes/[id]`, `recipes/[id]/versions`) — a brittle
  pattern to replace with a typed not-found error; `MAPPING_STATE` has no
  `conflict` value (conflicts are `error` + `error_code=mapping_conflict`);
  next free decision id `DEC-072`. A live-check left one dev `import_run` row
  in the local database (local dev-data artefact, no repository impact).
- **Verification (exact, at the current working tree):** `typecheck`, `lint`,
  `build`, `format:check` clean; **1087/1087 tests with `DATABASE_URL`** (880
  passed / 207 skipped without); `npm audit --omit=dev` 0; `db:migrate` through
  `0022` is a no-op; the `0022` down path was rehearsed.

Rollback: the row-11 work + the error fix are uncommitted — `git checkout --
<paths>` / discard the tree (or `git revert` the three commits once they land);
migration `0022` is additive with a rehearsed down path. Next: the three
commits, then row 12 when `ADR-0008` is accepted (else the price-version work
`DEC-064` / the deployment rehearsal) — see "Resume here".

### 2026-09-20 — Slices 9 + 10-backend complete (uncommitted); decisions DEC-066–DEC-071 recorded; slice-10 web layer in flight

Slices 9 (counts + transfers + waste) and 10 (production planning + batches)
backend are **complete but UNCOMMITTED** at HEAD `2a5799e` (docs commit; nothing
pushed; nothing applied to DigitalOcean). They were built **concurrently in
parallel** and share barrel files
(`packages/application/src/index.ts`, `packages/domain/src/index.ts`,
`packages/persistence/src/index.ts`, `packages/persistence/src/schema/index.ts`,
`packages/persistence/src/schema/vocabularies.ts`, `drizzle/_journal.json`), so
they **cannot be split into independently-buildable commits** — the commit plan is
one **stock-ops commit** (slice 9 + the slice-10 backend) plus a separate
**production-web commit**.

- **Slice 9 (counts + transfers + waste) — complete.** Persistence was already
  committed (migration `0020` in `b525f30`); this session added the three
  application verticals with APIs, screens, seeds and tests:
  `packages/application/src/{counts,transfers,waste}/**`,
  `apps/web/app/api/v1/{counts,transfers,waste}/**`,
  `apps/web/app/(app)/inventory/{counts,transfers,waste}/**`,
  `apps/web/scripts/seed-{counts,transfers,waste}.ts`. A transfers-seed type error
  was found and fixed during integration (`apps/web/scripts/seed-transfers.ts`).
- **Slice 10 backend — complete.** Migration `0021` (tables `production_plan`,
  `production_batch`, `production_batch_input`, `production_batch_output`;
  `waste_event.production_batch_id` FK; source guard extended to
  `production_batch`), `packages/domain/src/production.ts` (yield helpers),
  `packages/application/src/production/**` (plan/batch commands incl. the atomic
  `completeProductionBatch`). Its **web layer** (API + `/production` screens +
  seed) is in flight.
- **Decisions recorded (docs commit `2a5799e` + this update):**
  `DEC-066` transfers = header + paired `stock_movement.transfer_id` movements, no
  line table, derived discrepancy, `discrepancy_note` as the interim exception
  record; `DEC-067` positive count variance valued at caller `unit_cost` →
  `item.current_cost`, approval fails with neither (provisional, FIN);
  `DEC-068` operational waste valued at the ledger's moving weighted average at
  posting (`cost_selection`/`latest_price`/`manual` unimplemented); `DEC-069`
  production batch identity/idempotency = the caller-supplied deterministic id
  until OPS+TECH define a numbering scheme; `DEC-070` expected trim/cooking loss
  never posts a `waste` movement, only actual abnormal loss becomes a
  `waste_event`; `DEC-071` provisional local `production_batch_output.kind`
  vocabulary pending a `domain-enums.yaml` key. Open owner questions (not
  decisions) recorded in `docs/BUILD_ROADMAP.md` §5 "Slice-9/10 open owner
  questions"; next free decision id `DEC-072`.
- **Verification (exact, at the current working tree):** `typecheck`, `lint`,
  `format:check` clean; **989/989 tests with `DATABASE_URL`** (the full suite
  including the slice-9/10 integration tests); `db:migrate` applies `0020` and
  `0021`, both no-ops on re-run; both down paths rehearsed.

Rollback: the slice-9/10 work is uncommitted — `git checkout -- <paths>` / discard
the tree (or `git revert` the stock-ops/production-web commits once landed);
migrations `0020`/`0021` are additive with rehearsed down paths. Next: finish the
slice-10 web layer, review/fix, commit (stock-ops, then production-web), then the
sales-import/reconciliation slice (see "Resume here").

### 2026-09-20 — Slice 8 + slice-9 persistence + design system/screens committed (five layer commits); slice 9 Wave 2b in flight

Five commits landed on `main` (HEAD now `6c69f7f`; nothing pushed; previous HEAD
`f7b1db7`). Because the migrations/schema barrels shared files across tasks, the
backlog was committed in dependency-ordered **layer commits**
(persistence → domain → application → web/ui → infra — infra commit chronologically
topmost as the last stack entry); **per-task feature commits resume from here**:

- `583da3f` feat(infra) deploy env vars (`ORGANIZATION_ID`,
  `TOTP_SECRET_ENCRYPTION_KEY` wired conditionally into the app-platform module and
  both env roots).
- `b525f30` feat(persistence) stock ledger + stock-ops schema, repositories,
  migrations `0017`–`0020` (slice 8 plus the slice-9 stock-ops tables:
  `stock_count`/`stock_count_line`/`stock_transfer`, `stock_movement.transfer_id`,
  the `0017` source guard extended to `stock_count`/`transfer`/`waste_event`).
- `40e736b` feat(domain) stock valuation + client-safe subpath exports
  (`@aquarela/domain/decimal|quantity|money`).
- `c91e512` feat(application) inventory/catalog/recipes/costing/receiving slices.
- `6c69f7f` feat(web) Aquarela design system (`packages/ui` shell + patterns +
  client-only modal), app shell with role-aware nav and scope bar, Management home,
  branded sign-in, styleguide, and the Inventory/Products/Recipes/Costs/Purchasing
  screens with `/api/v1` routes and idempotent seeds.

**Delivered and verified within these commits:** slice 8 stock ledger (moving
weighted-average valuation, reversal/revaluation, DEC-010 negative-stock manager
gate, per-org idempotency, SQL as-of aggregate) with migrations `0017`–`0019`;
the web surface above; slice 9 **persistence** with migration `0020`.
**Known defects fixed during integration:** a client component pulled `node:crypto`
into the browser bundle via the domain barrel (fixed with the client-safe
`@aquarela/domain/decimal|quantity|money` subpath exports); six detail pages
returned HTTP 500 on a non-UUID param (fixed with
`apps/web/lib/route-params.ts` → 404, with its test).

**Verification at `6c69f7f` (exact):** `typecheck`, `lint`, `build`,
`format:check` clean; **842/842 tests with `DATABASE_URL`** (691 passed / 151
skipped without it); `npm audit --omit=dev` = 0; `db:migrate` through `0020`
re-runs as a no-op; the `0017`–`0020` down paths rehearsed.

**In flight: slice 9 Wave 2b** — the counts, transfers and waste application +
`/api/v1` + screens, in three parallel background agents (each owning
`packages/application/src/{counts,transfers,waste}/**`,
`apps/web/app/api/v1/{counts,transfers,waste}/**`,
`apps/web/app/(app)/inventory/{counts,transfers,waste}/**` and
`apps/web/scripts/seed-*.ts`). **Programme direction (user instruction):**
proceed autonomously — per task: parallel background agents → review/fix →
document status + next steps → commit → next task; after slice 9, slice 10
(production planning + batches), then sales import/reconciliation, then
insights/month-close. **Open points recorded not decided** (13 — see
`docs/BUILD_ROADMAP.md` §5 "Slice-9 counts/transfers/waste open points" and "Open
decisions / inputs"); next free decision id `DEC-066`.

Rollback: `git revert <sha>` per commit (see "Reversibility" for the cohort
caveat); migrations `0017`–`0020` additive with rehearsed downs.

### 2026-09-20 — Detail pages return 404 (not 500) for a non-UUID route param (uncommitted)

Fixed the cross-cutting defect where all six `(app)` detail pages returned **HTTP
500** for a malformed route param (`/inventory/notauuid`, `/products/notauuid`,
`/recipes/notauuid`, `/costs/cost-cards/notauuid`, `/costs/price-scenarios/notauuid`,
`/purchasing/receipts/notauuid`): the raw param reached a Postgres `uuid`
comparison and raised a driver error.

- New `apps/web/lib/route-params.ts` exports `uuidOrNotFound(value)`: trims,
  matches a strict 8-4-4-4-12 hex UUID (version/variant nibbles unconstrained),
  and calls `notFound()` on a miss; JSDoc states an unvalidated id must never
  reach the database. New focused test `apps/web/lib/route-params.test.ts`
  (valid, uppercase, wrong-length, non-hex, surrounding whitespace) = **5 passed**.
- Applied in all six detail pages before any store/service call, via a
  `raw<Param>` destructure rename (`uuidOrNotFound(rawId)`), keeping the existing
  `notFound()` for valid-but-unknown ids. No API route, domain/application/
  persistence layer, or `packages/ui` change. A sweep of `apps/web/app/(app)/**`
  confirmed exactly these six dynamic pages.
- Verified: `npx tsc --noEmit -p apps/web/tsconfig.json` clean; focused
  `npx vitest run apps/web/lib/route-params.test.ts` = 5 passed; `npx eslint` and
  `npx prettier --check` clean on all touched files. Live (dev server, signed-in):
  all six `…/notauuid` URLs now **404** (were 500); valid ids for inventory,
  products, recipes and purchasing/receipts **200**. The `cost_card` /
  `price_scenario` tables are empty in the dev DB (list API returns no rows), so
  no 200 id exists there; a valid-but-unknown UUID returns a clean **404**, i.e.
  the guard passes well-formed ids to the loader and never 500s. Uncommitted;
  rollback: discard the touched files (or `git revert` once committed).

### 2026-09-20 — Inventory balances show the item name/code instead of the raw UUID (uncommitted)

Closed the gap where the new Inventory screen displayed raw item UUIDs because the
inventory read model did not expose the item name/code. No domain/persistence
logic change — the persistence `findItemById` already returned the full row.

- `InventoryItemRecord` gained `code`/`name`
  (`packages/application/src/inventory/types.ts`), mapped in `toItem`
  (`postgres-store.ts`) and seeded in `FakeInventoryStore`'s fixture
  (`test-support.ts`); the inline item literals in `post-stock-movement.test.ts`
  were updated so they still compile.
- `BalanceRow` gained `itemCode`/`itemName` from the existing org-checked item
  lookup, so `GET /api/v1/inventory/balances` now carries them
  (`apps/web/app/api/v1/inventory/balances/balance-rows.ts`); its test updated.
- `BalancesTable` renders the item name (the code as a small muted secondary line)
  with the id kept in a `title`, and the "names are not exposed yet" caption /
  row comment were removed; the `—`/empty behaviour and the currency logic are
  unchanged (`apps/web/app/(app)/inventory/balances-table.tsx`, `page.tsx`).

Verified (exact): `npm run typecheck`, `npm run lint` pass; focused
`npx vitest run packages/application/src/inventory apps/web/app/api/v1/inventory`
= **55 passed / 4 skipped (59)**; `npm run test` = **568 passed / 135 skipped
(703)**; `npm run build` passes (the first attempt failed transiently on missing
auth page modules — the `next build`/running `next dev` shared-`.next` race — and
succeeded on retry); `npx prettier --check` clean on all eight touched files.
Curl: signed-out `GET /api/v1/inventory/balances` → **401**; signed in as
`owner`/`LocalDevPass123` → **200** with `itemCode`/`itemName` populated (e.g.
`DEMO_ESPRESSO_BEANS` / "Demo Espresso Beans"). Uncommitted; rollback: discard the
touched files/the working tree (or `git revert` once committed).

### 2026-09-20 — Slice 8 final review fixes (findings 5–10) + deployment readiness (uncommitted)

Finished the slice-8 adversarial-review follow-up on the still-uncommitted working
tree (HEAD `f7b1db7`; nothing applied to DigitalOcean): **all ten review findings
are now addressed.** No new domain change beyond the earlier fixes.

- **Findings 5–10 fixed.** Batch posting memoises transaction-immutable reference
  lookups inside the transaction; `getStockBalanceAsOf` uses the new SQL aggregate
  `sumStockMovementsAsOf` (no in-memory ledger scan) plus the domain average
  helper; migration `0019_stock_movement_asof_index.sql` (journal `when`
  `1789904976754`) adds the `stock_movement_org_occurred_idx` index on
  `(organization_id, occurred_at, posted_at, id)`; the negative-override guard and
  `isBlank` are de-duplicated; the dead wrapper `getCurrentStockBalance` and the
  test-only persistence exports (`createStockLot`, `findStockLotByNumber`,
  `listStorageAreas`) were removed. `listStockMovements` is deliberately retained
  as a ledger read API (now used only by its persistence test; slice 9 will need
  it). Findings 1–4 were fixed earlier (DEC-010 gate, per-org idempotency `0018`,
  domain `deriveAverageUnitCost`, shared `postRevaluationCorrection`).
- **Deployment readiness (infra).** `ORGANIZATION_ID` (general) and
  `TOTP_SECRET_ENCRYPTION_KEY` (secret) are wired conditionally into the
  app-platform module and both env roots (unset adds no env var), web-only;
  `docs/runbooks/deployment.md` updated (deployed env vars, the corrected
  owner-decision drift — multi-tenancy decided `DEC-061`, jobs runtime decided
  `DEC-062`, `ADR-0004` acceptance itself still open — and a "Rehearsing against
  a production clone" note). Runbook `0019` entries added to
  `docs/runbooks/persistence-migrations.md`.
- **Local deployment rehearsal (this session).** The full suite and migration are
  green; `npm run bootstrap -- --dry-run` prints the expected plan without
  writing; the worker and scheduler smoke ticks pass only when `DATABASE_URL` is
  set (the "How to verify" commands here were corrected to include it). Docker
  and Terraform binaries are not on PATH here, so the container build and
  credentialed Terraform steps could not run (Terraform offline validation ran
  from a downloaded 1.16.3 binary by the infra agent).

Verified (exact): `npm run lint`, `npm run typecheck`, `npm run build` and
`npm run format:check` pass; without `DATABASE_URL` **558 passed / 135 skipped
(693)**; with it **693 passed / 693 (69 files)**; `npm audit --omit=dev` = 0;
`db:migrate` applies through `0019` and re-runs as a no-op; the `0019` down path
was rehearsed (drop the index, delete the ledger row, re-migrate). Terraform:
`fmt -check -recursive` clean; `init -backend=false` + `validate` green in both
envs; offline plan still **16 to add / 0 change / 0 destroy** per env.

Rollback: discard the working tree (or, once committed, `git revert`); migrations
`0018`/`0019` are additive with rehearsed down paths; the infra env-var change is
additive and changes no plan count. Next: the atomic slice-8 commit (see "Resume
here"), then the test-deployment rehearsal.

### 2026-09-20 — Slice 8 finding fixes: DEC-010 role gate, per-org idempotency (`0018`), shared revaluation helper (uncommitted)

Applied three review findings to the still-uncommitted slice-8 working tree (HEAD
`f7b1db7`; nothing applied to DigitalOcean). No domain change.

- **Finding 1 — DEC-010 negative override now requires a manager role.** New
  `listActorRoleCodes(actorId)` port (`types.ts`), implemented via the existing
  `listUserRoles` repository in the Postgres adapter and a public role map in
  `FakeInventoryStore`; new `permissions.ts` holds the provisional fail-closed
  `NEGATIVE_OVERRIDE_ROLES = ["owner", "manager"]` and
  `assertNegativeOverrideAuthorized`; `postStockMovement` and
  `reverseStockMovement` call it when the override is actually used, throwing
  `DomainError("negative stock override requires manager permission")` otherwise.
  Tests: override rejected with no qualifying role (post + reverse); the existing
  owner-held override tests still pass. **Role-code correction (post-review):**
  the gate now uses the real `ROLE_CODE` vocabulary codes —
  `NEGATIVE_OVERRIDE_ROLES = ["owner", "general_manager", "location_manager"]`;
  `manager` was not a vocabulary code; the residual open point is only _which_ of
  those roles should grant the override (next free id `DEC-066`).
- **Finding 2 — idempotency key scoped per organization.** Schema's global
  unique replaced by the composite `stock_movement_org_idempotency_key_key` on
  `(organization_id, idempotency_key)`; migration
  `0018_stock_movement_org_idempotency_key.sql` generated (journal `when`
  `1789902579323`) with its unjournaled `_down.sql`; repository
  `findStockMovementByIdempotencyKey(db, organizationId, key)` filters by org; the
  application replay path passes the org and the redundant foreign-org throw is
  gone. Tests: one org's key does not block another's posting and each org
  replays its own movement (application), plus the composite same-org collision /
  two-org acceptance (persistence integration). This deviates from
  `DATA_DICTIONARY` §6's global "unique where not null" wording — recorded as an
  open point, not ignored.
- **Finding 4 — shared revaluation correction.** New `revaluation.ts`
  (`postRevaluationCorrection`) is used by both commands; it posts the value-only
  movement, saves the balance and writes the audit, adding `reversal_of_id` to
  the audit only when non-null. Callers keep their own `reasonCode` and
  idempotency-key scheme; the post path's audit gains no `reversal_of_id`.
- **Docs:** runbook `0018` entries (order row, bullet, down companion, ledger
  `when`, preflight, invariant check, recovery range `0000–0018`); two new
  slice-8 open points in `docs/BUILD_ROADMAP.md` §5 (per-org key vs
  `DATA_DICTIONARY` §6; provisional override role set) and this file.

Verified (exact): `npm run lint`, `npm run typecheck`, `npm run build` and
`npm run format:check` pass; without `DATABASE_URL` **557 passed / 135 skipped
(692)**; with it **692 passed / 692 (69 files)**; `db:migrate` applies `0018`,
re-runs as a no-op, and the down path was rehearsed (run the down via node+`pg`,
delete the `1789902579323` ledger row, re-migrate), leaving the database migrated
through `0018`. Rollback: discard the working tree (or, once committed, `git
revert`); migration `0018` is additive with the rehearsed down path. Next: the
atomic slice-8 commit (see "Resume here").

### 2026-09-20 — Slice 8 stock ledger + balances + lots/storage implemented, reviewed, reconciled (uncommitted)

Slice 8 is **implemented, adversarially reviewed in three independent passes,
fix-reconciled and fully verified — but UNCOMMITTED** (branch `main`, HEAD
`f7b1db7`; nothing applied to DigitalOcean). The three stock tables already
existed in `0001`; migrations `0000–0016` untouched.

- **What was built.** Domain `packages/domain/src/stock.ts` (+`stock.test.ts`,
  exported from the domain barrel): moving-weighted-average valuation with
  `computeMovementValue`, `applyStockMovement`, `applyStockMovementValue`,
  `reverseStockMovement`, `recomputeStockBalance`, `revaluationGap` and
  `wouldDriveNegative`. Application `packages/application/src/inventory/`
  (`types.ts`, `actions.ts`, `validation.ts`, `post-stock-movement.ts`,
  `reverse-stock-movement.ts`, `stock-balance.ts`, `register-storage-area.ts`,
  `postgres-store.ts`, `test-support.ts`, `index.ts`, unit tests + the
  `inventory.postgres.test.ts` integration file; barrel export added):
  `postStockMovement`, `postStockMovements` (atomic batch — the `PROD-002`
  primitive), `reverseStockMovement` (exact offset + `revaluation` correction),
  `getCurrentStockBalance`, `getStockBalanceAsOf` (`INV-002`),
  `registerStorageArea`, the `InventoryStore` port + `FakeInventoryStore` +
  `createPostgresInventoryStore`. Persistence
  `packages/persistence/src/repositories/inventory.ts` (+`inventory.test.ts`,
  `repositories/test-support.ts`, `schema/inventory.ts`, package barrel):
  `lockOrCreateStockBalance` (`INSERT … ON CONFLICT DO NOTHING` + `SELECT … FOR
UPDATE`, per `DEC-034`), `findOrCreateStockLot`, movement/lot/area reads. New
  hand-written migration `0017_stock_ledger_invariants.sql` (+`_down.sql`,
  `meta/0017_snapshot.json`, `meta/_journal.json` entry idx 17, `when`
  `1789895339462`): the deferred FK on `stock_lot.source_movement_id` and a
  `goods_receipt`-only `source_id` guard trigger.
- **Adversarial reviews and reconciliation.** Three independent passes:
  `reviewer-qwen` (logic/edge cases), `reviewer-glm` (application code),
  `reviewer-minimax` (schema/migration/rollback). Applied on top of the first
  implementation (items A1–A12/P1–P4/D1 in the prior work-log entry — see the
  next entry): posting-path `revaluationGap` correction; org-scoped idempotency
  replay; removal of the caller-supplied `currency` (always
  `organization.currency`); pre-transaction batch validation + empty-batch
  rejection; reversal `negative_override` audit; removal of the dead `"NOK"`
  fallback; strict ISO-instant/`yyyy-mm-dd` validation; `lotId`+`lot` rejection;
  reversing a `revaluation` rejected; `requires_revaluation: true` when an
  override leaves negative quantity; `:`-containing batch idempotency key
  rejected; fake timestamp normalisation; `findOrCreateStockLot` (lot
  create-or-find race); `saveStockBalance` throws when it matches no row;
  `lockOrCreateStockBalance` transaction docstring; the `0017` runbook
  `ShareLock`/`NOT VALID`→`VALIDATE` preflight note. **Declined with reasons:**
  the adapter `isNodeDatabase` guard/savepoint nesting (repo-wide convention;
  nesting is harmless and the batch stays atomic); converting the concurrent
  unique-violation on `idempotency_key` into a replay (the unique index prevents
  double-posting; a retry hits the replay path); tightening the `0017` trigger
  to `goods_receipt.status='accepted'`/location match (deferred to the
  receipt-wiring slice). Eight open owner/TECH points are recorded in
  `docs/BUILD_ROADMAP.md` §5 and "Open decisions / inputs" (next free id
  `DEC-066`). A later delta review of the fixes found two more accepted minors
  (fake `saveStockBalance` parity with the adapter; single-posting
  idempotency-key `:` rejection — see "Delta review" below) and one declined
  (documented) strictness note (`assertIsoInstant` deliberately rejects an ISO
  instant without seconds).
- **Verified (exact):** `npm run lint`, `npm run typecheck`, `npm run build` and
  `npm run format:check` pass; without `DATABASE_URL` **551 passed / 134 skipped
  (685)**; with it **685 passed / 685 (69 files)**; `npm audit --omit=dev` = 0;
  `db:migrate` applies `0017`, re-runs as a no-op, and the down path was
  rehearsed (drop trigger/function/FK, delete the ledger row, re-migrate).
- **Delta review.** After the reconciliation above, a delta review of the
  slice-8 fixes found two more minors, both **accepted and applied** with new
  tests: `FakeInventoryStore.saveStockBalance` now throws when the balance row
  was not locked first (parity with the Postgres repository, which now throws —
  new `packages/application/src/inventory/test-support.test.ts`), and
  `postStockMovement` now also rejects a single-posting `idempotencyKey`
  containing `:` (the batch already did). One **declined (documented)**
  strictness note: an ISO instant without seconds is rejected by the
  `assertIsoInstant` regex — a deliberate choice. The verified counts above
  reflect these additions.
- **Rollback:** the slice is uncommitted and purely additive — discard the
  working tree; once committed, `git revert <sha>`. Migration `0017` is additive
  with the rehearsed down path.
- **Local note:** a reviewer's ad-hoc probe left 3 `stock_movement` rows under a
  throwaway org in the local dev database (undeletable due to the append-only
  trigger; the documented destructive replay would clear them) — a local
  dev-data artefact, no repository impact.
- **Next:** atomic commit (see "Resume here"), then slice 9 — counts +
  transfers + waste.

### 2026-09-20 — Slice 8 review fixes applied (uncommitted)

Applied the reconciled adversarial-review fixes to the still-uncommitted slice-8
working tree (HEAD `f7b1db7`; nothing applied to DigitalOcean). Accepted items
only; no unrelated refactor and no new migration (`0017` already applied).

- **Application (`packages/application/src/inventory/`).** A1: the normal posting
  path now mirrors the reversal path — after `applyStockMovement` it checks
  `revaluationGap` and, when non-null, posts a value-only `revaluation` movement
  (`quantityDelta "0.000000"`, `unitCost null`, `sourceType "revaluation"`,
  reason `input.reasonCode ?? "revaluation"`, idempotency key suffixed
  `:revaluation`) and returns the corrected balance. A2: an idempotency replay
  whose movement belongs to another organization throws
  `DomainError("movement not found in organization")` before touching the other
  org's balance. A3: removed the caller `currency` input; the movement always uses
  `organization.currency`. A4: `postStockMovements` validates `sourceType`,
  `occurredAt` and a non-empty `movements` before opening the transaction. A5:
  the reversal audit records `negative_override: true` when the override was
  used. A6: the `?? "NOK"` fallback is gone — a null-currency movement resolves
  its organization or throws. A7: new `validation.ts` (`assertIsoInstant`) rejects
  non-instant `occurredAt`/`asOf`; lot `expiryDate`/`openedDate` use the existing
  `assertIsoDate`. A8: supplying both `lotId` and `lot` is rejected. A9: reversing
  a `revaluation` movement is rejected. A10: an override that leaves negative
  quantity adds `requires_revaluation: true` to the audit (the DEC-010 exception
  queue is not modelled yet). A11: a batch `idempotencyKey` containing `:` is
  rejected. A12: the fake normalises `occurredAt`/lot `receivedAt` to
  `toISOString()`.
- **Persistence (`packages/persistence/src/repositories/inventory.ts`).** P1:
  new `findOrCreateStockLot` (`INSERT … ON CONFLICT DO NOTHING` then `SELECT`),
  now used by the application lot path; the now-dead application port methods
  `findStockLotByNumber`/`createStockLot` were removed from the port, adapter and
  fake. P2: `saveStockBalance` throws when the update matches no row (callers must
  lock first). P3: `lockOrCreateStockBalance` documents that it MUST run inside a
  transaction. P4: the persistence `createTestStockMovement` comment names the
  documented `0017` trigger no-op.
- **Docs.** D1: the `0017` runbook preflight note now states the plain
  `ADD CONSTRAINT … FOREIGN KEY` takes a `ShareLock` on `stock_lot`, and points to
  the `NOT VALID` → `VALIDATE` form when the table may already hold rows.

Tests added: the posting-path revaluation + clean-zeroing cases, the foreign-org
replay rejection, `lotId`+`lot` rejection, negative-override `requires_revaluation`,
batch pre-validation, strict-instant rejections, UTC normalisation in the fake;
`findOrCreateStockLot` idempotency and the `saveStockBalance` no-op guard at the
persistence layer. **Reviewer note:** the reviewer's literal sequence
`3 @ 0.0001` then `-3` is arithmetically clean (3 × 0.0001 = 0.0003; 0.0003 / 3 =
0.0001 exactly), so it cannot leave a residual; the test keeps that literal
receipt and adds a `27 @ 0.0000` top-up so the 4 dp average rounds to `0.0000`,
which reproduces the same defect class and now posts the correction.

Verified (exact): `npm run typecheck`, `npm run lint`, `npm run build` and
`npm run format:check` pass; without `DATABASE_URL` **549 passed / 134 skipped
(683)**; with it **683 passed / 683 (68 files)**; `npx prettier --write/--check`
run on every touched file. Rollback: discard the working tree; no new migration or
generated file.

### 2026-09-20 — Slice-7 review-fix commits (`c82a30f`, `083106a`); five owner decisions + `ADR-0005` accepted; handoff updated

Two atomic commits on `main` since the last handoff update (which recorded the
slice-7 review fixes as an uncommitted working tree at HEAD `60f3ec5`; the tree is
now clean at HEAD `aa4ab29`; nothing applied to DigitalOcean):

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
