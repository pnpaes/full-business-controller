# HMS — UX screen review

- **Date:** 2026-09-28
- **Reviewer:** `ux-designer` (audit-only; no screen code changed)
- **Lens:** `ux-screen-review` skill; contract `docs/ux/README.md`
- **Scope:** 8 routes under `apps/web/app/(app)/hms/`
- **Evidence:** `/hms` (3692-byte screenshot), one screenshot per route, each read back; live app `http://localhost:3000` as `owner`. Screenshots were scratch and have been deleted.
- **State coverage:** the dev DB was empty for HMS, so empty states were seen directly; one incident (`Freezer compressor…`, bc841abb) and one equipment (`Walk-in freezer 1`, c832210b) were created via the UI/SQL to reach the detail routes. Loading, error and permission-denied were **not** observed (SSR; no denied role available).

Overall: the eight HMS screens are visually coherent (same `PageHeader`, `SectionCard`, pill tones) but share two structural faults — **create/edit forms sit inline on the page** and **detail screens are one unbounded stack of cards with no disclosure**. Every screen also carries role rules as inline prose (`meta="record roles only"`, `"create roles only"`, …) instead of a discoverable (i) affordance. No `InfoTip`, `Collapsible` or `Modal` use exists anywhere in the area.

---

## 1. `/hms` → `apps/web/app/(app)/hms/page.tsx`

**What it does today.** Header kicker `HMS`, title "HMS monitoring log", one-sentence purpose. The first thing on the page is a full-height **"Record a reading"** form (monitoring-point select with target-range hint, measured value + unit, notes). The monitoring register and a **"Register a monitoring point"** form follow below the fold.

