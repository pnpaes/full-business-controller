# 2026-09-24 — W7 complete: the UI-refinement wave (operations-completion programme)

`main`; HEAD **`f3adeb8`**, working tree clean. Seven commits on `main`
(`54022c7` … `01a9cda`, plus the review-fix commit `f3adeb8`), **all
unpushed**; nothing applied to DigitalOcean.
This is the W7 wave of the operations-completion programme
(`docs/ROADMAP-OPERATIONS-COMPLETION.md` §3 W7): making every section
reachable and every recorded action present, purging stale "not wired /
planned" copy, replacing hard-coded styling with the design tokens, and
enforcing **WCAG 2.2 AA** plus **375px mobile behaviour** across every
screen. It follows the `DEC-120` redesign (tokens, primitives, shell,
management home), the `DEC-121` wiring of the unwired sections and the
`DEC-122` task workflow — those waves and their decisions are the authority
of their own recorded rows and earlier handoff material; **this handoff
covers the refinement wave only**, and the wave added **no new decision**
(next free decision id **`DEC-129`**). Verification at HEAD (Node 22):
`typecheck`, `lint`, `format:check`, `build` clean; **4276/4276 tests with
`DATABASE_URL` (294 files)**; `db:migrate` a **no-op** — **no schema change,
no new migration** (migrations remain through `0066`; **93 public tables**).

- **Commits (chronological).**
  1. `54022c7` `feat(web): reconcile import runs and settlements from the
     sales screen` — group 1 (sales + purchasing), 9 files. New
     `apps/web/app/(app)/sales/reconciliation/reconcile-form.tsx` closes the
     gap where `POST /api/v1/reconciliations/import-runs/[id]` and
     `POST /api/v1/reconciliations/settlements` had routes but no UI caller;
     the `DEC-026` default tolerance must be chosen explicitly and is never
     applied silently. Stale "slice 11 never posts" copy removed; token
     conformance.
  2. `5227552` `feat(web): authoring forms for costing master data, inventory
     refinement` — group 3 (inventory + costs), 10 files. Four new forms
     over routes that already existed: operating costs, labour rates, cost
     pools, allocation rules — the latter on the closed
     `ALLOCATION_DRIVER`/`SCOPE_TYPE`/`ALLOCATION_DENOMINATOR_SOURCE`/
     `ALLOCATION_FALLBACK` vocabularies. Cost-centre selects list only centres
     already referenced by the org's costing facts (no list service exists)
     and an empty org gets an honest "seed the demo data first" notice.
  3. `f3201ff` `feat(web): workforce, HMS and document authoring actions,
     tokenise the rest` — group 4 (hms, workforce, close, tasks,
     administration, documents, insights, account, styleguide), 16 files.
     New forms over existing routes: workforce shift-hour adjustment
     (`POST /api/v1/workforce/shift-assignments/[id]/adjustments`),
     employee-document amendment (`PATCH /api/v1/workforce/employee-documents/[id]`),
     HMS equipment amendment (`PATCH /api/v1/hms/equipment/[id]`). Stale
     "amending an existing item is API-only for now" copy and two dead
     styleguide buttons removed.
  4. `733ee83` `fix(web): address the W7 refinement review findings` — 7 files.
  5. `c202c39` `fix(web): correct two overstated "no backend" claims` — 2 files.
  6. `01a9cda` `feat(web): create recipe versions, replace raw-id fields with
      pickers` — group 2 (products, recipes, production), 9 files.
  7. `f3adeb8` `fix(web): resolve the six findings from the W7 review` —
     see the four-track review below.
- **The group-2 known gap is closed (`01a9cda`).** New
  `apps/web/app/(app)/recipes/[recipeId]/register-version-form.tsx` posts to
  the existing `POST /api/v1/recipes/[id]/versions` route and calls the
  existing `registerRecipeVersion` command — **no route or service was
  invented**. It collects the version number (defaulting to latest+1), the
  state with an approver required for approved, planned input/output and
  approved-usable output with **yield left derived**, the effective window,
  preparation minutes, the method (the `DEC-123` nullable column), notes,
  dynamic lines, dynamic allergen declarations with a verifier for verified
  ones, the `DEC-123` `sourceRecipeTestId` link, and the optional `DEC-112`
  labour mapping using the real `ROLE_CODE` vocabulary. Two limitations are
  stated **in the form rather than worked around**: there is **no
  unit-catalogue read service anywhere** (a line's unit is the component's
  base unit, resolved server-side; other units stay API-only), and there is
  **no cost-centre list read** (the `DEC-112` cost centre is a stated
  paste-the-id field). Raw-UUID input fields became real item pickers in
  `recipes/new-recipe-form` and `products/sellables/register-variant-form`;
  `sellables/[variantId]` shows code and name instead of a UUID.
