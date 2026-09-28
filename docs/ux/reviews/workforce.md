# UX review — area `workforce` (+ `close`, `account/security`)

Audit only (no screen or component code changed; nothing committed). Lens:
`ux-screen-review` skill, contract `docs/ux/README.md`. 9 screens reviewed: the
seven `/workforce/*` routes plus `/close` and `/account/security` (own first
segments, grouped here per the task brief). Reviewer: `ux-designer`.

**Evidence:** app at `http://localhost:3000`, named session `ux-workforce`,
logged in as `owner`. One 1440×900 screenshot per screen (plus data-state
re-shots for the two registers and the two detail routes), each read before
judging. Scratch files `storage/tmp/workforce-*.png`, deleted after this file was
written.

**State coverage actually seen:** every screen was read **empty / no-data**
(the owner org had no employees, shifts in range, worked hours or payroll
reports). The **permission-denied** state was seen on `/workforce/my-shifts`.
The employee and payroll detail routes were reviewed by creating **one minimal
record each in the owner org** (dev DB only — ids in the notes below; no code
changed). **Loading and error states were not exercised**; success feedback was
only partially observable (see `/workforce/payroll-reports`).

**Observed on all screens (shell, out of per-screen scope):** the sidebar footer
(`owner@aquarela.local` / `Sign in`) overlaps the nav bottom-left, bleeding over
the `Jobs` item; on wide screens it is clipped. Shell-level; flag to Wave 0.

**Cross-cutting pattern in this area** (repeated on 6 of 9 screens):
1. the create/edit form sits **inline on the list or detail page** instead of in
   a `Modal` (the `Modal` primitive already exists);
2. each card wraps its empty state in a **nested bordered grey box** inside the
   card (`EmptyState` inside `Card`);
3. a **long alert banner** (blue or amber) carries the screen's explanation
   instead of a concise `Alert` + an (i) `InfoTip`;
4. every screen shows **raw decision/framework codes and jargon** (`(03.10)`,
   `DEC-104`, `HALF_UP`, `supersede`, `scopeLimited`) with no (i) anywhere;
5. **equal-weight KPI cards** (2–3) with no hero.

**Primitives available today** (`packages/ui/src/*.tsx`): `Modal`, `FilterBar`,
`FilterChip`, `SegmentedControl`, `ScopeBar`, `KpiCard`, `EmptyState`, `Tabs`,
`Alert`, `StatusPill`, `DescriptionList`, `DataTable`, `Tooltip`, `FormSection`.
**Missing (Wave 0 candidates):** `InfoTip` (wrap the existing `Tooltip`),
`Collapsible`/`Disclosure`, `EmptyState variant="plain"` (borderless in-panel).

---

### `/workforce` (Employees register) → `apps/web/app/(app)/workforce/page.tsx`

**What it does today**
The employee register. Two rows of pill filters (status Active/Retired/All, then
location chips), a `Register` card whose table shows a nested grey empty-state
box, then a full **Register an employee** form with 7 fields inline below it, a
personnel-documents note, and footer links to the roster and My shifts.

**Issues (ranked)**
- [3] progressive disclosure · major — the whole create form (Name, Role,
  employment type, base rate, location, active-from/to) lives on the list page;
  creating an employee is not the screen's at-a-glance job.
- [1] job and hierarchy · major — no header primary action; the destructive
  `Retire` button sits in each row's Actions column with no visible separation or
  confirm.
- [4] segmentation · major — the empty state is a bordered grey box nested inside
  the `Register` card.
- [5] explainability · major — `retired, never deleted (03.10)` cites a decision
  number as user copy; raw `full_time`/`part_time` enum values; base rate shown as
  `200.0000` (4 dp) while the placeholder is `185.50`.
- [10] visual direction · minor — status pills and location chips are two equal
  rows of the same affordance; `All locations` and `All` overlap in meaning.
- [9] consistency · minor — base-rate scale differs from other money displays.

**Proposal**
Header primary **“New employee”** opens a `Modal` with the existing form; delete
the inline form. Collapse the two filter rows into one `FilterBar` (a status
`SegmentedControl` + a location `SelectField`). Keep the table dense (it is
good). `EmptyState` becomes borderless inside the panel, with first-run guidance
(“No employees yet — add your first”). Move `Retire` out of the row into the
detail route / a confirm dialog. Add `InfoTip`s on retirement, the employment-type
values and the base rate (formula: hours × rate). Format money at scale 2.

**New primitives needed** — `InfoTip`; `EmptyState variant="plain"`. (`Modal`,
`FilterBar`, `SegmentedControl` exist.)