**Issues (ranked)**
- `[3] progressive disclosure` — **major** — a create form occupies the whole first viewport; the register (the screen's one job) is pushed below it.
- `[7] interaction design` — **major** — two full forms on one screen. "Record a reading" is a frequent, single-value field capture (compact modal/sheet); "Register a monitoring point" is a rare config write (separate modal).
- `[1] job and hierarchy` — **major** — no primary action in the header, no hero metric; the page's purpose is not answered above the fold.
- `[4] segmentation` — **minor** — reading capture, register and point config are three concerns in one column with no section bands.
- `[5] explainability` — **minor** — the in-range verdict, cadence-overdue cue and "measured instant is submission time (DEC-089)" are inline prose; no (i) on the derived status.
- `[9] consistency` — **major** — unlike `/hms/incidents` and `/hms/corrective-actions` there is no filter/status chip row and no dense register table; the inventory calls this the "HMS overview" but it is a capture screen.

**Proposal.** Lead with a **hero band**: the monitoring register as the primary section (point, latest value, in/out-of-range status, cadence-overdue) with filter chips (`All · In range · Out of range · Overdue`). Move **Record a reading** to a **compact modal** (or inline row action per point) — one value, one unit, submit; move **Register a monitoring point** to a `Modal` behind a header primary action "New monitoring point". Add an `InfoTip` on the range/verdict and on "overdue". Keep the register table dense.

**New primitives needed:** `InfoTip` (wrap existing `Tooltip`), `Modal` (exists — start using it), optional compact `Sheet` for one-value capture.

**Acceptance criteria**
- Header shows title, purpose and one primary "New monitoring point" action; the register table is the first content below the header.
- "Record a reading" is reachable as a row action or header action and opens a modal/sheet that fits one viewport; no full-page reading form.
- Status column values carry an `InfoTip` explaining the verdict and overdue basis.

**Triage line:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## 2. `/hms/incidents` → `apps/web/app/(app)/hms/incidents/page.tsx`

**What it does today.** Header kicker `HMS` + title + DEC-referenced purpose. A row of status filter chips (`All · Open · Investigating · Resolved · Closed`). Then an "Incidents" `SectionCard` with an empty state ("No incidents match…"), then a full **"Raise an incident"** inline form (location, category, severity, owner, title, description, due date).

**Issues (ranked)**
- `[7] interaction design` — **major** — raising an incident is a full inline form at the foot of the list, not a modal; the header has no primary action.
- `[3] progressive disclosure` — **major** — the create form sits permanently on the register page; the register should own the page, creation on demand.
- `[9] consistency` — **minor** — filter chips are links (`?status=open`) here but the register has no pagination or column sort shown; other areas use `FilterBar`.
- `[5] explainability` — **minor** — severity/category vocabularies (`low…critical`) and status transitions (what "Investigating" implies, who can close) are unexplained; `meta="create roles only"` is prose, not a discoverable rule.
- `[6] state coverage` — **minor** — empty state is good (guidance + next step); no error/loading/denied copy observed.

**Proposal.** Keep the chip filter row. Move **Raise an incident** to a header primary action opening a `Modal` (the current fields, group into "What happened" / "Severity & owner" `FormSection`s). Add an `InfoTip` on Severity (escalation meaning) and on each status pill (what it means / who sets it). Add `Breadcrumbs` for consistency with `recipes`.

**New primitives needed:** `InfoTip`; `Modal` (exists); `FormSection` (exists).

**Acceptance criteria**
- Header exposes exactly one primary action, "Raise an incident", opening a modal; the page has no inline create form.
- Severity values and status chips each carry an `InfoTip` with meaning and the role that can change them.
- Empty state still explains the next step.

**Triage line:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## 3. `/hms/incidents/[id]` → `apps/web/app/(app)/hms/incidents/[id]/page.tsx`

**What it does today.** Kicker `HMS · Incident`, title = incident title, description = the incident description. Then **six stacked `SectionCard`s in one unbounded column**: (1) Incident record read view, (2) Update or close edit form, (3) Evidence list (0 attachments), (4) Attach evidence form, (5) Corrective actions list, (6) Add corrective action form. There is **no timeline / audit history** anywhere. Measured: the full-page screenshot is ~2.5 viewport-heights of uninterrupted cards.

**Issues (ranked)**
- `[3] progressive disclosure` — **blocker** — the screen is a single long page with four editable forms and no tabs, collapse or detail sub-routes. Read and write are interleaved (record → edit; evidence list → attach form; actions list → add form).
- `[2] information architecture` — **major** — the read/write pairs are duplicated as separate cards; each concern should be one section with the action on demand.
- `[7] interaction design` — **major** — "Update or close", "Attach evidence" and "Add corrective action" are all inline; the update form is open by default and dominates.
- `[5] explainability` — **major** — `meta="edit roles only"`, "owner-assignable", "opens open · owner optional" are unexplained role/status jargon; no `InfoTip` on severity or on the close/reopen consequence.
- `[2] information architecture` — **major** — **no timeline**: incident history (raised → status changes → evidence → actions) is the natural audit view and is missing entirely.
- `[9] consistency` — **minor** — no breadcrumbs back to the register (only a kicker).

**Proposal.** Split into **`Tabs`**: **Overview** (read `DescriptionList` + timeline), **Evidence**, **Corrective actions**. Default tab = Overview. The **audit timeline** (status changes, evidence attachments, action lifecycle) is the Overview hero. Edit = `Modal` ("Update or close"); "Attach evidence" = a `Modal`/compact sheet triggered from the Evidence tab; "Add corrective action" = `Modal` from the Corrective actions tab. All role rules become an `InfoTip` on the section title. Collapse the edit form by default.

**New primitives needed:** `InfoTip`; `Tabs` (exists); `Modal` (exists); a **timeline** pattern (new — see area summary) or reuse `DescriptionList`.

**Acceptance criteria**
- Detail page is tabbed (Overview / Evidence / Corrective actions); the default view shows the record and timeline, not a form.
- Each of the three mutations opens in a modal; no always-open edit form on the page.
- Timeline lists raised/status/evidence/action events newest-first with actor and instant.
- Every role/status term has an `InfoTip`.

**Triage line:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## 4. `/hms/checklists` → `apps/web/app/(app)/hms/checklists/page.tsx`

**What it does today.** Header kicker + title + purpose. Three stacked `SectionCard`s: **"Run a checklist"** (empty alert: no template exists — "Register one through the API (owner, general manager or admin)"), **"Templates"** (0 active templates, API-authoring note), **"Run history"** (0 runs, per-item outcomes).

**Issues (ranked)**
- `[5] explainability` — **major** — "Register one through the API (owner, general manager or admin)" appears three times, verbatim; a dead-end that tells the operator to leave the app with no link or `InfoTip`. `meta="record roles only"` is unexplained.
- `[3] progressive disclosure` — **minor** — "Run history" is secondary and should be collapsed by default, not a third always-open card.
- `[4] segmentation` — **minor** — "Run a checklist" empty-state and "Templates" empty-state are two empty cards describing the same blocked state.
- `[7] interaction design` — **minor** — running a checklist is described as a "question flow" but the trigger is disabled with no route to the flow.
- `[6] state coverage` — **minor** — the empty states are informative (good); no loading/error/denied observed.

**Proposal.** Keep the run-a-checklist flow as the primary section when a template exists. Merge the two blocked empty states into one `Alert` with a clear explanation of *why* authoring is API-only and who to ask (an `InfoTip`/link, not repeated parentheticals). Collapse **Run history** by default. Once templates exist, "Run a checklist" becomes a header primary action opening the flow (modal for a short template; detail route for a long one).

**New primitives needed:** `InfoTip`; `Collapsible` (new — Wave 0).

**Acceptance criteria**
- The API-only authoring limitation is stated once, with an explicit next step (link/owner), not repeated in three cards.
- Run history is collapsed by default.
- With a template present, the run flow is reachable as a single primary action.

**Triage line:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## 5. `/hms/corrective-actions` → `apps/web/app/(app)/hms/corrective-actions/page.tsx`

**What it does today.** Header kicker + title + purpose. Status chip row (`All · Open · In progress · Done · Verified`). One "Actions" `SectionCard` with an empty state: "No corrective actions match. Actions are added from an incident's detail page." No create form (correctly delegated to the incident).

**Issues (ranked)**
- `[5] explainability` — **minor** — status vocabulary (`Open · In progress · Done · Verified`) has a two-actor model ("operators progress an action, a manager verifies it") stated only in the page description; no per-status `InfoTip` on who may advance it.
- `[9] consistency` — **minor** — uses chip links like incidents; this is the one HMS register whose empty state points at the right create route (good — the other registers should copy it).
- `[6] state coverage` — **minor** — only empty observed.
- `[10] visual direction` — **minor** — no hero metric (open / overdue actions); the page is one card.

**Proposal.** Add a small hero band (open, overdue, awaiting verification). Add `InfoTip` on each status explaining the operator/verifier split. Keep the empty state's pointer to the incident detail page — adopt that pattern elsewhere.

**New primitives needed:** `InfoTip`.

**Acceptance criteria**
- Each status chip/pill has an `InfoTip` stating meaning and which role advances it.
- A hero band surfaces open/overdue/awaiting-verification counts.

**Triage line:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## 6. `/hms/equipment` → `apps/web/app/(app)/hms/equipment/page.tsx`

**What it does today.** Header kicker + title + purpose. "Equipment" `SectionCard` (0 items, empty state "Add the first machine with the form below"), then a full **"Register equipment"** inline form (location, code "permanent", name, kind, serial, installed, warranty).

**Issues (ranked)**
- `[7] interaction design` — **major** — registration is a full inline form; header has no primary action.
- `[3] progressive disclosure` — **major** — the empty state says "with the form below", normalising the form-on-page pattern.
- `[5] explainability` — **minor** — `meta="write roles only"` and the "code is permanent / cannot be changed" warning are prose; the warranty/status semantics have no (i).
- `[9] consistency` — **major** — no filter chips (kind/active) unlike incidents/corrective-actions; no breadcrumbs.
- `[6] state coverage` — **minor** — empty state good; no loading/error/denied observed.

**Proposal.** Move **Register equipment** to a header primary action opening a `Modal`. Add filter chips (`All · Active · Retired`, by kind). Empty state points to the header action, not "the form below". Add `InfoTip` on "Code is permanent" and on Warranty/Status.

**New primitives needed:** `InfoTip`; `Modal` (exists).

**Acceptance criteria**
- Header has a single "Register equipment" primary action opening a modal; no inline register form.
- Filter chips by status/kind present; empty state references the header action.
- Code-permanence and warranty carry `InfoTip`s.

**Triage line:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## 7. `/hms/equipment/[id]` → `apps/web/app/(app)/hms/equipment/[id]/page.tsx`

**What it does today.** Kicker `HMS · Equipment`, title = machine name, description = register code. Then **four stacked `SectionCard`s**: (1) Register record read view, (2) Maintenance log (0 entries), (3) **Log maintenance** form (kind, notes, evidence file, append-only caveat), (4) **Amend equipment** form (name, kind, serial, installed, warranty, active, save). No checks section despite the inventory's "checks, maintenance" purpose. Full-page screenshot ≈ 2 viewports of uninterrupted cards.

**Issues (ranked)**
- `[3] progressive disclosure` — **blocker** — two full forms stacked on one detail page with no tabs/collapse; the amend form is open by default.
- `[2] information architecture` — **major** — the register record, maintenance history and amendment are one screen; the inventory promises a "checks" section that does not exist. No timeline of service events.
- `[7] interaction design` — **major** — "Log maintenance" and "Amend equipment" are inline; "Log maintenance" is a frequent field capture (kind + notes + optional photo) that fits a compact sheet; "Amend" is rare and belongs behind an Edit action/modal.
- `[5] explainability` — **major** — `meta="record roles only"`, "append-only fact", "Retention is not enforced and file contents are not scanned… (DEC-133)" are jargon/warnings with no (i) affordance; the evidence caveat is a wall of small print.
- `[9] consistency` — **minor** — same no-breadcrumb issue; section ordering differs from the incident detail (reads then forms, but pairing differs).

**Proposal.** Tabs: **Overview** (register record + service timeline), **Maintenance** (log list + "Log maintenance" action), **Settings/Edit**. "Log maintenance" = compact sheet/modal (kind, notes, photo); "Amend equipment" = `Modal` behind an Edit action. Fold the DEC-133 retention caveat into an `InfoTip` on the evidence field. Add the missing **checks** view (or remove the promise) — see area summary.

**New primitives needed:** `InfoTip`; `Tabs` (exists); `Modal` (exists); timeline pattern.

**Acceptance criteria**
- Tabbed detail page; default shows record + service timeline, no open forms.
- Log-maintenance and amend both open from actions (sheet/modal), not always-open forms.
- Evidence retention/scanning caveat is an `InfoTip`; role rule is an `InfoTip`.
- The "checks" promise is either implemented as a section or removed from the purpose line.

**Triage line:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## 8. `/hms/compliance-export` → `apps/web/app/(app)/hms/compliance-export/page.tsx`

**What it does today.** Header kicker + title + purpose ("build the evidence bundle…"). **"Build the evidence bundle"** `SectionCard` with Period from/to date fields and a "Build bundle" primary button. Below, a **"What the bundle covers"** card whose content explains scope in prose: "the whole organisation for owner/GM/admin; exactly your own location scope for a location manager…".

**Issues (ranked)**
- `[5] explainability` — **major** — the export **scope is role-dependent** and is buried in a long paragraph after the action; the reader cannot tell what will be included before clicking. The `meta="internal JSON · DEC-098"` label is jargon.
- `[5] explainability` — **major** — "what the bundle covers" (monitoring readings, incidents, corrective actions, checklist runs, maintenance logs) and the inclusive UTC window boundaries are stated as paragraphs; the field hint text and the coverage list duplicate.
- `[7] interaction design` — **minor** — "Build bundle" produces a download; no confirmation of what was included before/after, no options (e.g. filter by location).
- `[3] progressive disclosure` — **minor** — coverage explanation should be collapsible or an `InfoTip`, not a permanent second card.
- `[9] consistency` — **minor** — the only HMS screen with a date-range form and no register/filter chips; no breadcrumbs.

**Proposal.** Put the effective **scope** for the signed-in role in a summary line above the action ("You will export: All locations (owner scope) · 01–30 Sep 2026") and explain the role mapping in an `InfoTip`. Collapse "What the bundle covers" into a `Collapsible` or summarise as chips of the five entity types. Rename the internal-JSON meta to something operator-readable; if JSON is a technical artifact, keep it out of the primary UI. Confirm the produced bundle (counts per entity) after the action.

**New primitives needed:** `InfoTip`; `Collapsible` (new — Wave 0); a scope-summary line pattern.

**Acceptance criteria**
- Before building, the page states, in plain language, which locations/period will be exported for this role, with an `InfoTip` for the role→scope mapping.
- "What the bundle covers" is collapsible; the five entity types are shown as a scannable list.
- After building, the user sees confirmation of what was included (counts), not only a silent download.

**Triage line:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## Area summary — HMS

**Pattern the area should share.** One recipe for every HMS register: `Breadcrumbs` + `PageHeader` with a **single header primary action opening a `Modal`**, an optional 1–3 KPI hero band, a `FilterBar`/chip row, then **one dense register table**. One recipe for every HMS detail route: `PageHeader` + **`Tabs`** (Overview / <primary concern> / Edit), where Overview = read `DescriptionList` + **timeline**, and every mutation opens a `Modal` or compact sheet. Every role rule ("create/record/edit roles only") becomes an `InfoTip`, never inline parenthetical prose.

**Shared defects across all eight.** (1) Inline create/edit forms on list pages (`/hms`, `/hms/incidents`, `/hms/equipment`) and stacked forms on detail pages (`incidents/[id]`, `equipment/[id]`). (2) No `InfoTip`/`Collapsible`/`Modal` use. (3) Role wording is repeated prose. (4) No breadcrumbs on HMS list screens (recipes has them). (5) No timeline on the two detail screens, though both are audit registers.

**Highest value first.**
1. `[3]` + `[7]` **`/hms/incidents/[id]`** and **`/hms/equipment/[id]`** — the two blockers; introducing `Tabs` + `Modal` + timeline here defines the pattern the other six copy.
2. `[3]`/`[7]` **`/hms`** — reframe from capture form to monitoring register with a modal capture flow.
3. `[7]` **`/hms/incidents`** and **`/hms/equipment`** — move the create form to a modal header action.
4. `[5]` **`/hms/compliance-export`** and **`/hms/checklists`** — scope/role explainability and the API-only dead end.

**Wave-0 primitives this area demands:** `InfoTip` (wrap `Tooltip`), `Collapsible`/`Disclosure`, a reusable **timeline** pattern, and a **compact sheet** (or a size variant of `Modal`) for one-value/one-photo captures. `Tabs`, `Modal`, `FormSection`, `DescriptionList`, `FilterChip` already exist in `packages/ui` and are simply unused here.
