# ROADMAP-OPERATIONS-COMPLETION — the shared brief

The single knowledge-transfer document for the multi-agent programme that
completes the product as a full operations tool. Every implementing agent is
pointed at this file first.

- **Authority:** this file is a derived brief. The decisions in
  `12_OPEN_DECISIONS.md` (`DEC-001`…`DEC-128`), the ADRs in `docs/adr/` and the
  calculation contract (`docs/phase0/CALCULATION_CONTRACT.md`) govern. `CONTEXT.md`
  keeps the live orientation; `docs/BUILD_ROADMAP.md` the ordered slice backlog;
  `08_UI_UX.md` the interface rules; `11_REQUIREMENTS_CATALOG.md` the requirement
  ids; `docs/handoffs/` the per-slice archive. This document references them; it
  does not restate them.
- **Do not commit.** The orchestrator commits. Layers with a rollback note in the
  commit body (Rule 2).
- **Next free decision id:** `DEC-129` (check `12_OPEN_DECISIONS.md` live before claiming one).

## 1. Objective

Complete the product as a **compliant, capable operations tool**:

- every section of the information architecture reachable and wired;
- every action available and working end to end — a simple, fast workflow;
- realistic costs computed from actual production, not defaults;
- analytical and simulation capability for management decisions.

**Governing rule (non-negotiable):** the information architecture, features,
workflows and business logic are **preserved** (per `designer-agent-modern-saas-ui-brief.md`
and `08_UI_UX.md`). New capability is **additive** and recorded as a decision
(`DEC-1xx`) before or with the code. **Nothing is faked:** where a backend does
not exist it is either built properly or recorded as blocked with the reason —
never stubbed behind a working-looking UI.

## 2. Where we are (status, 2026-09-24 — post-W7)

Waves **W1–W7 are delivered** (`DEC-120` redesign, `DEC-121` wiring, `DEC-122`
task workflow, `DEC-123`–`DEC-128` close-outs; W7 completed as six commits
ending at HEAD `01a9cda` — see `docs/handoffs/080-2026-09-24-w7-ui-refinement-wave.md`).
Schema through migration `0066`, 93 tables; baseline 4276/4276 tests with
`DATABASE_URL` (294 files); detail in `CONTEXT.md` "Current status" and
`docs/handoffs/`. The programme's screens are complete and honest; what
remains is the enumerated honest-gap list below, **not** another wave.