**Acceptance criteria**
- No create/edit form is visible on the list page; “New employee” opens a modal.
- The empty state is not a nested bordered box.
- One filter row; filters survive navigation (URL state) and show as active.
- Every enum value, decision reference and money figure carries an (i) or is
  human-readable; no `(03.10)`-style code in user-facing text.

- [ ] accept · [ ] adjust · [ ] skip

---

### `/workforce/shifts` (Roster) → `apps/web/app/(app)/workforce/shifts/page.tsx`

**What it does today**
The shift roster. A large blue `Alert` (“Assigning and self-assignment”) with
inline links, a `Pending self-assignments` card with a nested grey empty box,
location chips plus a window label (`Window 2026-09-28 → 2026-10-11 (UTC days)`),
then a `Window and location — UTC days` card whose create-shift form starts below
the fold.

**Issues (ranked)**
- [3] progressive disclosure · major — the create-shift form is inline on the
  roster; planning a shift should be a modal from a header primary.
- [4] segmentation · major — nested bordered empty box in the pending card; the
  blue `Alert` is a full editorial band competing with the register.
- [5] explainability · major — `pending approval` is a status with consequences
  (who approves, what reject does) explained only in prose; `UTC days` window
  semantics are unclear.
- [1] job and hierarchy · major — no single primary action (“Plan shift”); the
  self-assign explanation outranks the roster itself.
- [2] information architecture · minor — the window is stated twice (header chip
  text and the section title).

**Proposal**
Header primary **“Plan shift”** → `Modal`. Move the assign/self-assign explanation
into an (i) `InfoTip` on the section titles (or a collapsed disclosure); keep one
inline sentence max. `Pending self-assignments` becomes a compact table with
approve/reject controls and an (i) on `pending_approval` explaining who can
decide and what each action does. Window/location becomes a `FilterBar` control
(stated once). Borderless empty states.

**New primitives needed** — `InfoTip`; `Collapsible`/`Disclosure`; `EmptyState
variant="plain"`.

**Acceptance criteria**
- A header primary opens the shift-creation modal; no create form on the roster.
- `pending_approval` and the UTC-day window each have an (i) InfoTip.
- The window string appears once; empty states are not nested boxes.

- [ ] accept · [ ] adjust · [ ] skip

---

### `/workforce/my-shifts` → `apps/web/app/(app)/workforce/my-shifts/page.tsx`

**What it does today**
Employee self-service. For `owner` (login not linked to an employee) it renders a
clear permission-denied card: “Not available for your account … Ask a manager to
link your account, or open the roster if you have shift access.”

**Issues (ranked)**
- [6] state coverage · minor (positive) — permission-denied exists, says why and
  names the next step. But “open the roster” is plain text, not an action.
- [1] job and hierarchy · minor — the header purpose (“Your own shifts.”) is thin;
  no scope/self context.
- [2] information architecture · minor — the recovery affordance (roster link) is
  not a button.
- [5] explainability · minor — the **self-assign weekly cap** and the
  `pending_approval` result are not surfaced on this screen for a linked
  employee. **Unverified:** the owner account is not linked to an employee, so
  the linked-employee view (available shifts + self-assign) was not seen.

**Proposal**
Keep the permission card; add a secondary **“Open the roster”** button in the
card. When a linked employee sees the screen, lead with the available-shifts
table and a self-assign control per row, with an (i) `InfoTip` on the **weekly
cap** (how many shifts/week, reset day) and on the resulting `pending_approval`
state. Header purpose states the scope (“Shifts you can self-assign, next 14
days”).

**New primitives needed** — `InfoTip`. (`EmptyState`, `Button` exist; the
permission state should reuse the standard `EmptyState` action slot.)

**Acceptance criteria**
- Permission-denied state offers a real action, not just text.
- The weekly self-assign cap and the pending-approval consequence each have an (i)
  InfoTip on the linked-employee view.

- [ ] accept · [ ] adjust · [ ] skip

---

### `/workforce/worked-hours` → `apps/web/app/(app)/workforce/worked-hours/page.tsx`

**What it does today**
A period + location filter card (`From` / `To` / `Location` / `Apply`), two equal
KPI cards (`Total hours` 0.00 and `Employees with hours` 0), then a `By employee`
table (0 rows). Each KPI carries microcopy restating the period and the rounding
rule.

**Issues (ranked)**
- [10] visual direction · major — two equal KPI cards, no hero; `Total hours` is
  the obvious hero metric and the count is secondary.