- **Verified as already wired and left unchanged:** recipe tests (`DEC-123`),
  production batch costing and variance (`DEC-124`), plan lines and
  `planned_qty` (`DEC-125`), product/variant identity, recipe assignment and
  add-on applicability (`DEC-128`).
- **Review (`733ee83`).** Two independent reviewers (`reviewer-qwen`
  adversarial, `reviewer-glm` code-level) found **no blockers and no majors**,
  only minor items — all accepted: the reconcile tolerance field is now
  **disabled while the `DEC-026` default checkbox is ticked** (it was
  previously silently discarded); the shift-adjustment Reason field uses the
  shared `TextField` instead of a hand-rolled input; the equipment checkbox
  uses the existing `CheckboxField` primitive; an employee-document card
  shows the employee name instead of a truncated UUID; a duplicated currency
  trim guard collapsed; money inputs use `step=0.0001` to match
  `MONEY_SCALE = 4`. **Declined with reason:** adding an `opacity` scale to
  `packages/ui/src/tokens.ts` for a single value — the three inline
  `opacity: 0.8` values sit on static explanatory paragraphs, not disabled
  controls, so none was redundant.
- **Honesty sweep (`c202c39`).** A read-only breadth sweep found two
  dishonest-but-pessimistic claims, both corrected (behaviour unchanged):
  the administration audit entry claimed no audit event service exists when
  `packages/application/src/auth/audit.ts` **does** write audit events (what
  is missing is a read/list service and screen), and the HMS incident
  owner-assignment notice claimed no service lists candidate users when
  `packages/application/src/tasks/list-assignable-users.ts` exports
  `listAssignableUsers`. (The breadth sweep was run on `reviewer-qwen`; see
  the process facts below.)
