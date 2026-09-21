# Project context

Canonical orientation for this repository: read this first when resuming work,
and update it at the end of any session that changes anything (code, docs,
decisions, data) — per `AGENTS.md` Rule 1. Reference artifacts by path; don't
duplicate their content.

## Resume here (next session)

**Say "resume the work" and start here.** A fresh session must be able to
continue from this section alone. (This section was just rewritten by the
`DEC-081` handoff pass; the next commit is this docs update itself.)

**State:** `main` HEAD **`cb3aff5`** (the last code commit; this handoff update
is the next commit), working tree **clean** before this edit, nothing pushed;
**5 commits** this slice: `2997587` docs(decisions) accept `DEC-081`;
`f4a8110` feat(persistence) `import_profile` table (migration `0031`) +
org-coherence guard (`0032`); `e9ec176` feat(imports) resolve a run's import
profile by source; `1914795` feat(web) profile-aware import creation and seed;
`cb3aff5` docs(runbook) document migrations `0031`/`0032`. **Nothing applied to
DigitalOcean.**

**Delivered (`DEC-081`):** `import_profile` keyed `(organization_id, source)`
(unique) carrying `profile_version`, `posting_policy` (default `allow_partial`,
checked against `import_posting_policy`) and `validation_rules` jsonb (checked
to be a jsonb object), plus a nullable `import_run.import_profile_id` FK (legacy
runs keep null, no backfill). `createImportRun` resolves the source's profile
inside the transaction: the profile supplies the version and policy, a
conflicting caller-supplied policy/version is rejected, and a source with no
profile keeps `DEC-025` behaviour (`profileVersion` required, `allow_partial`
default). `validateImportRun` resolves the run's profile rules through a
fail-closed `parseImportValidationRules` and merges explicit caller rules over
them field-by-field. `ImportStore` gained `findImportProfile`/
`createImportProfile` (Postgres adapter + fakes); values are trimmed
consistently. Migration `0031` (generated, additive) with a rehearsed
unjournaled down; migration `0032` (hand-written) adds the
`import_run_profile_org_guard` `BEFORE INSERT OR UPDATE` trigger enforcing
`import_run.organization_id` coherence with the profile (the `DEC-079`
precedent), with its own rehearsed unjournaled down. Web: the create-run body's
`profileVersion` is optional; the seed ensures the `zettle-legacy` profile
idempotently; the run detail page and new-run form describe the
profile-resolved version/policy.

**Verification at `cb3aff5`:** `typecheck`, `lint`, `build`, `format:check`
clean; **1353/1353 tests with `DATABASE_URL`** (135 files);
`npm audit --omit=dev` = 0; `db:migrate` through `0032` is a no-op on re-run;
both new down paths rehearsed; **66 tables**; every new read/write
organization-scoped (`DEC-061`).

**Reviews and reconciliation:** `reviewer-qwen` — no blocker/major; four minors
**accepted and applied** (trimming consistent between profile creation and run
resolution; `parseImportValidationRules` trims list entries and rejects blanks;
the `postingPolicy` conflict check trims; the missing-profile error names the
profile id and organization). `reviewer-minimax` — no blocker; **one major
accepted and applied** (the new run→profile FK needed the same
cross-organization coherence guard `DEC-079` uses, hence migration `0032`); two
minors **accepted** (the stale `IMPORT_POSTING_POLICY` persistence docstring
fix; a `ponytail:` note for the deliberately absent reverse index) and two
**declined** (adding the reverse-FK index now — no read path yet; re-framing the
struck-through `sales.ts` open point — the `DEC-078` traceability convention).
`reviewer-glm` final pass — no blocker/major; two minors **declined** (the
untrimmed `fileHash` replay guard is pre-existing at the baseline; a
caller-supplied `expectedCurrency: ""` is boundary-level and normalised by the
HTTP layer).

**Dev server (session-scoped):** the previous session ran a dev server at
http://localhost:3000 with
`DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela`,
`ORGANIZATION_ID=1448a476-32f2-426f-b153-11a851011e48`; sign in `owner` /
`LocalDevPass123`; MFA is disabled for `owner`, so no TOTP key is needed; demo
data is seeded (including the `zettle-legacy` `import_profile`:
`profile_version` `i19-v1`, `posting_policy` `allow_partial`). **A fresh session
must restart the server** — the process does not survive the session end.