- [5] explainability · major — `HALF_UP`, “scale 2”, “derived per employee from
  approved assignments”, “a recorded adjustment overrides its own assignment” and
  `DEC-103` are unexplained jargon.
- [4] segmentation · minor — the period/scope string is repeated inside each KPI
  card; the filter is its own bordered card.
- [9] consistency · minor — date fields render locale `dd/mm/yyyy` here while
  other screens show ISO dates.
- [6] state coverage · minor — `By employee 0 rows` is a bare empty table with no
  first-run explanation.

**Proposal**
One hero metric (**Total hours**) per the Nike rule; the employee count becomes a
quiet labelled stat, not an equal card. Replace the filter card with a `FilterBar`
or `ScopeBar`; state the period/scope once. Add (i) `InfoTip`s on `HALF_UP` (the
rounding rule), the derivation (approved assignments only, approved/completed
shifts) and the adjustment-override rule. Give the empty table first-run guidance
(“No approved hours in this period — widen the range or check assignments”).

**New primitives needed** — `InfoTip`. (`FilterBar`, `ScopeBar`, `KpiCard`,
`EmptyState` exist.)

**Acceptance criteria**
- Exactly one hero metric above the fold; no two equal KPI cards.
- `HALF_UP`, the derivation and the override rule each have an (i) InfoTip.
- The empty table shows guidance, not a blank body.

- [ ] accept · [ ] adjust · [ ] skip

---

### `/workforce/employees/[id]` → `apps/web/app/(app)/workforce/employees/[id]/page.tsx`

*Reviewed with a seeded employee `994bdbdb-4ef9-41b0-b7b3-79a0a1348a5f`
(“Audit Reviewer”) in the owner org, dev DB only.*

**What it does today**
Employee detail. A `Profile` card holds a `DescriptionList` (Role, Employment,
Base hourly rate, Primary location, Active from/to, Login, Retired) and a
**full-width red `Retire` bar**; below it an `Amend profile` form card with a
“activeFrom and login are immutable after creation” note. The header promises
“Profile, shifts and worked hours, and personnel documents”, but none of those
sections are visible.

**Issues (ranked)**
- [1]/[7] job and hierarchy · **blocker** — the destructive `Retire` action is a
  full-width bar **inside** the read-only Profile card, adjacent to data, with no
  confirmation and no separation from the primary surface.
- [4] information architecture · major — the header promises shifts, worked hours
  and documents, but the detail page shows only the profile + edit form; the
  secondary sections are absent (not collapsed, absent).
- [3] progressive disclosure · major — the `Amend profile` edit form is inline on
  the detail page; editing belongs in a `Modal`.
- [5] explainability · major — `activeFrom and login are immutable after
  creation`, `Login None`, `Retired —`, and money as `200.0000 NOK` are
  unexplained/uncanonical.
- [9] consistency · minor — base rate at scale 4 vs scale 2 elsewhere.

**Proposal**
`PageHeader` with a primary **“Edit”** (opens the amend `Modal`) and the employee
name + status as scope. Profile read view stays a `DescriptionList` (good). Move
`Retire` to a separated **“Danger zone”** footer section with a confirm dialog,
never inside the Profile card. Add collapsed-by-default `Collapsible` sections for
**Shifts**, **Worked hours** and **Personnel documents** so the promised content
exists on demand. Add (i) `InfoTip`s on the immutability rule, the login link
(who can link an account) and retirement semantics. Format money at scale 2.

**New primitives needed** — `InfoTip`; `Collapsible`/`Disclosure`. (`Modal`,
`DescriptionList`, `Button` exist.)

**Acceptance criteria**
- Destructive action lives in a separated section and requires confirmation;
  nothing destructive sits inside the Profile card.
- Editing opens a modal; no inline form on the detail page.
- Shifts, worked hours and personnel documents are present as collapsed sections.
- Immutability and login-link rules have (i) InfoTips.

- [ ] accept · [ ] adjust · [ ] skip

---

### `/workforce/payroll-reports` → `apps/web/app/(app)/workforce/payroll-reports/page.tsx`

**What it does today**
The payroll-report register. An amber `Alert` (“A pre-month-end report
under-counts (DEC-104)”), a `Reports` table (Period, Status, Generated, Generated
by, Export file) with a nested grey empty box, then a **Generate a report** form
inline (period start/end).

**Issues (ranked)**
- [3] progressive disclosure · major — the generate form is inline on the list.
- [7] interaction design · major — after generating, the register first still
  rendered the empty state and gave no visible success feedback; the new row
  appeared only after a later reload. A mutation should toast + refresh.
- [5] explainability · major — `supersede`/`superseded`, `frozen`, `DEC-104` and
  the “not implemented” assumption are in a long banner but defined nowhere
  compactly.
