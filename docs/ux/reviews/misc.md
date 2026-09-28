# UX review — `misc` area (home, documents, tasks, jobs, administration, styleguide)

Audit date: **2026-09-28**. Reviewer: `ux-designer` (audit-only, no code changed).
Lens: `ux-screen-review` skill; contract: `docs/ux/README.md`.

## Scope, method and state seen

Eight screens, each opened in a named Playwright session (`playwright-cli -s=ux-misc`),
screenshotted and the PNG read back before judging:

`/` · `/documents` · `/documents/[id]` · `/documents/new` · `/tasks` · `/jobs` ·
`/administration` · `/styleguide`.

**State coverage actually observed:** the dev database has **0 documents, 0 tasks and
0 jobs** and one user, so every screen above was seen **empty** (with its empty-state
guidance). To reach the detail screen's data state, one scratch document
("Opening checklist") was created through the app's own form and **deleted from the
database afterwards** — the tree and data are back as found. No error state and no
permission-denied state were exercised; loading states were not captured (server-rendered,
`force-dynamic`).

No screen/component code was edited and nothing was committed.

---

## 1. `/` (home) → `apps/web/app/(app)/page.tsx`

**What it does today.** "Management home" is a **sales-reporting dashboard** for owner/GM,
not an operations board. Grain tabs (Daily / Weekly / Monthly); a hero *question*
("Is net sales trending up day over day?") with a line chart; a 4-KPI "Period measures"
band (Units, Transactions, Ingredient cost, Contribution before labour); a "Location
comparison" table; a sales-only "Exceptions and approvals" card; and a footnote defining
contribution. Everything is empty because no sales have been imported. Role-gated
("Not available for your role" is the fallback).

**Issues (ranked).**
1. **[1 job & hierarchy] blocker** — the screen's job is *sales reporting*, but a manager
   landing at `/` needs **operational state first**. There is no surface for the signals
   the owner actually needs: open shifts, pending approvals, dead-lettered jobs, import
   failures, period-close state. "Exceptions and approvals" is sales exceptions only.