**Next buildable code task:** **enforce the import profile's posting policy in
`postImportRun` (`DEC-025`).** The policy is now stored on `import_profile`
(and mirrored into the run's `diagnostics.posting_policy`) but `postImportRun`
(`packages/application/src/sales/post-import-run.ts`) never reads it, so
`all_or_nothing` currently behaves exactly like `allow_partial`. Semantics per
`DEC-025`: `allow_partial` posts valid/mapped rows and marks the run
`partially_posted`; `all_or_nothing` must refuse to post when any row is not
postable; every non-posted row still requires an approved disposition
(`DEC-035`). TECH-owned and buildable without owner input. Record any genuinely
new decision from **`DEC-082`** (append to `12_OPEN_DECISIONS.md` — never invent
silently).

**Scope (do):** read the run's resolved profile policy inside `postImportRun`
and implement the `DEC-025` semantics (`allow_partial` → post valid/mapped rows,
mark `partially_posted`; `all_or_nothing` → refuse to post when any row is not
postable), keeping the `DEC-035` disposition requirement for every non-posted
row; add/update the `.test.ts` covering both policies (happy path + the
all-or-nothing refusal edge); adjust the web posting surface only if a
message/status change is needed; sweep any `sales`/`reconciliation` read that
assumes the current behaviour; record any genuinely new decision as **`DEC-082`**
(append to `12_OPEN_DECISIONS.md` — never invent silently); small atomic commits
with the rollback approach in the body (per `AGENTS.md` Rule 2); update
`CONTEXT.md` at the end.

**Scope (do not):** do not start the still owner/data-gated work — the
receipt→ledger wiring (needs the OPS destination `storage_area_id` policy); row
13 (data-gated on history/grain quality, I11); row 14 (owner-gated on the
privacy review); rows 15–18 (blocked: data / `ADR-0009`–`0011`); the
price-version scope-resolution fallback; consumption grain A1. Do not edit
migrations `0000–0032`; do not deploy, `terraform apply`, or write externally
(per `DEC-015`); do not resolve the recorded owner inputs silently; do not
rewrite the specification inputs (`00_README.md` … `13_`, `docs/phase0/`,
`schemas/`, `samples/`).

**Files/paths:** `packages/application/src/sales/post-import-run.ts` (+ its
test — the `DEC-081` profile resolution it must consume lives in the imports
slice), the web posting surface (`apps/web/app/(app)/sales/**`,
`apps/web/app/api/v1/**`) only if a message/status change is needed, any
`sales`/`reconciliation` read that assumes the current behaviour
(`packages/application/src/sales/**`,
`packages/application/src/reconciliation/**`), and `12_OPEN_DECISIONS.md` for
`DEC-082` if needed; update `CONTEXT.md` at the end.

**Authoritative docs to read first:** `docs/BUILD_ROADMAP.md` §1 (current
position) and §4–§5; `12_OPEN_DECISIONS.md` (`DEC-025` posting policy,
`DEC-035` dispositions, `DEC-081` import profile, next free id **`DEC-082`**);
the row-11 open-point list (its import-framework point 4 is now resolved); this
file's "Open decisions / inputs"; `AGENTS.md` Rules 1–3.

**Acceptance / verification:** `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh";
nvm use 22`, then `npm run lint`, `npm run typecheck`, `npm run test` (with
`DATABASE_URL` — current baseline: **1353/1353**, 135 files), `npm run build`,
`npm run format:check`, `npm audit --omit=dev` = 0; `db:migrate` through `0032`
is a no-op on re-run; confirm no schema change (still **66 tables**) unless the
task genuinely adds one; after each commit re-run the suite at the clean tree
and confirm HEAD advanced.

**Programme direction (standing user instruction):** proceed autonomously — per
task: parallel background agents → adversarial review + fixes → document status
and next steps → commit → next task. Global ruleset
(`~/.config/kilo/AGENTS.md`): compact context at 25 %; pausing is permitted
above USD 20 at a clean point (committed, verified, documented).

**Open inputs (recorded, do not decide):** consumption grain A1 (`DEC-009`
daily-per-location vs a single `sales_line` source); the price-version
**scope-resolution fallback** (exact-scope only today — see "Open decisions /
inputs"); the OPS receipt destination `storage_area_id` policy; `file_object`
absent so `import_run.file_object_id` is a plain uuid; receipts not wired to the
ledger; the owner/deployment inputs. Full list under "Open decisions / inputs";
next free decision id **`DEC-082`**.

**Parallel owner action — golden-fixture sign-off:** the six golden fixtures are
prepared as machine-readable JSON under `tests/fixtures/` (`DEC-065`) with the
sign-off trail ready; finance + product owner sign. Until signed, no cost is
"verified"; `I8`/`I9` still gate the real rates behind the fixtures.

**Step after this one:** the smaller TECH items — the dispositions table (row-11
point 7: dispositions live in `import_run.diagnostics.dispositions` jsonb), the
count-variance/yield-variance exception producers (`PROD-003`, using the
`DEC-080` `data_quality_exception` table), and `file_object` — then the
receipt→ledger wiring if the OPS destination `storage_area_id` policy lands;
row 13 (close + dashboards + menu engineering) when history/grain quality (I11)
is confirmed; then row 14 when the privacy review lands; the deployment
rehearsal once the owner inputs arrive (see "Next up").

## What this is

**Aquarela Business Control** — a secure, testable modular monolith for an Oslo
café with two locations, covering costing, pricing, inventory, production,
sales/imports, workforce and reporting. It is **documentation-first**: Phase 0 is
complete (specification, 65 accepted decisions, artifacts and ADRs); the
foundation scaffold, the Phase 1–2 persistence core, the auth slices (1a–1e), the
UI token foundation, master-data slices 2–3, slice 4 (receipt + price history +
landed cost), slice 5 (recipes), slice 6 (operating costs + labour + allocation),
slice 7 (cost card + snapshots + price scenario + approval), slice 8 (stock
ledger + balances + lots/storage), slices 9 (counts + transfers + waste), slice
10 (production planning + batches, including the web layer), row 11 (import
framework + external mappings) and row 12 (sales + settlements + reconciliation)
— **all committed** (through HEAD `cb3aff5`; rows 11 and 12 complete; the
price-version slice — `price_version` with approval-driven effective versions
— complete, the `DEC-078` vocabulary/`lotTracked`, `DEC-079`
cross-organization coherence and `DEC-080` `data_quality_exception`
integrity points, and the `DEC-081` import-profile slice — the
`import_profile` table, migration `0031`, plus the `import_run` org-coherence
guard `0032`), with the design
system/app shell/screens and migrations `0017`–`0032`; the
`DEC-072`–`DEC-081` low-risk implementations (effective-dated reconciliation
tolerance, sales-line reversal, `MAPPING_STATE` `conflict`, typed recipe 404s,
the `price_version` slice, the `settlement.status`/`reconciliation.scope_type`
vocabularies, `lotTracked` enforcement, the cross-organization coherence
guards, the `data_quality_exception` table and the `import_profile` table).

## Where things live

- `00_README.md` … `13_AGENT_BUILD_BRIEF.md` — the specification package
  (inputs, rarely edited). Start with `00_README.md`.
- `12_OPEN_DECISIONS.md` — the accepted decisions (DEC-001…DEC-080); the
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

- **As of:** 2026-09-21 — branch `main`; HEAD `cb3aff5` (the last code commit;
  this handoff/docs commit is next);
  working tree **clean** before this edit; nothing pushed. **5 commits** this
  slice: `2997587` docs(decisions) accept `DEC-081`; `f4a8110`
  feat(persistence) `import_profile` table (migration `0031`) + org-coherence
  guard (`0032`); `e9ec176` feat(imports) resolve a run's import profile by
  source; `1914795` feat(web) profile-aware import creation and seed;
  `cb3aff5` docs(runbook) document migrations `0031`/`0032` — **all committed**
  (see "Work log" and "Reversibility").
  **Delivered (`DEC-081`):** `import_profile` keyed
  `(organization_id, source)` (unique) carrying `profile_version`,
  `posting_policy` (default `allow_partial`, checked against
  `import_posting_policy`) and `validation_rules` jsonb (checked to be a jsonb
  object), plus a nullable `import_run.import_profile_id` FK (legacy runs keep
  null, no backfill). `createImportRun` resolves the source's profile inside
  the transaction (the profile supplies the version and policy; a conflicting
  caller-supplied policy/version is rejected; a source with no profile keeps
  `DEC-025` behaviour — `profileVersion` required, `allow_partial` default);
  `validateImportRun` resolves the run's profile rules through a fail-closed
  `parseImportValidationRules` and merges explicit caller rules over them
  field-by-field; `ImportStore` gained `findImportProfile`/
  `createImportProfile` (Postgres adapter + fakes); values are trimmed
  consistently. Migration `0031` is additive with a rehearsed unjournaled down;
  migration `0032` (hand-written) adds the `import_run_profile_org_guard`
  `BEFORE INSERT OR UPDATE` trigger enforcing `import_run.organization_id`
  coherence with the profile (the `DEC-079` precedent), with its own rehearsed
  unjournaled down. Web: the create-run body's `profileVersion` is optional;
  the seed ensures the `zettle-legacy` profile idempotently; the run detail
  page and new-run form describe the profile-resolved version/policy.
  **Reviews and reconciliation:** `reviewer-qwen` — no blocker/major; four
  minors **accepted and applied** (consistent trimming between profile
  creation and run resolution; `parseImportValidationRules` trims list entries
  and rejects blanks; the `postingPolicy` conflict check trims; the
  missing-profile error names the profile id and organization).
  `reviewer-minimax` — no blocker; **one major accepted and applied** (the new
  run→profile FK needed the same cross-organization coherence guard `DEC-079`
  uses, hence migration `0032`); two minors **accepted** (the stale
  `IMPORT_POSTING_POLICY` persistence docstring fix; a `ponytail:` note for the
  deliberately absent reverse index) and two **declined** (adding the
  reverse-FK index now — no read path yet; re-framing the struck-through
  `sales.ts` open point — the `DEC-078` traceability convention).
  `reviewer-glm` final pass — no blocker/major; two minors **declined** (the
  untrimmed `fileHash` replay guard is pre-existing at the baseline; a
  caller-supplied `expectedCurrency: ""` is boundary-level and normalised by
  the HTTP layer) — see the work log.
  **Verification at `cb3aff5`:** `format:check`, `typecheck`, `lint`, `build`
  clean; **1353/1353 tests with `DATABASE_URL`** (135 files);
  `npm audit --omit=dev` 0; `db:migrate` through `0032` is a no-op; both new
  down paths rehearsed; **66 tables**; every new
  read/write organization-scoped (`DEC-061`).
  **Dev server (session-scoped):** the previous session ran http://localhost:3000
  with `DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela`,
  `ORGANIZATION_ID=1448a476-32f2-426f-b153-11a851011e48`; sign in `owner` /
  `LocalDevPass123`; MFA is disabled for `owner` (no TOTP key needed); demo
  data is seeded including the `zettle-legacy` `import_profile`
  (`profile_version` `i19-v1`, `posting_policy` `allow_partial`); a fresh
  session must restart the server.
  Remaining roadmap: the next unblocked task is
  the **`postImportRun` posting-policy enforcement (`DEC-025`)** — the
  `DEC-081` profile policy is stored but never read, so `all_or_nothing`
  currently behaves like `allow_partial`; TECH-owned and buildable without
  owner input (record any needed decision from `DEC-082`) — after which the
  remaining buildable technical items are smaller (the dispositions table, the
  `PROD-003` exception producers, `file_object`); then
  the receipt→ledger wiring if the OPS policy lands; row 13 is data-gated on
  history/grain quality
  (I11); row 14 owner-gated on the privacy review / access matrix; rows 15–18
  blocked (data / `ADR-0009`–`0011`); the deployment rehearsal is parked on
  owner inputs.
  Programme direction (user instruction): proceed autonomously — review/fix,
  document status + next steps, commit, then the next unblocked task.
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
  **1353/1353 passed** (135 files) — recorded
  2026-09-21 at the clean HEAD `cb3aff5` (all
  checks pass; `db:migrate` through `0032` is a
  no-op, and both the `0031` and `0032` down paths were rehearsed). Re-verify
  with `npm run test` and update if they differ.
  Open verification debt: the per-process rate limiter needs a shared
  store before multi-instance deployment; the reset-token delivery is a no-op stub
  until the email slice; the palette hex values and data-viz palette semantics
  await owner sign-off (see "Open decisions / inputs"); the six golden fixtures
  remain unsigned and are the "verified" gate.
- **Persistence core + deployment foundation (committed):** Drizzle schema,
  migrations `0000_enable_extensions` → `0032` additive with tested down paths
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
  `production_batch`; `0022` adds the row-11 tables
  `import_run`/`import_staging_row`/`external_mapping` and vocabularies
  `IMPORT_STATUS`/`MAPPING_STATE`/`IMPORT_POSTING_POLICY`; **`0023`**
  adds the row-12 tables `sales_transaction`/`sales_line`/
  `settlement`/`reconciliation`, vocabularies `RECONCILIATION_STATUS`/
  `OPTION_KIND` and the `sales_line` branch in `stock_movement_source_guard`
  (all committed, `2104068`/`77d913e`); **`0024`–`0026`** add the
  `reconciliation_tolerance` table + EXCLUDE constraint (`0024`), the
  `MAPPING_STATE` `conflict` value (`0025`) and the
  `sales_line_reversal_of_id_key` partial unique index (`0026`; committed in
  `6ff5881`); **`0027`** adds the `price_version` table (half-open
  `[effective_from, effective_to)` for PRICE-002/003, non-overlapping per
  `(organization_id, product_variant_id, location_id, channel_id)` via a
  hand-written EXCLUDE with a COALESCE sentinel; committed in `414832b`);
  **`0028`** adds the `DEC-078` check constraints
  `settlement_status_check` and `reconciliation_scope_type_check` (the
  `{received, paid, void}` and `reconciliation_scope_type` vocabularies;
  committed in `ed93288`);
  **`0029`** enforces cross-organization coherence on the recipe/receipt
  FKs via `BEFORE INSERT OR UPDATE` guard triggers (`recipe_allergen.
 allergen_id`, `recipe_line.item_id`/`sub_recipe_id`,
  `goods_receipt_line.supplier_item_id` — the receipt-line guard also
  enforcing the supplier and item match) plus the deferred single-column
  FK on `goods_receipt_line.supplier_item_id` (`NOT VALID` → `VALIDATE`;
  committed in `9d0e055`);
  **`0030`** adds the `data_quality_exception` table (`rule_code`,
  `severity ∈ {low, medium, high, critical}` default `medium`,
  `entity_type`/`entity_id` polymorphic, `detected_at`, `owner_id`,
  `due_date`, `status ∈ {open, acknowledged, resolved, dismissed}` default
  `open`, `resolution`; committed in `d1d0fad`);
  **`0031`** adds the `DEC-081` `import_profile` table (keyed
  `(organization_id, source)` unique, `profile_version`, `posting_policy`
  checked against `import_posting_policy`, `validation_rules` jsonb object) and
  a nullable `import_run.import_profile_id` FK, and **`0032`** adds the
  `import_run_profile_org_guard` `BEFORE INSERT OR UPDATE` coherence trigger
  (committed in `f4a8110`);
  ledger 32 rows through `0032`; the `asset`
  register is deliberately deferred), the
  advisory-locked migrator, worker/scheduler
  stubs and the `infra/` Terraform scaffold validated offline. Not applied.
- **Not yet built:** row 13 (close + dashboards + menu engineering —
  data-gated on history/grain quality, I11), row 14 (workforce — owner-gated
  on the privacy review / access matrix) and rows 15–18
  (blocked: data / `ADR-0009`–`0011`); also
  the deferred tables
  (workforce, integrations, competitor, AI, procurement, period close,
  platform job/file/approval — note the
  `approval` platform table from DATA_DICTIONARY §9 does not exist yet, and the
  `file_object` table is absent so `import_run.file_object_id` is a plain uuid —
  and the
  `asset` register).

## Next up (prioritised)

`docs/BUILD_ROADMAP.md` is the ordered execution tracker for these slices (slice 0,
1a–1e and 2–12 done, incl. row 11 and row 12 and the `DEC-081` import-profile
slice; the `DEC-072`–`DEC-081` decisions + low-risk implementations are done,
committed `aaec400`–`cb3aff5`; further rows are gated — row 13 on data (I11),
row 14 owner-only, rows 15–18 on data/ADRs).
The list below is the short narrative form.

1. **`postImportRun` posting-policy enforcement (`DEC-025`)** — the `DEC-081`
   profile policy is stored on `import_profile` (and mirrored into the run's
   `diagnostics.posting_policy`) but never read, so `all_or_nothing` behaves
   exactly like `allow_partial`. Implement `allow_partial` → post valid/mapped
   rows, mark `partially_posted`; `all_or_nothing` → refuse to post when any
   row is not postable; every non-posted row still needs an approved
   disposition (`DEC-035`). TECH-owned and buildable without owner input;
   record any needed decision from `DEC-082`. Programme direction: proceed
   autonomously (agents → review/fix → document → commit → next task).
2. **Smaller TECH items** — the dispositions table (row-11 point 7:
   dispositions live in `import_run.diagnostics.dispositions` jsonb); the
   count-variance/yield-variance exception producers (`PROD-003`, using the
   `DEC-080` `data_quality_exception` table); `file_object`.
3. **Row 13 — close + dashboards + menu engineering** — `ADR-0007` is accepted
   (2026-09-20); **data-gated** on history/grain quality (I11) — synthetic
   fixtures until real data.
4. **Row 14 — workforce** — owner-gated on the privacy review / access matrix
   (rows 15–18 remain blocked: data / `ADR-0009`–`0011`).
5. **Test-deployment rehearsal** — per `docs/runbooks/deployment.md`, staging first
   with sanitized/synthetic data only; parked on the deployment prerequisite inputs
   (see "Open decisions / inputs" — a scoped `DIGITALOCEAN_TOKEN`, a private
   Spaces state bucket + credentials, the sanitized-data/clone decision,
   `ADR-0004` acceptance, the legacy instance-slug check).
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

- **Resolved this session (2026-09-21, `DEC-081`):** the
  **import-profile table** is delivered — `import_profile` keyed
  `(organization_id, source)` (unique) carrying `profile_version`,
  `posting_policy` (default `allow_partial`, checked against
  `import_posting_policy`) and `validation_rules` jsonb (checked to be a jsonb
  object), plus a nullable `import_run.import_profile_id` FK — migrations
  `0031` (additive, generated) and `0032` (the
  `import_run_profile_org_guard` coherence trigger, the `DEC-079` precedent) —
  with the application wiring (`createImportRun` resolves the source's profile,
  `validateImportRun` merges the profile's rules under explicit caller rules)
  and the web layer (commits `2997587`/`f4a8110`/`e9ec176`/`1914795`/`cb3aff5`).
  The row-11 "no import-profile table exists" point is closed; the profile's
  posting policy is still **not enforced** by `postImportRun` — that is the
  next TECH task (`DEC-025`, see "Resume here"). Next free decision id
  **`DEC-082`**.
- **Resolved this session (2026-09-21, `DEC-080`, DQ-001):** the
  `data_quality_exception` table is delivered (migration `0030`) —
  `DEC-066`'s replacement for the interim `stock_transfer.discrepancy_note`
  and the natural home for count-variance and yield-variance exceptions
  (`PROD-003`) — with repository create/find/list/update and the first
  producer: `receiveStockTransfer` creates a `transfer_discrepancy`
  exception (severity `high`, entity `stock_transfer`, status `open`) in
  the same transaction as the receive, alongside the note (commits
  `40b5d7e`/`d1d0fad`/`ddc9e06`). The "no transfer-discrepancy exception
  table exists" point from the slice-9 open list is closed. Next free
  decision id **`DEC-082`**.
- **Resolved this session (2026-09-21, `DEC-079`, closing `DEC-054`):** the
  cross-organization referential-integrity / deferred-FK hardening is
  delivered — coherence on `recipe_allergen.allergen_id`,
  `recipe_line.item_id`/`sub_recipe_id` and
  `goods_receipt_line.supplier_item_id` is enforced by
  `BEFORE INSERT OR UPDATE` guard triggers (the `stock_movement_source_guard`
  precedent), not denormalized composite FKs plus a backfill; the
  receipt-line guard also enforces the supplier and item match;
  `goods_receipt_line.supplier_item_id` got its deferred single-column FK
  (`NOT VALID` → `VALIDATE`) — migration `0029` (commits `8376209`/`9d0e055`).
  The "deferred-FK hardening on `goods_receipt_line`" and "`DEC-054`
  cross-organization integrity on the recipe FKs" points from the surfaced
  lists are closed. Next free decision id **`DEC-080`**.
- **Resolved this session (2026-09-21, `DEC-078`):** the remaining low-risk
  vocabulary/integrity open points are delivered — `settlement.status`
  constrained to `{received, paid, void}` (default `received`),
  `reconciliation.scope_type` constrained to the new `reconciliation_scope_type`
  `{import_run, sales_source, settlement, supplier_invoice}` (migration `0028`
  check constraints; the "no settlement.status / reconciliation.scope_type
  vocabulary" point from the row-12 open list is closed) with
  `assertReconciliationScopeType` rejecting an unknown scope before any
  write; and `lotTracked` enforcement (the slice-8/9 "`lotTracked`
  unenforced" point is closed — a null-`lotId` posting is rejected for a
  lot-tracked item; the reversal path stays exempt because it mirrors the
  original lot).
  Next free decision id **`DEC-080`**.
- **Resolved this session (2026-09-21, `DEC-077`):** the price-version slice
  (`DEC-064`, PRICE-002/003) is delivered — the `price_version` table
  (migration `0027`, half-open `[effective_from, effective_to)`, non-overlap
  per scope via an EXCLUDE with a COALESCE sentinel; the "no `price_version`
  table" point from the slice-7 open list is closed) and approval-driven
  effective versions with the CAS `approvePriceScenarioIfApprovable` race fix.
- **Price-version scope resolution is exact-scope only (new, 2026-09-21;
  recorded not decided — do not resolve silently):** there is no
  company-wide (`null` location/channel) → specific-location/channel fallback
  in `findEffectivePriceVersion`; a company-wide version is a distinct "any"
  scope (per `DEC-077`) and does not currently
  resolve for a specific location today. Whether a fallback hierarchy is
  wanted (and its precedence) is an owner/TECH decision.
- **Resolved 2026-09-20 (`DEC-072`–`DEC-076`):** the
  effective-dated `reconciliation_tolerance` table (`DEC-072`, migration
  `0024` — the "no tolerance-configuration table" point is closed; precedence:
  explicit override → effective config at period end → explicit `DEC-026`
  default opt-in → block close); sales-line reversal semantics (`DEC-073`,
  migration `0026` — the `DEC-028` sales-line point is closed);
  `MAPPING_STATE` `conflict` (`DEC-074`, migration `0025`); `tax_rule_id`
  canonical with `applied_tax_rate` as the source-reported applied rate (A4,
  `DEC-075`, docs-only); the typed `NotFoundError` replacing the
  `/not found/i` message match (`DEC-076`). Next free decision id **`DEC-080`**.
- **Resolved this session (2026-09-20, previous session):** `ADR-0005` is **Accepted** (stock
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
  reconciliation) is now **committed** (`2104068`/`77d913e`; `ADR-0008` accepted
  2026-09-20, owner-delegated) and row 13 is no longer ADR-gated
  (`ADR-0007` accepted 2026-09-20) — history/grain quality remains the data
  gate; the I1 channel/SKU confirmations remain recorded owner inputs.
  Remaining items: the
  sales/consumption grain ambiguity (`DEC-009` daily-per-location vs a single
  `sales_line` `source_id`, FIN+TECH);
  ~~no import-profile table (TECH)~~ resolved 2026-09-21 (`DEC-081` — the
  `import_profile` table, migrations `0031`/`0032`; the profile's posting
  policy enforcement by `postImportRun` (`DEC-025`) is the **next unblocked
  TECH task**, see "Resume here");
  `file_object` is absent, so
  `import_run.file_object_id` is a plain uuid (TECH); dispositions live in
  `diagnostics.dispositions` jsonb, not a table (TECH). Also a
  live-check left one dev `import_run` row in the local database (see "Local
  dev-DB cleanup" below). Record each resolution in `12_OPEN_DECISIONS.md`
  (next free id **`DEC-082`**); do not resolve silently.
- **Row-12 sales/reconciliation open points (2026-09-20; also tracked in
  `docs/BUILD_ROADMAP.md` §5 "Row-12 sales/reconciliation open points";
  recorded, not decided — do not resolve silently):** consumption grain A1
  (`DEC-009` daily-per-location vs a single `sales_line` source);
  ~~`settlement.status` and
  `reconciliation.scope_type` have no vocabulary~~ resolved 2026-09-21
  (`DEC-078`); the `sales_line`-guard test
  fix (a pre-existing inventory test posting a `sales_line` movement with a
  fake source id was fixed — the new guard correctly rejects it); the legacy
  I19 import carries no resolvable `location_id`, so the demo theoretical
  consumption posts zero recipe-bearing lines; a local dev-DB side effect (the
  demo import run left `partially_posted` and a reconciliation reopened to
  `pending`). Row 13 is data-gated on history/grain quality (I11); row 14 is
  owner-gated on the privacy review / access matrix; rows 15–18 remain blocked
  (data / `ADR-0009`–`0011`). Record each resolution in
  `12_OPEN_DECISIONS.md` (next free id **`DEC-082`**); do not resolve silently.
- **Slice-9/10 open owner questions (2026-09-20; also tracked in
  `docs/BUILD_ROADMAP.md` §5 "Slice-9/10 open owner questions"):** output-cost
  allocation across multiple outputs/by-products (FIN); yield-variance tolerance
  and exception store (`PROD-003`, FIN+TECH); work-in-progress/source-draw storage
  area (OPS+TECH); `production_plan` line/quantity model and status vocabulary
  (OPS+TECH); lot-tracked cross-location transfer policy (OPS); per-source stock
  reversal semantics (`DEC-028` — the sales-line variant is now implemented via
  `DEC-073`) not yet implemented for stock (TECH); receipts not wired to the
  ledger (TECH); ~~`lotTracked` unenforced (TECH)~~ resolved 2026-09-21
  (`DEC-078`); `DEC-009` daily theoretical
  consumption not implemented (TECH). Record each resolution in
  `12_OPEN_DECISIONS.md` (next free id **`DEC-082`**); do not resolve silently.
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
  - ~~the deferred-FK hardening on `goods_receipt_line` (a `supplier_item_id` or
    `item_id` from another organization, a mismatched supplier, or a unit that
    does not match the item is guarded only in the application until those FKs
    are added — make them composite and validate per the runbook's
    `NOT VALID` → `VALIDATE` pattern; the `effective_to = effective_from` empty
    window is allowed by `DEC-052`)~~ resolved 2026-09-21 (`DEC-079` — the
    receipt-line coherence guard trigger enforces the supplier and item match,
    plus the deferred single-column FK on `supplier_item_id`);
  - `DEC-054` open policy points: deleting a recipe version cascades
    `recipe_allergen` (allergen history is dropped before any audit) and a zero
    `current_cost` is accepted for an item — both need a policy decision; and
    ~~cross-organization referential integrity on the recipe FKs stays
    application-guarded until the composite-FK/trigger invariants land~~
    resolved 2026-09-21 (`DEC-079` — the coherence guard triggers cover
    `recipe_allergen.allergen_id` and `recipe_line.item_id`/`sub_recipe_id`).
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
- **Surfaced by slice 8** (at HEAD `f7b1db7`, since committed with the slice-8/9 layer commits): eight
  stock-ledger open (owner/TECH) points are recorded in `docs/BUILD_ROADMAP.md` §5
  ("Slice-8 stock-ledger open points"); record each resolution in
  `12_OPEN_DECISIONS.md` (next free id **`DEC-066`**); do not resolve silently:
  goods-receipt acceptance is not yet wired to the ledger (no destination
  `storage_area_id` on a receipt; the receipt→movement integration and its
  storage-area policy are unresolved, `post-stock-movement.ts`); per-source
  reversal semantics are not enumerated (a non-receipt reversal posts movement
  type `correction`; only `receipt` → `receipt_reversal`; `DEC-028` defines the
  semantics per source type, `reverse-stock-movement.ts`); ~~`lotTracked` is not
  enforced (a lot-tracked item can post with `lotId` null,
  `post-stock-movement.ts`)~~ resolved 2026-09-21 (`DEC-078` — the null-`lotId`
  posting is rejected for a lot-tracked item; the reversal path stays exempt
  because it mirrors the original lot); the `DEC-028` "reversal blocked when reconciled
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
  rule, `DEC-017`/`DEC-029` — owner/FIN); ~~**no transfer-discrepancy exception
  table exists** (a discrepancy between shipped and received movements is only
  derivable from the ledger — owner/TECH)~~ resolved 2026-09-21 (`DEC-080` —
  the `data_quality_exception` table with the `transfer_discrepancy` producer).
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

- **`DEC-081` import-profile slice (committed as five commits since
  the `b57fc3d` baseline; nothing pushed)**: `2997587` (the `DEC-081` decision
  entry), `f4a8110` (persistence — the `import_profile` table, migration
  `0031`, and the `import_run_profile_org_guard` trigger, migration `0032`),
  `e9ec176` (imports — resolve a run's import profile by source), `1914795`
  (web — profile-aware import creation and seed) and `cb3aff5` (runbook docs
  for `0031`/`0032`) — each is independently revertible with `git revert <sha>`;
  because the web/application commits consume the persistence types, revert the
  web/application commits before persistence if reverting a cohort. Migrations
  `0031`/`0032` are **additive** with rehearsed unjournaled down paths
  (`0031` down drops `import_run.import_profile_id` first then `import_profile`;
  `0032` down drops the trigger and function), no data migration, nothing
  rewrites existing schema objects. Nothing pushed; nothing applied to
  DigitalOcean.
- **`DEC-080` data-quality-exception slice (committed as three commits since
  the `9d0e055` baseline; nothing pushed)**: `40b5d7e` (the `DEC-080`
  decision entry), `d1d0fad` (persistence migration `0030` — the
  `data_quality_exception` table + repository) and `ddc9e06` (the
  `transfer_discrepancy` producer in `receiveStockTransfer`) — each is
  independently revertible with `git revert <sha>`. Migration `0030` is
  **additive** (a new table, no data migration, nothing rewrites existing
  schema objects) with a rehearsed unjournaled down path (drop the table,
  delete the ledger row, re-migrate). Nothing pushed; nothing applied to
  DigitalOcean.
- **`DEC-079` cross-organization coherence guards (committed as two commits
  since the `a5c3db2` baseline; nothing pushed)**: `8376209` (the `DEC-079`
  decision entry) and `9d0e055` (persistence migration `0029` — the
  `BEFORE INSERT OR UPDATE` coherence guard triggers on `recipe_allergen`,
  `recipe_line` and `goods_receipt_line` + the deferred single-column FK on
  `goods_receipt_line.supplier_item_id`) — each is independently revertible
  with `git revert <sha>`. Migration `0029` is hand-written/journaled,
  forward-only, with a rehearsed **unjournaled** down path (drop the
  triggers/functions and the FK, delete the ledger row, re-migrate); no data
  migration. Nothing pushed; nothing applied to DigitalOcean.
- **`DEC-078` vocabulary/`lotTracked` slice (committed as four commits since
  the `80bbe1c` baseline; nothing pushed)**: `3673633` (the `DEC-078` decision
  entry), `ed93288` (persistence migration `0028` — the
  `settlement_status_check`/`reconciliation_scope_type_check` constraints +
  the vocabulary schema), `39d3364` (the `lotTracked` null-`lotId` guard in
  `postStockMovementInternal`) and `a5c3db2` (`scope_type` validation via
  `assertReconciliationScopeType`, incl. the review-strengthened
  message-assertion tests) — each is independently revertible with
  `git revert <sha>`. Migration `0028` is **additive** (two CHECK
  constraints + the new vocabulary type) with a rehearsed unjournaled down
  path (drop the checks/column default, restore the enum, delete the ledger
  row, re-migrate); no data migration. The docs commits are trivial reverts.
  Nothing pushed; nothing applied to DigitalOcean.
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
- **Rows 11 + 12 + ADR acceptance + the error-fix (all committed; nothing
  pushed)**: the row-11 import slice (migration `0022`), the row-12 sales +
  settlements + reconciliation slice (migration `0023`, vocabularies
  `RECONCILIATION_STATUS`/`OPTION_KIND`, domain `sales-consumption.ts`,
  application `sales/**` and `reconciliation/**`, web `/api/v1/sales/**` +
  `/api/v1/reconciliations/**` + `(app)/sales/**` + seed), the cross-cutting
  `jsonError`/`mapErrors` error-handling fix and the `ADR-0007`/`ADR-0008`
  acceptances landed on `main` (HEAD `77d913e`); each commit is revertible with
  `git revert <sha>`. Migrations `0022`/`0023` are additive with rehearsed down
  paths (drop the added objects/tables, delete the ledger row, re-migrate); the
  error fix touched no migration or generated file. Slices 9–12 shared barrel
  files, so reverting across a boundary may require reverting the cohort.
- **DEC-072–076 decisions + low-risk implementations (committed as seven
  commits since `bcb625a`; nothing pushed)**: six landed (`aaec400` the five
  decision entries; `dcec861` the eslint ignore for Agent Manager worktrees
  under `.kilo/`; `44eb93a` domain typed `NotFoundError` + `toleranceAmount`;
  `6ff5881` persistence migrations `0024`–`0026`; `301c381` application
  tolerance resolution + mapping conflict + `reverseSalesLine` + typed recipe
  404s; `c0b0d77` web recipe 404s + `conflict` label) plus this handoff/docs
  commit — each is independently revertible with `git revert <sha>`.
  Migrations `0024`–`0026` are additive with rehearsed unjournaled down paths:
  `0024` down drops the `reconciliation_tolerance` table + EXCLUDE constraint;
  `0025` down restores the four-value `MAPPING_STATE` checks (it fails if
  `conflict` rows exist — the preflight is documented); `0026` down drops the
  `sales_line_reversal_of_id_key` partial unique index. The eslint-ignore
  change and the docs commits are trivial reverts. No data migration; nothing
  pushed; nothing applied to DigitalOcean.
- **Price-version slice (`DEC-064`/`DEC-077`, committed as five commits since
  the `c0b0d77` baseline; nothing pushed)**: `4e755a0` (the `DEC-077` decision
  entry), `e94dfe1` (domain effective-window helpers), `414832b`
  (persistence `price_version` + repository + migration `0027`),
  `e2bd2b1` (application approval + reads, incl. the CAS
  `approvePriceScenarioIfApprovable`) and `80bbe1c` (web approve route +
  price-versions API + screens) — each is independently revertible with
  `git revert <sha>`. Migration `0027` is additive (a new table + its EXCLUDE
  constraint) with a rehearsed unjournaled down path (drop the constraint and
  the table, delete the ledger row, re-migrate); no data migration.
  The `4e755a0` docs commit and the handoff/docs commit are trivial reverts.
  Nothing pushed; nothing applied to DigitalOcean.
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
- Migrations 0000–0032 are additive with tested down paths (`0011` down drops the
  four slice-6 tables; `0012` down drops the three EXCLUDE constraints; `0015`/
  `0016` down drop their indexes/invariant — rehearsed; `0017`–`0032` down are
  rehearsed — see the slice-8 bullet, the slice-9/10, row-11, row-12,
  DEC-072–076, price-version, `DEC-078`, `DEC-079`, `DEC-080` and `DEC-081`
  bullets
  above). While the
  database is
  empty the tested recovery is `DROP SCHEMA public CASCADE; DROP SCHEMA drizzle
CASCADE; CREATE SCHEMA public; npm run db:migrate` (see the runbook). Once data
  exists, migrations must be additive (expand → migrate → contract) with a tested
  data-preserving down path (see `AGENTS.md` Rule 2).
- External writes require a documented rollback and per-source approval
  (`DEC-015`).

## Work log (append-only, newest first)

### 2026-09-21 — DEC-081 accepted and implemented (import_profile table 0031 + org-coherence guard 0032); handoff updated

`main` HEAD `cb3aff5`; the working tree holds only this handoff update — the
next commit (nothing pushed; nothing applied to DigitalOcean); the tree was
clean at `cb3aff5` before this docs edit. **5 commits** this slice:
`2997587` docs(decisions) accept `DEC-081`; `f4a8110` feat(persistence)
`import_profile` table (migration `0031`) + org-coherence guard (`0032`);
`e9ec176` feat(imports) resolve a run's import profile by source; `1914795`
feat(web) profile-aware import creation and seed; `cb3aff5` docs(runbook)
document migrations `0031`/`0032`.

- **Delivered (`DEC-081`):** `import_profile` keyed
  `(organization_id, source)` (unique) carrying `profile_version`,
  `posting_policy` (default `allow_partial`, checked against
  `import_posting_policy`) and `validation_rules` jsonb (checked to be a jsonb
  object), plus a nullable `import_run.import_profile_id` FK (legacy runs keep
  null, no backfill). `createImportRun` resolves the source's profile inside
  the transaction (the profile supplies the version and policy; a conflicting
  caller-supplied policy/version is rejected; a source with no profile keeps
  `DEC-025` behaviour). `validateImportRun` resolves the run's profile rules
  through a fail-closed `parseImportValidationRules` and merges explicit caller
  rules over them field-by-field. `ImportStore` gained `findImportProfile`/
  `createImportProfile` (Postgres adapter + fakes); values are trimmed
  consistently. Migration `0031` (generated, additive) with a rehearsed
  unjournaled down; migration `0032` (hand-written) adds the
  `import_run_profile_org_guard` `BEFORE INSERT OR UPDATE` trigger enforcing
  `import_run.organization_id` coherence with the profile (the `DEC-079`
  precedent), with its own rehearsed unjournaled down. Web: the create-run
  body's `profileVersion` is optional; the seed ensures the `zettle-legacy`
  profile idempotently; the run detail page and new-run form describe the
  profile-resolved version/policy.
- **Reviews and reconciliation.** Three independent passes.
  `reviewer-qwen` — no blocker/major; **four minors accepted and applied**
  (consistent trimming between profile creation and run resolution;
  `parseImportValidationRules` trims list entries and rejects blanks; the
  `postingPolicy` conflict check trims; the missing-profile error names the
  profile id and organization). `reviewer-minimax` — no blocker; **one major
  accepted and applied** (the new run→profile FK needed the same
  cross-organization coherence guard `DEC-079` uses, hence migration `0032`);
  two minors **accepted** (the stale `IMPORT_POSTING_POLICY` persistence
  docstring fix; a `ponytail:` note for the deliberately absent reverse index)
  and two **declined** (adding the reverse-FK index now — no read path yet;
  re-framing the struck-through `sales.ts` open point — the `DEC-078`
  traceability convention). `reviewer-glm` final pass — no blocker/major; two
  minors **declined** (the untrimmed `fileHash` replay guard is pre-existing at
  the baseline; a caller-supplied `expectedCurrency: ""` is boundary-level and
  normalised by the HTTP layer).
- **Verification at `cb3aff5` (exact):** `typecheck`, `lint`, `build`,
  `format:check` clean; **1353/1353 tests with `DATABASE_URL`** (135 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0032` is a no-op on
  re-run; both new down paths rehearsed; **66 tables**; every new read/write
  organization-scoped (`DEC-061`).
- **Resume task:** enforce the import profile's posting policy in
  `postImportRun` (`DEC-025`) — the policy is stored but never read, so
  `all_or_nothing` behaves exactly like `allow_partial`; TECH-owned — see
  "Resume here". A dev server was running at http://localhost:3000
  (owner/LocalDevPass123, MFA disabled for `owner`, demo-seeded including the
  `zettle-legacy` `import_profile`); a fresh session must restart it
  (session-scoped).

Rollback: each of the five commits is independently `git revert`-able (revert
the web/application commits before persistence if reverting a cohort);
migrations `0031`/`0032` are additive with rehearsed **unjournaled** down paths
(`0031` down drops `import_run.import_profile_id` first then `import_profile`;
`0032` down drops the trigger and function); no data migration; nothing pushed;
nothing applied to DigitalOcean.

### 2026-09-21 — DEC-080 accepted and implemented (migration 0030, `data_quality_exception` + transfer-discrepancy producer); handoff updated

`main` HEAD `ddc9e06`; the working tree holds only this handoff update — the
next commit (nothing pushed; nothing applied to DigitalOcean). **3 commits**
this slice: `40b5d7e` docs(decisions) accept `DEC-080`; `d1d0fad`
feat(persistence) `data_quality_exception` table (migration `0030`); `ddc9e06`
feat(transfers) record a data-quality exception on receive discrepancy.

- **Delivered (`DEC-080`, DQ-001):** the `data_quality_exception` table
  (`rule_code`, `severity ∈ {low, medium, high, critical}` default
  `medium`, `entity_type`/`entity_id` polymorphic, `detected_at`,
  `owner_id`, `due_date`, `status ∈ {open, acknowledged, resolved,
dismissed}` default `open`, `resolution`); repository
  create/find/list/update; and the first producer —
  `receiveStockTransfer` creates a `transfer_discrepancy` exception
  (severity `high`, entity `stock_transfer`, status `open`) in the same
  transaction as the receive, alongside the human `discrepancy_note`.
  Migration `0030` is additive with a rehearsed down path.
- **Review and reconciliation.** One cheap code-level pass (`reviewer-glm`)
  — no blockers or majors. **Declined with reasons (all four minors):** the
  id-only `updateDataQualityException` (matches the `updateStockCount`
  convention); the application mapping dropping audit columns (no consumer
  needs them); the record fields typed `string` (like the other tables); a
  dead savepoint in one rollback test (harmless).
- **Verification at `ddc9e06` (exact):** `format:check`, `typecheck`, `lint`,
  `build` clean; **1305/1305 tests with `DATABASE_URL`** (134 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0030` is a no-op on
  re-run; the `0030` down path rehearsed; **65 tables**; every new
  read/write organization-scoped (`DEC-061`).
- **Resume task:** the **import-profile table** — the row-11 open point
  (`import_run.source`/`profile_version` are opaque labels), keyed by
  `(organization_id, source)`, recorded from `DEC-081` if needed — see
  "Resume here". A dev server was running at http://localhost:3000
  (owner/LocalDevPass123, demo-seeded); a fresh session must restart it
  (session-scoped).

Rollback: each commit is independently `git revert`-able; migration `0030`
is additive (a new table; no data migration) with a rehearsed **unjournaled**
down path (drop the table, delete the ledger row, re-migrate); nothing
pushed; nothing applied to DigitalOcean.

### 2026-09-21 — DEC-079 accepted and implemented (migration 0029, cross-organization coherence guards); handoff updated

`main` HEAD `9d0e055`; the working tree holds only this handoff update — the
next commit (nothing pushed; nothing applied to DigitalOcean). **2 commits**
this slice: `8376209` docs(decisions) accept `DEC-079`; `9d0e055`
feat(persistence) cross-organization coherence guards (migration `0029`).

- **Delivered (`DEC-079`, closing `DEC-054`):** cross-organization coherence
  for `recipe_allergen.allergen_id`, `recipe_line.item_id`/`sub_recipe_id`
  and `goods_receipt_line.supplier_item_id` is enforced by
  `BEFORE INSERT OR UPDATE` guard triggers (the `stock_movement_source_guard`
  precedent), not denormalized composite FKs plus a backfill; the
  receipt-line guard also enforces the supplier and item match;
  `goods_receipt_line.supplier_item_id` got its deferred single-column FK
  (`NOT VALID` → `VALIDATE`). Migration `0029` is hand-written/journaled,
  forward-only, with a rehearsed unjournaled down path.
- **Review and reconciliation.** One structural pass (`reviewer-minimax`) —
  no blockers or majors. **Accepted and applied:** the five test-coverage
  gaps — UPDATE-repoint of `recipe_version_id`/`goods_receipt_id` on the
  three guarded tables, the `DEC-047` store-fallback accept path, and a
  unit-mismatch negative assertion. **Declined with reasons:** the cosmetic
  `FOUND` note, the no-op-UPDATE performance note, the `recipe_line` XOR
  invariant (a separate application-owned concern) and the `CREATE TRIGGER`
  non-idempotency note (covered by the down companion + ledger discipline).
- **Verification at `9d0e055` (exact):** `format:check`, `typecheck`, `lint`,
  `build` clean; **1297/1297 tests with `DATABASE_URL`** (133 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0029` is a no-op on
  re-run; the `0029` down path rehearsed; **64 tables**; every new
  read/write organization-scoped (`DEC-061`).
- **Resume task:** the `data_quality_exception` table (`DEC-066`'s interim
  replacement for `stock_transfer.discrepancy_note`; also the natural home
  for count-variance and yield-variance exceptions), then the import-profile
  table if time remains — see "Resume here". A dev server was running at
  http://localhost:3000 (owner/LocalDevPass123, demo-seeded); a fresh
  session must restart it (session-scoped).

Rollback: each commit is independently `git revert`-able; migration `0029` is
hand-written/journaled, forward-only, with a rehearsed **unjournaled** down
path (drop the guard triggers/functions and the FK, delete the ledger row,
re-migrate); no data migration; nothing pushed; nothing applied to
DigitalOcean.

### 2026-09-21 — DEC-078 accepted and implemented (migration 0028, lotTracked, scope_type validation); handoff updated

`main` HEAD `a5c3db2`; the working tree holds only this handoff update — the
next commit (nothing pushed; nothing applied to DigitalOcean). **4 commits**
this slice: `3673633` docs(decisions) accept `DEC-078`; `ed93288`
feat(persistence) settlement/reconciliation vocabularies (migration `0028`);
`39d3364` feat(inventory) enforce `lotTracked` on stock movements; `a5c3db2`
feat(reconciliation) validate `scope_type` against the `DEC-078` vocabulary.

- **Delivered (`DEC-078`):** `settlement.status` constrained to `{received,
paid, void}` (default `received`); `reconciliation.scope_type` constrained
  to a new `reconciliation_scope_type` `{import_run, sales_source,
settlement, supplier_invoice}` (migration `0028`, check constraints
  `settlement_status_check`/`reconciliation_scope_type_check`) with
  `assertReconciliationScopeType` rejecting an unknown scope before any
  write; and a `lotTracked` item may no longer post a stock movement with a
  null `lotId` (one guard in `postStockMovementInternal`, covering all
  posting paths; the reversal stays exempt because it mirrors the original
  lot).
- **Review and reconciliation.** One cheap code-level pass (`reviewer-glm`)
  — no blockers or majors. **Accepted and applied:** one minor — the two
  unknown-scope rejection tests were strengthened with a message assertion.
  **Declined with reasons:** the runbook-rehearsal note (the `0028` down
  path was genuinely rehearsed by the implementing agent) and the
  vocabulary-alias note (the implementation matches the existing
  `imports/vocabularies.ts` alias convention).
- **Verification at `a5c3db2` (exact):** `format:check`, `typecheck`, `lint`,
  `build` clean; **1279/1279 tests with `DATABASE_URL`** (132 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0028` is a no-op on
  re-run; the `0028` down path rehearsed; **64 tables**; every new
  read/write organization-scoped (`DEC-061`).
- **Resume task:** the cross-organization referential-integrity /
  deferred-FK hardening (`DEC-054` recipe FKs + the `goods_receipt_line`
  composite FKs, `NOT VALID` → `VALIDATE`, migration `0029`+) — see
  "Resume here". A dev server was running at http://localhost:3000
  (owner/LocalDevPass123, demo-seeded); a fresh session must restart it
  (session-scoped).

Rollback: each commit is independently `git revert`-able; migration `0028` is
additive with a rehearsed unjournaled down path (drop the check constraints
and column default, delete the ledger row, re-migrate); no data migration;
nothing pushed; nothing applied to DigitalOcean.

### 2026-09-21 — Price-version slice delivered (DEC-064/DEC-077, migration 0027); handoff updated

`main` HEAD `80bbe1c`; the working tree holds only this handoff update — the
next commit (nothing pushed; nothing applied to DigitalOcean). **5 commits**
this slice: `4e755a0` docs(decisions) accept `DEC-077`; `e94dfe1` feat(domain)
price-version effective-window helpers; `414832b` feat(persistence)
`price_version` (migration `0027`) + repository incl. the approval CAS;
`e2bd2b1` feat(application) price-version approval and reads
(`DEC-064`/`DEC-077`); `80bbe1c` feat(web) price-version approval action and
versions screen.

- **Delivered:** the price-version slice (`DEC-064`, `DEC-077`, PRICE-002/003)
  — the `price_version` table (half-open `[effective_from, effective_to)`,
  non-overlapping per `(organization_id, product_variant_id, location_id,
channel_id)` via a hand-written EXCLUDE with a COALESCE sentinel so a null
  location/channel is a single "any" scope); `approvePriceScenario` creates an
  effective version for the scenario's scope in the same transaction, rejects
  a null price and an overlapping window, and uses the compare-and-swap
  `approvePriceScenarioIfApprovable` state transition so a concurrent approval
  cannot double-create; only an approved scenario yields a version
  (PRICE-003); application reads `listPriceVersions`/`getPriceVersion`; web
  approve route + price-versions API + Costs UI approval action and
  Price-versions screen.
- **Adversarial reviews and reconciliation.** Two independent passes:
  `reviewer-qwen` and `reviewer-minimax`. **Accepted and applied:** the
  concurrent-approval race (fixed with the CAS;
  `approvePriceScenarioIfApprovable` + regression tests). **Declined as
  consistent-with-convention or legitimate:** the persistence-finder
  org-scoping (matches `findCostCard`; the application guards the org) and the
  "zero price allowed" note (free/zero-price items are legitimate per
  `DEC-043`). `reviewer-minimax` reported no findings (the EXCLUDE with the
  COALESCE sentinel verified correct, migration/journal/snapshot consistent,
  schema drift none).
- **Verification at `80bbe1c` (exact):** `format:check`, `typecheck`, `lint`,
  `build` clean; **1269/1269 tests with `DATABASE_URL`** (132 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0027` is a no-op on
  re-run; the `0027` down path rehearsed; **64 tables**; every new
  read/write organization-scoped (`DEC-061`).
- **Resume task:** `DEC-078` — the `settlement.status` /
  `reconciliation.scope_type` vocabularies + `lotTracked` enforcement, then
  the receipt→ledger wiring if the OPS policy lands — see "Resume here". A
  dev server was running at http://localhost:3000
  (owner/LocalDevPass123, demo-seeded); a fresh session must restart it
  (session-scoped).

Rollback: each commit is independently `git revert`-able; migration `0027` is
additive with a rehearsed unjournaled down path (drop the constraint and the
table, delete the ledger row, re-migrate); no data migration; nothing pushed;
nothing applied to DigitalOcean.

### 2026-09-20 — DEC-072–076 accepted and implemented; low-risk open points closed; handoff updated

`main` HEAD `c0b0d77`; the working tree holds only this handoff update — the
seventh commit of the session (nothing pushed; nothing applied to
DigitalOcean). **7 commits** since the previous session baseline `bcb625a`:
`aaec400` docs(decisions) accept `DEC-072`–`DEC-076`; `dcec861` chore(lint)
ignore Agent Manager worktrees under `.kilo/`; `44eb93a` feat(domain) typed
`NotFoundError` + `toleranceAmount`; `6ff5881` feat(persistence)
`reconciliation_tolerance` (0024) + `MAPPING_STATE` `conflict` (0025) +
`sales_line_reversal_of_id_key` (0026); `301c381` feat(application)
effective-dated tolerance resolution + mapping conflict + `reverseSalesLine` +
typed recipe 404s; `c0b0d77` feat(web) recipe 404s by `NotFoundError` +
`conflict` label; plus this docs commit.

- **Delivered:** five accepted decisions and their low-risk implementations.
  `DEC-072` the effective-dated `reconciliation_tolerance` table (migration
  `0024`), tolerance = `max(rate × |expected|, floor_amount)`, precedence:
  explicit override → effective config at period end → explicit `DEC-026`
  default opt-in → block close (`reconciliation.tolerance` stays the per-row
  snapshot); `DEC-073` `reverseSalesLine` — a new negated `sales_line` in the
  same transaction with `reversal_of_id`, a mandatory reason and no stock
  posting, race-safe via `sales_line_reversal_of_id_key` (0026); `DEC-074`
  `MAPPING_STATE` gains `conflict` (0025) — `DEC-033` conflicts write
  `conflict` with `error_code=mapping_conflict` retained; `DEC-075`
  `tax_rule_id` is canonical and `applied_tax_rate` is the source-reported
  applied rate (docs-only); `DEC-076` the typed `NotFoundError` replaces the
  `/not found/i` match in the recipe page + GET/POST routes.
- **Adversarial reviews and reconciliation.** Two independent passes:
  `reviewer-qwen` and `reviewer-minimax`. **Accepted and applied:** the
  sales-line reversal race fix (`sales_line_reversal_of_id_key`, 0026) and the
  runbook lock-name/preflight fixes. **Declined as false positives (with
  evidence):** the "EXCLUDE misses open-ended windows" claim (empirically the
  constraint rejects two `effective_to IS NULL` rows) and the "rate silently
  truncated" claim (`parseDecimal` throws on extra precision); the `DEC-076`
  scope-expansion claim was declined (the decision is scoped to the recipe
  routes).
- **Verification at `c0b0d77` (exact):** `format:check`, `typecheck`, `lint`,
  `build` clean; **1214/1214 tests with `DATABASE_URL`** (128 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0026` is a no-op on
  re-run; migrations `0024`–`0026` down paths rehearsed; **63 tables**; every
  new read/write organization-scoped (`DEC-061`).
- **Resume task:** the price-version slice (`DEC-064`, PRICE-002/003) — see
  "Resume here". A dev server was running at http://localhost:3000
  (owner/LocalDevPass123, demo-seeded); a fresh session must restart it
  (session-scoped).

Rollback: each commit is independently `git revert`-able; migrations `0024`–
`0026` are additive with rehearsed down paths (`0024` down drops the table +
EXCLUDE constraint; `0025` down restores the four-value checks — it fails if
`conflict` rows exist, preflight documented; `0026` down drops the partial
unique index); the eslint-ignore change and the docs commits are trivial
reverts; no data migration; nothing pushed; nothing applied to DigitalOcean.

### 2026-09-20 — Rows 11–12 committed; session paused at a clean point; handoff updated

`main` HEAD `77d913e`; the working tree is **clean**; **17 commits** landed since
the previous session baseline `f7b1db7`; nothing pushed; nothing applied to
DigitalOcean. Recent order: `77d913e` docs (row 12), `2104068` feat(sales) row
12, `c324418` docs(adr) accept ADR-0007/0008, `0ac9667` docs (row 11),
`a02719f` fix(web) DomainError messages, `501df54` feat(imports) row 11,
`7f6aa78` feat(web) inventory sub-links, `081b5f4` docs(runbook) 0020/0021,
`9b240bc` docs, `6fc533c` feat(production) web, `8a8ef7e` feat(stock-ops)
slice 9 + slice 10 backend, `2a5799e` docs, `6c69f7f` feat(web) design
system/screens, `c91e512` feat(application), `40e736b` feat(domain),
`b525f30` feat(persistence), `583da3f` feat(infra).

- **Delivered and committed:** slices 8 (stock ledger), 9 (counts/transfers/
  waste), 10 (production planning + batches incl. web), row 11 (import
  framework + external mappings), row 12 (sales + settlements + reconciliation
  - theoretical consumption); the Aquarela design system, app shell and all
    product screens; migrations `0017`–`0023`; decisions `DEC-066`–`DEC-071`;
    `ADR-0007`/`ADR-0008` accepted 2026-09-20 (owner-delegated, revertible;
    `c324418`). Cross-cutting fixes: `jsonError`/`mapErrors` `DomainError`
    messages, the 404-for-non-UUID route-param guard, the inventory sub-links
    and the `sales_line` source-guard test fix.
- **Verification at `77d913e` (exact):** `typecheck`, `lint`, `build`,
  `format:check` clean; **1186/1186 tests with `DATABASE_URL`** (127 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0023` is a no-op on re-run;
  every migration down path (`0017`–`0023`) rehearsed; **62 tables**.
- **Paused at a clean point** per the global ruleset: everything committed and
  verified; above USD 20 the session is permitted to pause here only at a
  clean point — this is one.
- **Resume task:** resolve the recorded open owner questions as decisions from
  `DEC-072` and implement the low-risk ones (tolerance-config table `DEC-026`;
  sales-line reversal `DEC-028`; typed not-found error replacing the
  `/not found/i` matching; `MAPPING_STATE` `conflict`; the `tax_rule_id`/
  `applied_tax_rate` naming) — see "Resume here". A dev server was running at
  http://localhost:3000 (owner/LocalDevPass123, demo-seeded); a fresh session
  must restart it (session-scoped).

Rollback: everything is committed — `git revert <sha>` per commit; migrations
`0017`–`0023` are additive with rehearsed down paths.

### 2026-09-20 — Row 12 (sales + settlements + reconciliation) complete (uncommitted); handoff updated

`main` HEAD `c324418` (the ADR-acceptance commit — `ADR-0007` and `ADR-0008`
accepted 2026-09-20, owner-delegated, revertible); the working tree holds
uncommitted **row 12** work plus this handoff update — about to be committed
(nothing pushed; nothing applied to DigitalOcean). No handoff/code file outside
`CONTEXT.md` and `docs/BUILD_ROADMAP.md` was touched by this update.

- **Row 12 — complete.** Migration `0023` (tables `sales_transaction`,
  `sales_line`, `settlement`, `reconciliation`; the `sales_line` branch added
  to the `stock_movement_source_guard`), vocabularies
  `RECONCILIATION_STATUS`/`OPTION_KIND`, domain
  `packages/domain/src/sales-consumption.ts` (recipe explosion + the `DEC-026`
  tolerance evaluator), application `packages/application/src/sales/**`
  (`postImportRun`, `postTheoreticalConsumption`, list/get) and
  `packages/application/src/reconciliation/**` (`reconcileImportRun`,
  `reconcileSettlement`, `resolveReconciliation`, list, `resolveTolerance`),
  web `/api/v1/sales/**` and `/api/v1/reconciliations/**` plus the
  `(app)/sales/**` screens (landing, transactions list/detail, reconciliation
  with resolve), and `apps/web/scripts/seed-sales.ts`. A pre-existing inventory
  test that posted a `sales_line` movement with a fake source id was fixed
  (the new guard correctly rejects it).
- **Roadmap position.** Row 12 `done (uncommitted)` in `docs/BUILD_ROADMAP.md`
  §4; row 13 is now only **data-gated** on history/grain quality (I11); row 14
  is owner-gated on the privacy review / access matrix; rows 15–18 remain
  blocked (data / `ADR-0009`–`0011`) — **no roadmap slice is buildable purely
  from code** without owner inputs or real history. Next unblocked task:
  resolve the recorded open owner questions as decisions (`DEC-072`+) and
  implement the low-risk ones — e.g. a tolerance-configuration table
  (`DEC-026` effective-dated config), sales-line reversal semantics
  (`DEC-028`), a typed not-found error replacing the brittle `/not found/i`
  matching in `recipes/[id]`/`recipes/[id]/versions`, a `MAPPING_STATE`
  `conflict` value, and the `tax_rule_id`/`applied_tax_rate` naming question;
  next free decision id `DEC-072`.
- **Open points recorded, not decided** (see "Open decisions / inputs" and
  `docs/BUILD_ROADMAP.md` §5 "Row-12 sales/reconciliation open points"):
  consumption grain A1 (`DEC-009` daily-per-location vs a single `sales_line`
  source); no tolerance-config table (`DEC-026` hardcoded); `tax_code_id` vs
  `tax_rule_id` + `applied_tax_rate` authority (A4); `DEC-028` sales-line
  reversal not implemented; `settlement.status` and
  `reconciliation.scope_type` have no vocabulary; the `sales_line`-guard test
  fix; the legacy I19 import carries no resolvable `location_id` (the demo
  theoretical consumption posts zero recipe-bearing lines); a local dev-DB
  side effect (the demo import run left `partially_posted` and a
  reconciliation reopened to `pending`).
- **Verification (exact, at the current working tree):** `typecheck`, `lint`,
  `build`, `format:check` clean; **1186/1186 tests with `DATABASE_URL`**
  (127 files); `npm audit --omit=dev` 0; `db:migrate` through `0023` is a
  no-op; the `0023` down path was rehearsed.

Rollback: the row-12 work is uncommitted — `git checkout -- <paths>` / discard
the tree (or `git revert` the commit once it lands); migration `0023` is
additive with a rehearsed down path. Next: commit row 12, then the `DEC-072`+
decisions + low-risk implementations — see "Resume here".

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