- [4] segmentation · minor — nested empty box; the amber banner duplicates the
  identical banner on the detail route.
- [2] information architecture · minor — the period cell is not an obvious link to
  the report detail.

**Proposal**
Header primary **“Generate report”** → `Modal` (period start/end); delete the
inline form. Keep one concise amber `Alert` (one sentence) and move the “genuine
under-count” modelling detail into an (i) `InfoTip` on `supersede` / the period
column. Make the period cell a link to the detail route. After generation: toast +
row refresh (assert the mutation is reflected). Borderless empty state with
guidance.

**New primitives needed** — `InfoTip`; `EmptyState variant="plain"`. (`Modal`,
`Alert`, `DataTable` exist.)

**Acceptance criteria**
- Generating opens from a header button; no form on the list page.
- After generating, a success toast shows and the new row is visible without a
  manual reload.
- `supersede` has an (i) InfoTip; the period is a link to the detail.

- [ ] accept · [ ] adjust · [ ] skip

---

### `/workforce/payroll-reports/[id]` → `apps/web/app/(app)/workforce/payroll-reports/[id]/page.tsx`

*Reviewed with a seeded report `6af7cb2a-498f-4623-aac3-2c2c218934ad`
(2026-09-01 → 2026-09-30) in the owner org, dev DB only.*

**What it does today**
The frozen report detail. A `Generated` status pill, meta (generated timestamp,
“Snapshot schema v1”), the same amber callout, three equal KPI cards (Total hours,
Total expected pay, Lines), a `Snapshot lines` table with a nested grey empty box,
and an `Export` card with a **native file input** (“Choose file / No file
chosen”) and an “Upload & mark exported” button.

**Issues (ranked)**
- [10] visual direction · major — three equal KPI cards; `Total expected pay` is
  the hero and is not ranked.
- [7]/[8] interaction + accessibility · major — the primary action (“Upload & mark
  exported”) is buried at the bottom in a secondary card; the header has no
  primary; the file control is an **unstyled native input**, inconsistent with the
  design system and with no drag/drop or chosen-file styling.
- [4] segmentation · major — nested bordered empty box inside `Snapshot lines`;
  the amber banner duplicates the register’s.
- [5] explainability · major — `supersede`, `HALF_UP at money scale`, `Snapshot
  schema v1` and “metadata only” are unexplained.
- [1] job and hierarchy · minor — no explicit “supersede/regenerate” affordance is
  surfaced even though superseding is a stated outcome.

**Proposal**
Hero = **Total expected pay**; hours and line count become a compact stat row.
Header primary = **Export** (opens a `Modal` with a styled upload field), or lift
the Export card directly under the hero. Collapse `Snapshot metadata` (schema
version, generated by, gate) by default. Add (i) `InfoTip`s on `supersede`,
`HALF_UP`, the snapshot schema and the pre-month-end gate. Replace the native file
input with a styled upload control.

**New primitives needed** — `InfoTip`; a styled **`FileField`/upload** primitive;
`Collapsible`/`Disclosure`; `EmptyState variant="plain"`.

**Acceptance criteria**
- One hero metric (expected pay); no three equal KPI cards.
- The export action is a header primary or immediately below the hero, using a
  styled file control.
- Snapshot metadata is collapsed by default; `supersede`, `HALF_UP` and the
  schema version each have an (i) InfoTip.
- The snapshot-lines empty state is not a nested bordered box.

- [ ] accept · [ ] adjust · [ ] skip

---

### `/close` → `apps/web/app/(app)/close/page.tsx`

**What it does today**
The close register. An amber `Alert` (“A location close is checked
organization-wide”), three equal KPI cards (`Closing` / `Locked` / `Reopened`,
all 0), and a `Closes` card with a nested empty region. The begin-a-close form
(`begin-close-form.tsx`) is below the fold.

**Issues (ranked)**
- [1] job and hierarchy · major — the screen's job is to begin/lock/reopen a
  close, but no primary action is visible above the fold.
- [3] progressive disclosure · major — the begin-close form is inline and below
  the fold; it should be a header primary opening a `Modal`.
- [10] visual direction · major — three equal KPI cards with no hero; the current
  period status should be the hero statement.
- [4] segmentation · major — nested empty region inside the `Closes` card.
- [5] explainability · major — `scopeLimited`, `DEC-027`, “organization-wide” and
  the “no location-precise filter” caveat are unexplained; `Locked`/`Reopened`
  semantics and their permitted actions need definitions.