- **Four-track review and follow-up fixes (`f3adeb8`).** After the six wave
  commits, a four-track review of the range `e12116c..HEAD` (security,
  business logic, dead code, duplication; deploy safety and performance
  assessed directly by the coordinator) produced **six findings** — from the
  business-logic and duplication tracks only — all fixed in `f3adeb8`
  `fix(web): resolve the six findings from the W7 review` (5 files, all
  under `apps/web/app/(app)/**`; presentation and validation only; no
  route, command, vocabulary or business-rule change; nothing under
  `packages/**`; no test asserted any replaced string).
  - **Clean tracks.** Security: no findings — every new client gate was
    verified consistent with its route's own check at both layers
    (`HMS_EQUIPMENT_WRITE_ROLES` at
    `apps/web/app/api/v1/hms/equipment/[id]/route.ts`,
    `WORKED_HOURS_WRITE_ROLES` at
    `apps/web/app/api/v1/workforce/shift-assignments/[id]/adjustments/route.ts`,
    `WORKFORCE_EMPLOYEE_DOCUMENT_WRITE_ROLES` at
    `apps/web/app/api/v1/workforce/employee-documents/[id]/route.ts`), and
    no injection, data-exposure or identifier-handling issue was found.
    Dead code: no findings — every export, prop, state setter, option list
    and helper the wave added has a live consumer. Deploy safety: clean —
    no migration, backfill, schema change or query over historical data
    (the only new database work is bounded `limit: 100` reads on page
    render). Performance: clean.
  - **The six findings, fixed in `f3adeb8`.**
    1. `apps/web/app/(app)/costs/labor-rates/register-labor-rate-form.tsx` —
       the shared `pctField` helper rendered `unit="%"`, but all four
       percentage inputs take a **fraction in `[0,1]`**:
       `packages/domain/src/labour.ts` `computeLoadedHourlyRate` runs each
       through `parsePercentage`, which rejects anything outside `[0,1]`
       (its tests prove `feriepengerPct: "1.5"` throws), and
       `packages/application/src/costing/register-labor-rate.ts` requires
       `productiveHoursPct` in `(0,1]`. An operator who followed the unit
       and the "Leave empty for 100%" help and typed `80` always got a
       rejection. The unit is removed, every field now states the fraction,
       and the payload is unchanged.
    2. `apps/web/app/(app)/sales/reconciliation/page.tsx` and
       `reconcile-form.tsx` — `reconcileSettlement` rejects a settlement
       with `paidAmount === null` unconditionally, but the page offered
       **every** settlement and the form's default target fell back to the
       first one when no posted run existed, so with no posted run the form
       opened on a target that could never succeed. Null-paid settlements
       are now excluded, the form's option type is narrowed from
       `string | null` to `string`, the now-unreachable branch is deleted,
       and a page `Alert` states how many settlements were excluded and
       why.
    3. `apps/web/app/(app)/recipes/[recipeId]/register-version-form.tsx` —
       the success path cleared everything except `state` and `approvedBy`
       while auto-incrementing the version number, so the invited follow-up
       submission was silently an **approved** version carrying the
       previous approver. It now resets `state` to `draft`, clears the
       approver, and clears the `DEC-112` labour mapping — which
       `registerRecipeVersion` persists per version, so it is not reusable.
    4. `apps/web/app/(app)/recipes/[recipeId]/register-version-form.tsx` —
       quantity validation used a regex plus `Number()` float comparisons
       in a decimal-only codebase, so a value such as
       `1.0000000000000000001` compared equal to `1` as a float, passed the
       client's yield gate, and failed server-side. It now uses
       `parseDecimal`/`QUANTITY_SCALE` exactly as the sibling
       `apps/web/app/(app)/purchasing/record-receipt-form.tsx` does, with
       the `approvedUsableOutput <= plannedInputQty` comparison done in
       bigint.
    5. `apps/web/app/(app)/costs/operating-costs/register-operating-cost-form.tsx`
       — the currency field initialised to a client-side `currency ??
       "NOK"` fallback and omitted the field when cleared, so clearing it
       silently recorded the cost in NOK. It now initialises only from the
       page-supplied currency and the help text states the server's default
       explicitly, so an empty field is a stated choice rather than a
       silent one.
    6. `apps/web/app/(app)/costs/labor-rates/register-labor-rate-form.tsx` —
       the screen labelled the rate with a currency the command never
       stores (`currencyLabel = currency ?? "NOK"`). The unit is now
       rendered only when the page supplies a currency, and the help states
       that the rate is stored without one when it does not.
  - **Open item this leaves:** the two costing forms built in this wave
    take **opposite stances on currency** — `register-operating-cost-form`
    sends an editable currency per record, while `register-labor-rate-form`
    displays one it never persists (the labour-rate record has no currency
    column). `f3adeb8` only made each screen honest about what it stores;
    reconciling the two stances needs a recorded decision (see
    `CONTEXT.md` → "Open decisions / inputs"), and it should be taken
    before any multi-currency work.
  - **Process fact:** the `security` subagent was pinned to
    `kilo/inclusionai/ling-3.0-flash-vl:free`, which no longer resolves, so
    the security track failed on its first attempt;
    `~/.config/kilo/kilo.jsonc` now pins `security` to
    `opencode-go/qwen3.7-plus`. This is the second agent found pinned to
    that dead model id (after `reviewer-ling`) — **a reader of
    `12_OPEN_DECISIONS.md` or this handoff should not assume other agent
    pins are live.**
  - **Review verification at `f3adeb8`:** `typecheck`, `lint`,
    `format:check` and `build` (unique `NEXT_DIST_DIR`, normalised
    afterwards) clean;
    `DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela npm
    run test` → **4276/4276 tests (294 files)**. No schema change, no new
    migration (still through `0066`), `db:migrate` a no-op. Nothing pushed.
  - **Rollback:** `f3adeb8` is presentation and validation only and reverts
    independently of the six wave commits; reverting it restores the six
    defects described above.