| State | Content (remaining after W7) |
| --- | --- |
| **Delivered end to end** | Sales (import/transactions/reconciliation + reconcile forms), inventory, purchasing, production (plans/batches/costing/variance), products/variants + item pickers, recipes (incl. version registration and tests), costs (cost-cards, price versions, operating costs, allocation, labour rates, fee rules), Insights reports/menu-engineering/operations, `/close` register, Workforce/HMS/Documents screens, the `DEC-122` task workflow, Management home + shell on the design tokens |
| **Backend exists, honest gap in front** | `file_object` (no application port — **all file bytes metadata-only** across documents/employee documents/incident evidence/maintenance evidence/payroll export: the largest remaining gap); `calculatePriceScenario` (application layer exists, **no HTTP route** → no price-scenario creation UI); Administration (audit **write** exists via `packages/application/src/auth/audit.ts`, but no read/list service or screen); incident owner assignment (no HMS-scoped user-list read — the tasks module's `listAssignableUsers` is not wired there) |
| **No read/service at all** | Unit-catalogue read service (recipe lines pinned to the component's base unit); cost-centre list read (`DEC-112` cost centre stays paste-the-id); Administration identity/configuration backend (users, roles, scopes, tax, units read, data-quality read, integrations); planning/forecast **tracking** (the insights card stays honest) |
| **Standing infrastructure gaps** | App-shell search/scope placeholders in `apps/web/app/(app)/layout.tsx` (single-owner; the immediate next task); per-process rate limiter needs a shared store; reset-token delivery a no-op stub; `WF-003` self-assignment deferred (`DEC-102`); six golden fixtures unsigned; the `task`↔`approval` link open; worker/outbox gated on `ADR-0004` |

**Still-recorded blockers and deferred items (do not resolve silently):** the
`DEC-105`–`DEC-118` provisional/deferred clauses, the
`DEC-112`/`DEC-114` deferred close-outs, the receipt→ledger wiring gated on
the OPS destination `storage_area_id` policy, and rows 15–18 (blocked: data /
`ADR-0009`–`0011`). Full list in `CONTEXT.md` "Open decisions / inputs".

## 3. The workstreams

Each workstream states what already exists so agents do not rebuild it. Every
slice follows §4 Method and records its decision ids.

### W1 — Wiring (backend complete, UI missing)

- **Status (2026-09-24): DELIVERED** — the `DEC-121` wiring wave landed the
  Documents, HMS and Workforce screens; W7 verified them. The file-bytes gap
  (metadata-only listings) remains and opens the `DEC-129` workstream.

- **Objective:** every complete backend becomes a reachable, working screen.
- **Backend already exists:** document library (`/api/v1/documents/**`,
  `document_version`, `document_acknowledgement`); HMS (`/api/v1/hms/**` +
  compliance export); workforce (`/api/v1/workforce/**`: shifts,
  shift-assignments + adjustments, worked-hours, payroll-reports); employees +
  personnel documents.
- **Build:** screens + nav entries for Documents; HMS (monitoring log with fast
  reading entry, incidents, corrective actions, checklist runs, equipment,
  compliance export); Workforce (employees + personnel-document metadata),
  Shifts (create/publish/assign/complete/cancel/adjustments), Worked hours,
  Payroll reports + export. Screen content per `08_UI_UX.md` §8.3's Document
  library, Employee detail and HMS rows; role homes per §8.2.
- **Refs:** `DEC-088`–`DEC-093`, `DEC-099`–`DEC-104`; reqs `DOC-001…004`, `HMS-001…007`, `WF-001…007`.
- **Acceptance:** each listed capability has a nav entry reachable per its role
  matrix; every listed action (publish/version, begin/complete corrective
  action, template supersede, run a checklist, register a reading, log
  maintenance, publish shift, assign, adjust, generate payroll report) works
  end to end against the real API; access follows the recorded matrices; empty
  and error states are honest.
- **Dependencies:** payslips/do-something roles; the `file_object` blocker
  limits documents to metadata-only listings until the port slice lands — show
  what exists, do not fake upload.
- **In flight:** the Insights landing and the Document library wiring.

### W2 — Master-data authoring

- **Status (2026-09-24): DELIVERED** — W7 added the operating-cost, labour-rate,
  cost-pool and allocation-rule forms and replaced raw-UUID inputs with item
  pickers; recorded gaps (no unit-catalogue read, no cost-centre list read)
  are stated in the forms, not faked.

- **Objective:** simple, fast create/edit for all master data: products and
  variants, items and supplier items/prices, suppliers, locations and storage
  areas, channels, units and conversions, tax rules, labour rates, cost pools,
  allocation rules, equipment, employees.
- **Backend:** entity commands exist for most (`register*`/`update*` in
  `packages/application/src/**`); read them per entity before assuming a gap.
- **Build:** every list screen gains its create/edit action; every action is
  wired end to end (command → API route → form). Gap list to check explicitly —
  where no update service exists, record it (a `DEC-1xx` clause + a backlog
  row); **no application surface creates `location` rows** (a recorded gap);
  employees have no un-retire/delete by decision (`DEC-087`) — show retired,
  additive.
- **Refs:** `PROC-001…005/008`, `FND-003/003/007/009`, `PRICE-005`, `COST-004/006/007`, `DEC-021`, `DEC-041`, `DEC-044`.
- **Acceptance:** each entity above can be created (and edited where a writable
  command exists) through the UI by an authorized role; validation surfaces the
  real `DomainError`; `FND-008/009` SKU/taxonomy rules honoured; gaps recorded,
  not faked.
- **Dependencies:** none hard; `packages/ui/**` and `shell-nav.tsx` are
  single-owner (§5), so route authoring through that owner as a batch.

### W3 — Recipes (the recipe book)

- **Status (2026-09-24): DELIVERED** — recipe tests (`DEC-123`) and version
  registration (W7's `register-version-form.tsx` over the existing route and
  `registerRecipeVersion` command) delivered; unit and cost-centre reads
  remain missing and are stated in the form.

- **Objective:** a complete recipe book: full detail (ingredients with
  quantities and units, allergens, method, production time, yield), versioning,
  and **recipe tests**.
- **Backend:** `recipe`/`recipe_version` + `registerRecipeVersion`
  (`DEC-036`, slice 5), allergens per version, sub-recipes, the
  `labor_cost_center_id`/`labor_role_code` pair (`DEC-112`); no recipe-test
  entity exists.
- **Build:** the recipe detail/editor UI (version state, nested lines, yield,
  cost preview per `08_UI_UX.md` §8.3 "Recipe editor"); version navigation;
  a **test run** records the version tried, the date, the result (yield,
  time, cost, sensory comments) and the proposed adjustment, so improvements
  are proposed from evidence.
- **Record a `DEC-1xx`** for the `recipe_test` decision before/with the code: a
  new table (append-only, org-scoped, plain-uuid actor, `recipe_version_id` FK)
  is the default posture — decide the schema openly per the template in
  `12_OPEN_DECISIONS.md`.
- **Refs:** `COST-001/002`, `PROD-005`, `DEC-005/030/036`, slice-5 ambiguities in `docs/BUILD_ROADMAP.md` §5.
- **Acceptance:** a recipe's versions and full detail are browsable; a new
  version can be started and published per the existing state machine; a test
  run is recorded and listed with its proposed adjustments; yield remains
  derived-never-input.
- **Dependencies:** independent; benefits W4 (plans start from approved versions) and W6 (test evidence feeds suggestions).

### W4 — Production (plan → actual → realistic cost)

- **Status (2026-09-24): DELIVERED** — production batch costing and variance
  (`DEC-124`) and plan lines / `planned_qty` (`DEC-125`) delivered and
  verified wired in W7.

- **Objective:** dated plan → batch (quantities, expected yield/time); the
  **actual** production registered (actual in/out quantities, actual hours,
  actual ingredient consumption, waste); then the **realistic cost** computed
  and surfaced with deviations.
- **Backend:** row 10 (`production` domain + application + `/production`
  screens, `PROD-001…004`, `DEC-069…071`); `completeProductionBatch` posts
  atomically; the cost-card connection exists (`DEC-111`/`DEC-112`: direct
  labour and allocated overhead resolve from production data).
- **Build:** the plan→batch lift (quantities and expected yield/time from a
  dated plan); actual shifts/hours joined from shifts/worked-hours (row 14);
  actual consumption and waste already post via the ledger; surface the
  per-batch cost computation — ingredient cost from actual consumption,
  labour from actual hours × loaded rate, overhead allocated — with plan/actual
  variance vs yield (`PROD-003`, `DEC-084`) shown, not hidden.
- **Refs:** `PROD-001…005`, `WASTE-001/002`, `COST-013`, `DEC-069…084`.
- **Acceptance:** a full cycle (plan → batch → actual quantities/hours/waste →
  computed unit cost with variance) completes for one product on the demo data;
  deviations are visible on the batch and roll into reporting.
- **Dependencies:** W1 (workforce UI for hours visibility), W3 (recipe detail);
  the export of realistic cost back into the cost card needs `DEC-111`/`DEC-112`
  postures respected (record deviations and versioning decisions).

### W5 — Tasks + Administration

- **Status (2026-09-24): DELIVERED, with one recorded gap** — the task
  workflow slice is live (`DEC-122`, aligned to the schema status
  vocabulary); Administration is wired to what exists, but the
  identity/configuration backend (users, roles, scopes, tax, units read,
  audit read, data-quality read, integrations) has **no backend** and stays
  an honest listed gap.

- **Objective:** a minimal `task`/`approval` slice wired to the Tasks screen;
  Administration wired to what exists; identity/configuration management built
  or explicitly deferred with the reason.
- **Backend:** the `task`/`approval` tables exist schema-only (`DEC-094`/
  `DEC-101`, migration `0050`) — no application service, no route, no access
  row.
- **Build:** list/decide/transition slice (create, list with filters,
  `updateTask` transitions, `decideApproval`); record the **access matrix**
  (the `DEC-101` unset row — no touch without it) and the **transition
  posture** (whether reopen is constrained) as a `DEC-1xx`; wire the Tasks
  screen to it. Administration: imports (already exist under `/administration`
  depth), read-only configuration views (units, conversions, tax rules,
  vocabularies), audit (`audit_event`) and data-quality views
  (`data_quality_exception`); network/location/user management either built
  (a `DEC-1xx` decides) or deferred with the reason shown in the empty state.
- **Refs:** `DEC-094/099/101`; reqs `FND-007`, `DQ-001`, `OPS-005`.
- **Acceptance:** a task can be created, listed, transitioned and decided
  end to end by a recorded role; unauthorized roles fail closed; Administration
  shows imports/audit/data-quality/configuration truthfully; identity
  management is built or explicitly deferred — no "not implemented" label where
  the slice did land.
- **Dependencies:** none hard; the access matrix decision should land early because W6's advisories and W1's `HMS-001` action links may need `task` rows.

### W6 — Intelligence and simulation

- **Status (2026-09-24): DELIVERED** — trends/benchmarks, forecast and what-if
  simulation landed (see the decisions rows); competitor manual observations
  delivered; planning/forecast **tracking** has no backend and the insights
  card says so honestly.

- **Objective:** trends/benchmarks over history; predictability/forecast with
  stated confidence and method; suggestions and advisories (advisory only,
  human approval — the recorded AI posture, `DEC-039`/`ADR-0009` context);
  competitor and market analysis; and **what-if simulation**.
- **Backend:** rows 13c/13d/13e/13f reporting (`DEC-108…110`) and the cost-card
  composition chain (`DEC-111`/`DEC-112`) provide the data surface; forecast/
  competitor slices (rows 15–18) are blocked (data / `ADR-0009`–`0011`) — **do
  not build them silently**.
- **Build:** what can be built honestly now: period-over-period trends,
  benchmark and comparability views over existing reads
  (`buildSalesReport`, menu engineering, operations report); a forecast/
  predictability view that states its method, grain and confidence, degraded
  honestly where history is thin; competitor **manual** observations with
  source and date (`COMP-001`/`COMP-004` — dated observations, price/offer
  history, seasonal comparison; no automation, `ADR-0009`–`0011` remain
  `Proposed`); and **what-if simulation**: increase production, add employees,
  change menu (add/remove options), change prices — each showing the modelled
  effect on cost, margin and capacity, with assumptions visible and the result
  labelled as a model, never as fact (reuse the price-scenario machinery and
  `CALCULATION_CONTRACT.md` boundaries; a `DEC-1xx` records the simulation
  model's inputs and basis per change type).
- **Refs:** `RPT-001…005`, `FCST-001…004`, `COMP-001…004`, `PLAN-001…003`, `DEC-011`, `DEC-019`, `DEC-020`, `DEC-039`, `DEC-105…110`, `DEC-111/112`.
- **Acceptance:** every new read carries scope/period/freshness (`FND-006`);
  suggestions never auto-apply; each simulated change shows inputs, basis and
  output labelled "model"; competitor observations require review before
  influencing anything; blocked rows 15–18 stay blocked and stated.
- **Dependencies:** W4 (realistic actual costs make the models honest); W5
  (advisories may need task rows for human approval); price scenario →
  approved-version path (`PRICE-002/003`) already exists.

### W7 — UI refinement

- **Status (2026-09-24): COMPLETE** — six commits (`54022c7`…`01a9cda`;
  `docs/handoffs/080-2026-09-24-w7-ui-refinement-wave.md`): every section
  reachable, every recorded action present, stale "not wired / planned" copy
  purged, tokens/WCAG 2.2 AA/375px enforced, two reviews (qwen adversarial +
  glm code-level) with no blockers/majors. **Remaining close-out item:** the
  app-shell search/scope placeholders in `apps/web/app/(app)/layout.tsx`
  (single-owner) — wire or remove with the reason recorded; see `CONTEXT.md`
  "Resume here".

- **Objective:** a pass over every screen for simplicity, hierarchy, workflow
  and completeness, per `08_UI_UX.md` §8.4–§8.6 and the design brief.
- **Build:** every action present and wired (no dead ends); honest
  empty/loading/error states; forms fast (recent/default values, rapid repeat
  entry); mobile-first for the operational workflows (receiving, count,
  transfer, batch, waste, readings — `UX-001`); the design system
  (`packages/ui/**`, the Aquarela palette + the editorial direction in
  `designer-agent-modern-saas-ui-brief.md`) used consistently; accessibility
  WCAG 2.2 AA (`UX-002`). Remove "not implemented"/"coming soon" labels
  wherever the capability exists after W1–W6.
- **Acceptance:** walking the nav per role hits no dead ends at any recorded
  scope; every operational workflow is usable on a phone viewport; each screen
  answers "what next" or says honestly what input is missing (`08_UI_UX.md`
  §8.4 empty-state rule).
- **Dependencies:** runs alone only after waves containing W1/W2; otherwise it
  races them — schedule as a final wave plus per-wave touch-ups where the
  owner screens change.

## 4. Method (non-negotiables for every agent)

1. **Read first:** this file, `CONTEXT.md` (`Resume here`), the workstream's
   authoritative decisions in `12_OPEN_DECISIONS.md`, the cited requirement ids
   in `11_REQUIREMENTS_CATALOG.md`, `docs/BUILD_ROADMAP.md` §5 for open points.
2. **Decisions:** record a provisional `DEC-1xx` (per the decision template)
   before or with any new business rule or schema — never invent policy in code.
   Both tables of `12_OPEN_DECISIONS.md` get the entry.
3. **Additive and reversible:** migration expand-where-needed with a tested
   down path; prefer a read change over a new table; never rewrite history.
4. **Append-only** for financial and stock facts: reversals and corrections,
   never edits (`DEC-008`, `DEC-028`, `DEC-117`).
5. **Decimal-only money/quantities** with `HALF_UP` and the B0–B4 boundary
   chain (`docs/phase0/CALCULATION_CONTRACT.md`); never floats.
6. **Package boundaries:** domain → application → persistence → web as the
   framing ADRs (`ADR-0001/0002/0012`) define; layered commits (schema,
   domain/application, API/web, docs) each independently revertible, rollback
   approach in the commit body.
7. **Verification set, before finishing any slice:**
   `npm run typecheck`, `npm run lint`, `npm run format:check`,
   `npm run build`, `npm run test` **with `DATABASE_URL`** (the postgres suite),
   a `npm run db:migrate` no-op re-run check, and `npm audit --omit=dev` = 0.
   Node 22 via nvm.
8. **No new dependency** without a demonstrated need; stdlib/existing deps first.
9. **Accessibility** WCAG 2.2 AA (`UX-002`); authoring per the design system
   only; tests only for non-trivial logic (happy path + edge case; no render
   tests).
10. **Handoff per slice:** update `CONTEXT.md` (Resume here rewritten) and add a
    `docs/handoffs/NNN-…md` entry, newest-first in the README list. Do not edit
    the numbered specification files. **Do not commit** — the orchestrator
    commits.

## 5. Parallelisation map

**Disjoint — can run concurrently:**

| Group | Scope |
| --- | --- |
| A | W1 HMS wiring (new routes + `apps/web/app/(app)/hms/**` + `/api/v1/hms-web` glue only — the HMS API already exists) |
| B | W1 workforce wiring (`apps/web/app/(app)/workforce/**`) |
| C | W1 document-library wiring (`apps/web/app/(app)/documents/**`) |
| D | W2 master-data authoring pass (list/detail page actions per entity) |
| E | W3 recipes (new recipe-test slice: domain → application → persistence → web) |
| F | W5 tasks slice (new command service + routes + Tasks screen) |
| G | W6 reads (new insights reads under `packages/application/src/**` + `insights/**` pages) |

**Sequenced (shared surface or dependency):**

- **W4 after W1 + W3** (hours and recipe detail feed actuals).
- **W6 after W4** (models read realistic costs).
- **W7 last** (it polishes what W1–W6 land).

**Single-owner files — never edited by two agents at once:**

- `apps/web/app/(app)/shell-nav.tsx` (one nav-edit batch per wave, one agent)
- `packages/ui/src/**` (design-system changes funnel through one owner)
- `12_OPEN_DECISIONS.md` (decision ids entered serially to avoid id collisions)
- `CONTEXT.md` (per-slice rewrite, serial)

Everything else under `packages/domain/**`, `packages/application/**`,
`packages/persistence/**` and `apps/web/**` is safe to parallelise as new
modules; shared existing modules (e.g. `reporting.ts`, `vocabularies.ts`,
`lib/guards.ts`) are coordination points, not free-for-all. The `file_object`
storage port is its own dedicated slice early in Wave 1 because W1/C and W6
stall on it otherwise.

## 6. Sequencing (waves)

| Wave | Content | Why this order |
| --- | --- | --- |
| 1 | The `file_object` storage port slice (`DEC-085`/`DEC-099` blocker); the `DEC-120` row-11 backfill posture (next free id policy check); W1 HMS + workforce + documents wiring; W2 is ready concurrently | Unblocks data-bearing screens early; wiring delivers visible capability from finished backends at low risk |
| 2 | W5 tasks+Administration (access matrix decision first); W3 recipes; W2 completes | Task platform powers approvals used by W6 and `HMS-001`; recipes unblock W4; the Sharing access-matrix decision must precede whichever agent first writes a `task` role constant used by two slices |
| 3 | W4 production (actual hours join from row-14 data now wired; recipe versions known; cost composition post-`DEC-111/112` posture confirmed) | Depends on the earlier waves' data surfaces |
| 4 | W6 intelligence/simulation, including what-if (builds on realistic actuals) | The models are only honest once actuals exist |
| 5 | W7 UI refinement pass + the remaining close-outs (per `docs/BUILD_ROADMAP.md` §5) and the recorded follow-ups (partial corrections, `DEC-119` recorded-not-fixed items) | Polish and close-outs after all surfaces exist |

**Delivery status (2026-09-24):** all five waves were delivered under the
`DEC-120`–`DEC-128` slab plus W7's six commits; the wave-era blockers the
table contemplated (wiring, tasks access, recipes, competitors, what-if) are
recorded as delivered in this file and `CONTEXT.md`. The `file_object`
storage-port slice — planned for Wave 1 and deliberately deferred past W7 —
is now the **lead open item** (the `DEC-129` posture plus the application
port with a local adapter; see `CONTEXT.md` "Resume here"), followed by the
honest-gap list in §2. The programme is **not** done-done: golden fixtures
remain unsigned, owner inputs outstanding, and the gaps above stand as
recorded.

**Definition of done (programme):**

- Every nav entry reachable for every recorded role, with no dead ends and no
  honest-but-missing capability where a backend exists.
- W1–W6 acceptance criteria met; the shared verification set green; `npm audit` 0;
  the test baseline at least equal to the pre-programme 3648 (a reduction is a
  failing state).
- Every new business rule carries a `DEC-1xx`; recorded blockers either solved
  (a decision + a slice) or stated plainly at the relevant screen with the reason.
- Golden fixtures still unsigned → all costs labelled `illustrative` (the
  standing gate stands; do not hide it).
- `CONTEXT.md` handoff rewritten for the post-programme state; per-slice
  handoffs in `docs/handoffs/`.