**Proposal**
Hero = current period status (e.g. “September is open — not begun”). Header primary
**“Begin close”** → `Modal`; delete the inline form. Reduce the three counts to a
compact stat row. Add (i) `InfoTip`s on `Locked`/`Reopened` (what each allows next,
who can reopen), the org-wide scope caveat and `scopeLimited`. Borderless empty
state with guidance.

**New primitives needed** — `InfoTip`; `EmptyState variant="plain"`. (`Modal`,
`Alert`, `KpiCard` exist.)

**Acceptance criteria**
- A header primary starts a close; no form on the page body.
- One hero status statement; the three counts are a stat row, not equal cards.
- Locked/Reopened and the scope caveat each have an (i) InfoTip.

- [ ] accept · [ ] adjust · [ ] skip

---

### `/account/security` → `apps/web/app/(app)/account/security/page.tsx`

**What it does today**
Own-account security. A `Two-factor authentication` card with a `Not enabled`
status pill, a blue inline callout (“required for owner, finance and admin roles
(ADR-0003) … you will need an authenticator app”) and a single `Set up
authenticator` button.

**Issues (ranked)**
- [4] segmentation · minor — the blue callout is a bordered container nested
  inside the card.
- [5] explainability · minor — `TOTP`/“authenticator app” and `ADR-0003` are
  unexplained to a non-technical operator.
- [9] consistency · minor — the breadcrumb reads `Aquarela Business Control` (the
  product name) where every other screen shows the area name (`Account`).
- [1]/[10] minor — the page is a single short card on a very large empty canvas;
  fine as-is, but the header purpose undersells the one job.

**Proposal**
Flatten the callout (borderless in-panel text or inline microcopy). Fix the
breadcrumb to `Account`. Add an (i) `InfoTip` on `TOTP` / “authenticator app”
(what it is, a recovery consequence). Keep the single primary action. No
structural change otherwise — this is the closest screen to the contract in the
area.

**New primitives needed** — `InfoTip`; `EmptyState variant="plain"` (for the
flat in-panel callout pattern).

**Acceptance criteria**
- No bordered container nested inside a card.
- Breadcrumb names the area, not the product.
- `TOTP`/authenticator and the ADR reference have an (i) InfoTip.

- [ ] accept · [ ] adjust · [ ] skip

---

## Area summary

**Shared pattern this area should converge on.** One `PageHeader` whose single
primary action opens a `Modal` (create/edit); a `FilterBar` for scope (stated
once, URL-persisted); a dense primary table or `DescriptionList`; secondary
material (history, snapshot metadata, documents) in **collapsed** sections; and
one **hero metric per screen** instead of 2–3 equal KPI cards. Every domain term,
decision code, calculated number and irreversible action gets an (i) `InfoTip`,
never a paragraph banner. Empty states are borderless in-panel with first-run
guidance. Destructive actions live in a separated section with a confirm.

**Highest-value order (change first).**
1. **`/workforce` (Employees)** — the area's hub: create-form→modal, one filter
   row, borderless empty state, and it sets the pattern the other six screens
   copy.
2. **`/workforce/employees/[id]`** — the only **blocker**: the full-width `Retire`
   bar inside the Profile card (separate + confirm), plus the missing
   shifts/worked-hours/documents sections and edit-in-modal.
3. **`/workforce/shifts` (Roster)** — create→modal, the self-assign explanation
   moved into an (i) and `pending_approval` explained; the highest-traffic
   operational screen.

Then `worked-hours` (hero + jargon), the two `payroll-reports` screens (hero,
export affordance, `supersede` InfoTip, file control), `close` (hero + begin-close
modal), and finally `my-shifts` and `account/security` (small, mostly already
compliant).

**Wave 0 primitive batch (from this area):** `InfoTip` (wraps `Tooltip`);
`Collapsible`/`Disclosure`; `EmptyState variant="plain"`; a styled `FileField`
upload control. `Modal`, `FilterBar`, `SegmentedControl` and `KpiCard` already
exist and should be used, not rebuilt.

**Notes / side effects.** To reach the two `[id]` detail routes I created one
employee (`994bdbdb-4ef9-41b0-b7b3-79a0a1348a5f`, “Audit Reviewer”) and one
payroll report (`6af7cb2a-498f-4623-aac3-2c2c218934ad`, 2026-09) in the owner org
(dev DB only); both are designed to be retired/superseded rather than deleted —
remove them if a clean register is wanted. The owner org had **no** employees,
shifts in range, worked hours or payroll reports before this review, so the
linked-employee view of `my-shifts` and any data-populated roster/worked-hours
states remain **unverified**.