- **Process facts (recorded so the next session does not relearn them):**
  - One refinement agent (`ses_f2e5aa1c9ffe3L6fm01YxU9aZE`, group 2) ran for
    roughly three hours producing **zero** working-tree writes while
    reporting as busy; it was abandoned and its group re-run from scratch as
    commit `01a9cda`. **Check for writes, not just liveness, before waiting on a
    subagent.**
  - `apps/web/next-env.d.ts` and `apps/web/tsconfig.json` are **generated
    artifacts**: every `next build` / `next dev` rewrites them for whichever
    `NEXT_DIST_DIR` is in use (Next appends `<distDir>/types/**/*.ts` to
    `tsconfig.json`'s `include` and rewrites the `routes.d.ts` triple-slash
    reference in `next-env.d.ts`). Normalise with
    `git checkout -- apps/web/next-env.d.ts apps/web/tsconfig.json`
    before staging, or they pollute every diff.
  - The external free reviewer pin was **stale**:
    `kilo/inclusionai/ling-3.0-flash-vl:free` no longer resolves.
    `~/.config/kilo/kilo.jsonc` now pins `reviewer-ling` to
    `kilo/qwen/qwen3.8-27b:free` (verified genuinely free — `isFree: true`,
    prompt and completion pricing `0` on
    `https://api.kilo.ai/api/gateway/v1/models`) and raised its step limit
    from 25 to 40. The live free ling ids are
    `inclusionai/ling-3.0-flash-sante:free` and
    `inclusionai/ling-3.0-flash-fin:free`. **The free tier is rate-limited
    upstream** (two attempts failed with "temporarily rate-limited
    upstream") — treat the free reviewer as opportunistic only, never on the
    critical path.
  - Observed again: `packages/application/src/scheduling/scheduling.postgres.test.ts`
    can fail on an audit same-instant ordering assertion and passes on
    re-run. **Known flake, not a regression.**
  - **Single-owner files** (never two agents at once):
    `apps/web/app/(app)/shell-nav.tsx`, `apps/web/app/(app)/layout.tsx`,
    `packages/ui/**`, `12_OPEN_DECISIONS.md`, `CONTEXT.md`, the migration
    journal.
- **What remains open (state it plainly — the programme is not finished):**
  - `file_object` still has **no application port** (`DEC-085`/`DEC-099`,
    `ADR-0006`), so **all file bytes are metadata-only** across documents,
    employee documents, incident evidence, maintenance evidence and payroll
    export — the largest remaining honest gap, affecting the most screens.
  - The app-shell **search and scope placeholders in
    `apps/web/app/(app)/layout.tsx` are still unwired** (single-owner file).
  - **No unit-catalogue read service** exists anywhere → unit pickers are
    impossible and recipe lines are pinned to the component's base unit.
  - **No cost-centre list read** exists.
  - `calculatePriceScenario` exists in the application layer but has **no
    HTTP route** → no price-scenario creation UI is possible.
  - Incident **owner assignment** has no HMS-scoped user-list read (the
    tasks module's `listAssignableUsers` is not wired there).
  - **Administration** has no identity/configuration backend (users, roles,
    scopes, tax, units read, audit read, data-quality read, integrations).
  - Planning/forecast **tracking** has no backend; the insights card stays
    honest.
  - Standing items: per-process **rate limiter** needs a shared store;
    **reset-token delivery** is a no-op stub; `WF-003` self-assignment is
    deferred (`DEC-102`); the six golden fixtures remain **unsigned**; the
    `task`↔`approval` link is open; the worker/outbox layer is gated on
    `ADR-0004`.
- **Reversibility (Rule 2).** Pure web-layer code changes with **no migration,
  no schema change and no data written** (migrations stay through `0066`;
  **93 tables**): every commit reverts independently with
  `git revert <sha>`, and the layers have no migration ordering concern.
  Ordinary operator actions through the new forms append normal rows via the
  existing commands — not slice side effects. The one caveat is the
  generated-artifact normalisation above (not a rollback concern, a staging
  concern). Nothing pushed; nothing applied to DigitalOcean.
- **Next:** W7 close-out (the app-shell search/scope placeholders in
  `apps/web/app/(app)/layout.tsx` — wire or remove with the reason recorded)
  plus opening the **file-bytes workstream**: record the storage-port
  posture as `DEC-129` in `12_OPEN_DECISIONS.md` (both tables) and implement
  the `file_object` application port with a local adapter and an expand-only
  migration if the port needs schema, per `ADR-0006` and
  `DEC-085`/`DEC-099`. See `CONTEXT.md` → `Resume here (next session)` for
  the full executable brief.