2. **[10 visual direction] major** — no single hero metric. The hero is a question + chart,
   and the KPI band is four equal cards with no rank (README trigger: "five equal cards
   with no rank → pick one hero metric").
3. **[3 progressive disclosure] major** — the page is a wall of full-size `SectionCard`s
   (chart, 4 KPIs, a full comparison table, exceptions) with no summary→detail layering and
   no deep links to act on any number.
4. **[5 explainability] minor** — the contribution definition is a good-but-buried
   paragraph at the very bottom; it belongs on the metric as an (i) `InfoTip`.
5. **[6 state coverage] minor** — empty hero has guidance (good), but it does not link to
   the next action (`/sales/import`).

**Proposal.** Make `/` an **operational pulse**, not a sales report. One **hero band**
("Today at Aquarela") with a single hero metric and 3–5 signal rows, each a count + a
deep link:
- Hero: **N open exceptions** (or the worst of the set), styled as one big number.
- **Dead-lettered jobs → `/jobs?status=dead_lettered`**
- **Shift approvals pending → `/workforce/shifts`**
- **Import failures → `/sales/import`**
- **Period-close state → `/close`**
- **Open tasks → `/tasks?status=open`**

Demote the current commercial performance (trend question, period measures, location
comparison) to a **collapsible "Commercial performance"** secondary section, collapsed by
default; the report content already exists at `/insights/reports`. Keep the grain tabs
inside that section. Every signal number gets an (i) `InfoTip` (definition, source, as-of).

**New primitives needed.** `InfoTip`; `Collapsible`/`Disclosure`; a `MetricHero` (or reuse
`KpiCard` as the hero band); a compact `SignalRow` (label · count · link) — `SectionCard`
rows may cover it.

**Acceptance criteria.**
- Landing as owner/GM shows the operational hero band with live counts and working deep
  links **above the fold**.
- Commercial reporting is behind a collapsed disclosure (still present, not deleted).
- Every count links to its register; empty signals link to the action that fills them.
- Hero metric carries an (i) `InfoTip`.

**Triage:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## 2. `/documents` → `apps/web/app/(app)/documents/page.tsx`

**What it does today.** Staff document library: breadcrumb, `PageHeader` "Documents" with
the single primary "New document"; a full-width blue `Alert` ("Files are versioned and
stored privately", citing DEC-132 / ADR-0006); category `FilterChip`s (All / Routine /
Guideline / Policy / Form / Other); a "Library" table with a good empty state
("No documents — create one with New document, then version and publish it").

**Issues (ranked).**
1. **[5 explainability] major** — the "files are versioned and stored privately" note is a
   full-width **Alert carrying decision codes** (`DEC-132`, `ADR-0006`). The one thing the
   reader must know ("a manager attaches a file to a version; bytes are stored privately")
   is an (i) `InfoTip`, not a banner of references.
2. **[3 progressive disclosure] minor** — no framing band; a 2–3 KPI strip (Documents ·
   Drafts awaiting publish · Manager-only) would orient the manager, though it is not
   essential (screen has no data yet).
3. **[6 state coverage] minor** — only the empty state was seen; no loading/error sample.

**Proposal.** Keep the structure — it already matches the list recipe. Replace the Alert
with a single plain microcopy sentence plus an **(i) `InfoTip`** on "Library" explaining
versioning, private storage and the read rule. Optionally add a 2–3 KPI band. Keep the
category chips as the `FilterBar`.

**New primitives needed.** `InfoTip`.

**Acceptance criteria.**
- No decision codes visible on the screen; the versioning/privacy rule is reachable via (i).
- The table stays dense; the primary "New document" is the only loud action.

**Triage:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## 3. `/documents/[id]` → `apps/web/app/(app)/documents/[id]/page.tsx`

**What it does today.** Document detail. Breadcrumb, title + status pills (Draft, All
staff), the same "files are stored privately" `Alert`, a **Details** `DescriptionList`
(Category / Audience / Created / Last amended), **Current published version** (empty),
**Version history**, an inline **New version** form (`documents/[id]/page.tsx:363` —
Version notes textarea + optional file + "Create version"), and **Acknowledgements**
(manager view). Five stacked sections, ~2040px tall.

**Issues (ranked).**
1. **[3 progressive disclosure] blocker** — "New version" is an **inline create form on a
   detail route**. Creating/editing belongs in a **modal**; the form dominates the page.
2. **[4 segmentation] major** — five sections of near-equal weight. "Version history" and
   "Acknowledgements" are secondary and should be **collapsible, collapsed by default**.
3. **[2 information architecture] major** — the create action is separated from the version
   list it feeds; the action should hang off the "Version history" section header.
4. **[5 explainability] minor** — "Draft" and "All staff" pills are unexplained (what draft
   means, who sees what) → `InfoTip`.
5. **[6 state coverage] minor** — no success feedback after creating a version (needs a
   toast or a refreshed row).

**Proposal.** `PageHeader` + a small Details stat band at top. One primary action
**"New version"** opening a **Modal** (`packages/ui/src/modal.tsx`). Make "Version history"
the primary table; keep "Acknowledgements" and the Details metadata **collapsible**.
`InfoTip` on the status pills and on "published". Add success feedback after a mutation.

**New primitives needed.** `Collapsible`; `InfoTip`; success feedback (toast). `Modal`
already exists — use it.

**Acceptance criteria.**
- Create-version is a modal; no create form sits on the page.
- ≤3 primary sections; secondary sections collapsed by default and expandable.
- Status pills and "published" carry (i) tooltips; a version creation confirms visibly.

**Triage:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## 4. `/documents/new` → `apps/web/app/(app)/documents/new/page.tsx`

**What it does today.** Dedicated create route. `PageHeader` "New document" ("Create a
staff document. It starts as a draft; version and publish it from its page."); one
"Document details" card with **three fields** — Title, Category, Audience — and the primary
"Create document". This only creates the **draft shell**; versioning and publishing happen
on the detail page.

**Issues (ranked).**
1. **[7 interaction design / 3] major** — a whole route for a **three-field** create. The
   contract allows a route *or* a modal, and it is a legitimate create destination
   (consistent with `/purchasing/new`), but for three fields a **Modal** on `/documents`
   avoids the context switch and keeps the list in view.
2. **[1 job & hierarchy] minor** — the page's job is clear and stated; header and microcopy
   are good.
3. **[5 explainability] minor** — the "draft" concept is explained inline (good);
   "Audience" (All staff vs Managers visibility) could take an (i).
4. **[6 state coverage] minor** — no success feedback specified on submit.

**Proposal.** Recommend **converting to a Modal launched from `/documents` "New
document"**: it is a three-field draft shell with no multi-step content. The **publish**
step (the versioned, irreversible part) correctly stays on the detail route. If the route
is kept, narrow it to a compact single card and keep the "starts as a draft" guidance;
decide the route-vs-modal rule repo-wide (`/purchasing/new` is also a route) and apply it
consistently.

**New primitives needed.** `Modal` (exists).

**Acceptance criteria.**
- Either a compact single-purpose route or a working modal launched from the library.
- The "starts as a draft, version and publish on its page" guidance survives either way.
- Submit gives visible success feedback.

**Triage:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## 5. `/tasks` → `apps/web/app/(app)/tasks/page.tsx`

**What it does today.** Task register. Header + purpose line ("open → in progress →
resolved, open/in progress → dismissed, with blocked re-entering in progress (DEC-122)"); a
long amber **Access is provisional (DEC-122)** `Alert`; a **Filters** card (status chips,
assignee, due date, Apply/Reset); the **Tasks** table (0 tasks, by due date); and an inline
**"Create a task"** `SectionCard` (`tasks/page.tsx:250`).

**Issues (ranked).**
1. **[7 interaction design] major** — "Create a task" is an **inline form on a list
   screen** (`tasks/page.tsx:250`) → must be a **modal** opened from the header.
2. **[1 job & hierarchy] major** — there is **no primary action in the `PageHeader`**; the
   only create path is buried at the bottom of the page.
3. **[5 explainability] major** — "Access is provisional (DEC-122)" is a **decision-code
   essay** in an Alert; the state machine and who-can-act belong in an (i) `InfoTip` with
   one plain sentence kept in the header.
4. **[1] minor** — add a hero count band (Open · In progress · Blocked · Overdue) to frame
   the register; the status chips answer "filter", not "how much".
5. **[6 state coverage] minor** — empty state is fine; no error/loading sample.

**Proposal.** `PageHeader` with the single primary **"New task"** (modal). Hero band of
status counts. Quiet `FilterBar`. Dense tasks table as the primary section. Access/state
machine as (i) `InfoTip`; drop the DEC codes from the banner. Create form → modal.

**New primitives needed.** `InfoTip`; `Modal` (exists).

**Acceptance criteria.**
- Primary "New task" is in the header and opens a modal; no create form on the page.
- DEC codes are not in a banner; access rules reachable via (i).
- Status counts are visible at a glance.

**Triage:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## 6. `/jobs` → `apps/web/app/(app)/jobs/page.tsx`

**What it does today.** "Jobs" — job progress and the **dead-letter review queue**
(DEC-139). `FilterChip`s **Dead-lettered (default)**, Failed, Running, Pending, Succeeded;
a Jobs table (0 jobs, "newest first · offset 0"); a footnote about polling and the raw
`GET /api/v1/jobs` API. Header microcopy explains retry vs discard.

**Issues (ranked).**
1. **[1 job & hierarchy / 10] major** — the dead-letter queue is the screen's job but has
   **no hero metric**; the only count sits in the table meta ("0 jobs"). Lead with
   **Dead letters: N (oldest Xd)** as the hero.
2. **[5 explainability] major** — "Retry re-queues a job; discard marks it terminally
   failed" is in the header prose, but both actions are **irreversible** and inline-unexplained
   → each needs an (i) `InfoTip` and a confirmation.
3. **[3 progressive disclosure] major** — Running/Pending/Succeeded are peers of
   Dead-lettered; the **secondary statuses should be collapsed** ("Job activity"), leaving
   the dead-letter queue as the primary register.
4. **[2 information architecture] minor** — "offset 0" is internal jargon shown to users;
   label it "page 1" or hide it.
5. **[5] minor** — the polling/API footnote is developer detail; move to (i) or drop.

**Proposal.** Hero metric band **"Dead letters: N · oldest Xd"**. Primary table = the
dead-letter queue with Retry / Discard (confirm + explain). Status chips become a
`SegmentedControl` (or tabs) **with counts**; "Job activity" (running/pending/succeeded)
becomes a **collapsible** secondary section, collapsed by default. Remove the raw offset and
API prose from the UI; keep an (i) for retry/discard consequences.

**New primitives needed.** `InfoTip`; `Collapsible`; confirm dialog (`Modal` exists);
reuse `KpiCard` for the hero.

**Acceptance criteria.**
- Dead letters lead the screen as the hero metric and the default view.
- Secondary job activity is collapsed; status control shows counts.
- Retry and discard confirm and explain their effect; no "offset" text on screen.

**Triage:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## 7. `/administration` → `apps/web/app/(app)/administration/page.tsx`

**What it does today.** A **single 7700px page** bundling eight sections: **Available**
(an index of linked screens), **Units & conversions** (empty + inline "New conversion"
form), **Units** (5 shown), **Data quality** (0), **Audit** (50-row log), **Users &
access** (1), **Tax rules** (0), **Integrations** (0 + inline "Register source"). The
purpose line says areas without a screen stay listed with the reason they are unavailable.
Ends with a "Back to Management home" link.

**Issues (ranked).**
1. **[4 segmentation / 2 IA] blocker** — one page bundles users/roles, integrations, tax,
   units, data quality and audit. Well over ~3 primary sections → **this is several
   screens**.
2. **[4] major** — register **create forms are inline on the hub** ("New conversion",
   "Register source", tax-rule form) instead of modals on their own screens.
3. **[10 visual direction] major** — a **50-row audit log dominates the page by height**;
   audit is oversight, not configuration.
4. **[2] major** — the "Available" index duplicates both the sidebar and the hub's own
   purpose; it competes with the real sections.
5. **[5 explainability] minor** — section prose is dense with codes (FND-003, DQ-001,
   PRICE-005, INTG-001, DEC-015/137); keep one plain sentence + (i).

**Proposal — segregate.** Make `/administration` a **hub of sectioned cards / tabs**, each
showing a count and linking to a dedicated register route:
- **Stays on the hub:** a compact "Areas" grid — Users & access, Integrations, Tax rules,
  Units & conversions, Data quality — with counts and links.
- **Moves off the page:**
  - Users, roles, invites → `/administration/users` (logic already in
    `administration/user-access-manager.tsx`).
  - Integrations → `/administration/integrations` (`integration-register.tsx`).
  - Tax rules → `/administration/tax-rules` (`tax-rule-register.tsx`).
  - Units & conversions → `/administration/units` (`unit-conversion-form.tsx`).
  - Data quality → `/administration/data-quality`.
  - Audit log → `/administration/audit` (or under `/insights`).
- Each register page uses the list recipe (header primary → **modal** create → dense table).
- Remove the "Available" index from the hub (the sidebar + hub grid cover it).

**New primitives needed.** None strictly (Tabs, DescriptionList, Modal, Table exist); an
`AreaCard`/hub-card (title + count + link) would formalise the grid; `InfoTip` for codes.

**Acceptance criteria.**
- The hub is < ~3 bands: an areas grid with counts + links, nothing else.
- Every register has its own route using the list recipe; create actions are modals.
- The audit log is not on the hub page.

**Triage:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## 8. `/styleguide` → `apps/web/app/(app)/styleguide/page.tsx`

**What it does today.** The living design-system reference (~8700px). Sections: Colour
(Brand / Background / Navigation / Text / Border / Status / Data-viz ramps), Typography
(Display / Sans / Weights), Spacing–radius–elevation, Buttons, Text fields, Alerts-badges-
status pills, Tables, Dashboard signals (Sparkline), Shell primitives (NavList/NavItem,
ScopeBar, WatercolorBackdrop), Surfaces, Panel. Token contrast is covered by
`packages/ui/src/contrast.test.ts`.

**Issues (ranked).**
1. **[9 consistency / 5 explainability] blocker** — the reference is **missing exactly the
   Wave-0 primitives this audit demands**: no **(i) `InfoTip`**, no **`Collapsible` /
   `Disclosure`**, and no **Modal/Dialog pattern** (the `Modal` primitive exists in
   `packages/ui/src/modal.tsx` but is not documented). Without these the contract cannot be
   carried.
2. **[10 visual direction] major** — no **type-scale specimen** showing the scale as a
   rhythm, and no spacing-rhythm specimen (the "precise type scale, 4/8pt rhythm" the
   contract promises). Display/Sans/Weights labels alone don't demonstrate it.
3. **[4 segmentation] minor** — an 8700px flat wall with no in-page index or anchors; a
   reference needs a sticky section nav.
4. **[6 state coverage] minor** — no live loading (Skeleton) / error / empty specimens.

**Proposal — what the refreshed styleguide must show so it can carry the contract:**
1. **Type scale** — every step labelled with size/weight/line-height and shown against the
   **4/8pt spacing rhythm**; one worked example proving hierarchy (one hero + section title
   + body + table).
2. **Spacing & radius rhythm** — the 4/8pt scale rendered as measured steps, with do/don't.
3. **The (i) `InfoTip`** — live, with the four mandated uses (term, calculated number,
   status, irreversible consequence) and an explicit "do not use for required
   instructions" counter-example.
4. **The `Collapsible`/`Disclosure`** — live, **collapsed by default**, showing the
   secondary-section pattern.
5. **The Modal pattern** — create/edit form modal and destructive-confirm modal.
6. **The hero metric band** (`KpiCard`/`MetricHero`) demonstrating one-hero hierarchy.
7. A sticky in-page **section index** for navigation.

**New primitives needed on this screen.** `InfoTip`; `Collapsible`; documented `Modal`
pattern; a `SectionNav`/anchor index; a `MetricHero` (or explicit `KpiCard` hero usage).

**Acceptance criteria.**
- The styleguide documents **InfoTip, Collapsible, Modal and the hero metric band**, each
  with a live example and a do/don't.
- The type scale and spacing rhythm are shown as measurable specimens, not just labels.
- A sticky section index navigates the page.

**Triage:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## Area summary

**Shared pattern this area must adopt.** List/register screens follow one recipe —
`PageHeader` with the **single primary action opening a `Modal`** → optional **hero metric
band** → quiet `FilterBar` → dense primary table → **collapsible** secondary sections →
**(i) `InfoTip`s** on every domain term, calculated number, status value and irreversible
action. Detail screens are `PageHeader` + `DescriptionList`, edits in modals, secondary
material collapsed. `/styleguide` is the reference that proves these primitives exist.

**Highest value first.**
1. **`/` (home)** — replace the sales-report wall with an **operational hero band + deep
   links**; demote commercial reporting behind a disclosure. Biggest single win.
2. **`/jobs`** — lead with the **dead-letter hero metric**, collapse the secondary statuses,
   confirm retry/discard.
3. **`/administration`** — **split** the 8-section page into a hub grid plus per-register
   routes; move audit off the hub; create forms → modals.
4. **`/documents/[id]` · `/documents/new` · `/tasks`** — **modal-ise create/edit**; collapse
   secondary sections.
5. **`/styleguide`** — grow the **Wave-0 primitives** (InfoTip, Collapsible, Modal pattern,
   hero metric, type/spacing specimens) so every other area has a contract.

**Wave-0 primitives this area needs (batch once):** `InfoTip`; `Collapsible`/`Disclosure`;
a documented `Modal` pattern (primitive exists — add the pattern + docs); a success-feedback
toast; a `MetricHero` (or a documented hero use of `KpiCard`).

**Cross-cutting cleanup.** Replace decision-code `Alert` banners (`DEC-122`, `DEC-132`,
`RPT-003`, `INTG-001`, `FND-003`) with one plain sentence plus an (i) — the codes are
evidence for the owner, not for the operator.
