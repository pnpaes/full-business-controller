# UX review — area `production`

Date: 2026-09-28 · Reviewer: ux-designer (audit-only) · Lens: `ux-screen-review` · Contract: `docs/ux/README.md`

Screens reviewed (3/3): `/production`, `/production/plans`,
`/production/batches/[batchId]` (real id
`30000000-0000-4000-8000-000000000002`). Each opened in a browser as `owner`,
screenshotted to `storage/tmp/inv-*.png`, and the PNG read before judging.

State coverage actually seen: **with data** (owner role); the batch reviewed is
`Completed`, the plan `Planned`, no `in_progress` batch exists. **Not seen:**
empty, loading, error, permission-denied, and the **Complete batch** form (it
renders only for an `in_progress` batch — its copy was read from
`batch-actions.tsx` and is cited below).

No `InfoTip`/`Tooltip` in `production/**`. Both list screens leak **internal
product-manager notes into user-visible microcopy** — "there is no tolerance
threshold configured yet (PROD-003 open point)" (board subtitle) and "The plan
status stays free text (open point (f))" (plans subtitle). These are
implementation open points, not user guidance.

---

## `/production` → `apps/web/app/(app)/production/page.tsx`

**What it does today.** "Production board": four equal KPI cards (Planned,
Released, In progress, Completed), a status tab row (All / Planned / Released /
In progress / Completed / Cancelled), a batch table grouped by status (Recipe ·
Batch, Location, Planned → Actual output, Yield variance, Planned start), and a
"Plan a batch" create form at the bottom. The subtitle explains PROD-003.

**Issues (ranked)**

1. `[10] visual direction` · **major** — **four equal KPI cards with no hero**,
   and the same four numbers are repeated immediately as the status tabs — the
   KPI band and the tab row are the same information twice. Classic "five equal
   cards, no rank" trigger; status belongs in the tabs, not also in a KPI wall.
2. `[5] explainability` · **major** — the subtitle exposes an internal open point
   ("PROD-003 open point"); "Yield variance" (`0.00%`) has no (i) stating it is a
   stored fact with no configured tolerance. Also `DEMO_G` unit codes and
   "Planned → Actual output" are unexplained.
3. `[3] progressive disclosure` · **major** — "Plan a batch" is a create form on
   the board; move to a `Modal` behind the header primary action.
4. `[1] job and hierarchy` · **minor** — the screen has no single stated job or
   primary action in the header; the two jobs ("see today's board", "start a
   batch") compete with nothing marking which is primary.
5. `[9] consistency` · **minor** — the status filter is a custom tab row here
   while other areas use `Tabs`/`SegmentedControl`; verify it is the same control.

**Proposal.** Keep one hero metric (e.g. "In progress" or "Batches today") and
drop the four-card KPI wall; let the status tabs be the only status affordance.
Add the header primary "Plan a batch" → `Modal`. Add `InfoTip`s on "Yield
variance" (stored fact, no tolerance configured — reference PROD-003 in docs, not
in the subtitle) and on the output column. Move the open-point sentence out of
the UI.

**New primitives needed.** `InfoTip`; `Modal` (reuse).

**Acceptance criteria.**
- One hero metric; status appears once (tabs), not duplicated as cards.
- No `PROD-0xx open point` text in user-visible copy.
- (i) on yield variance explaining the stored-fact/no-tolerance rule.
- "Plan a batch" is a modal from the header.

- [ ] accept · [ ] adjust · [ ] skip

---

## `/production/plans` → `apps/web/app/(app)/production/plans/page.tsx`

**What it does today.** A `Board | Plans` segmented control, a single full-width
"Plans shown `1`" metric card, a Plans table (Production date, Location, Lines,
Status, Created), and a "Create a plan" form at the bottom. Subtitle states the
plan status stays free text (open point (f)).

**Issues (ranked)**

1. `[10] visual direction` · **major** — "Plans shown 1" occupies an entire
   full-width card for a single integer. This is the inverse of the board's
   problem: a card so empty it reads as an error. Either fold the count into the
   section header ("Plans · 1 plan") or make it a proper hero with more context
   (planned batches, next production date).
2. `[3] progressive disclosure` · **major** — "Create a plan" is a create form on
   the register; move to a `Modal` behind the header primary.
3. `[5] explainability` · **major** — status `Planned` is a free-text value with
   no (i) (the subtitle even says so, as an internal note); "Lines" showing `—`
   for a plan with a linked batch is unexplained (is a line a recipe version ×
   qty, and where do I add one?).
4. `[1] job and hierarchy` · **minor** — two navigation affordances (the
   `Board | Plans` segmented control) plus a page header, with the create form
   below the register and no header primary.
5. `[9] consistency` · **minor** — the `Board | Plans` control is a different
   pattern from the board's own status tabs, so the area's two screens do not
   share one sub-navigation model.

**Proposal.** Header primary "Create a plan" → `Modal`; fold "Plans shown" into
the section header. Add `InfoTip`s on the status value and on the Lines column
(recipe version × planned quantity — see DEC-125). Use one sub-navigation control
across `/production` and `/production/plans`. Remove the open-point sentence from
the UI.

**New primitives needed.** `InfoTip`; `Modal` (reuse); `Collapsible` (optional,
for plan history).

**Acceptance criteria.**
- The lone full-width count card is gone (folded into the section header or made
  a real hero with context).
- "Create a plan" is a modal from the header.
- (i) on status and Lines; no internal open-point text in the UI.
- One consistent sub-navigation control across board and plans.

- [ ] accept · [ ] adjust · [ ] skip

---

## `/production/batches/[batchId]` → `apps/web/app/(app)/production/batches/[batchId]/page.tsx`

*(Reviewed the completed batch `30000000…0002`. The `CompleteBatchForm` renders
only for an `in_progress` batch; its copy was read from `batch-actions.tsx`.)*

**What it does today.** Batch detail: `PageHeader` ("Batch · Demo House Blend",
scope = location + batch id), a `Board | Plans` segmented control, **five equal
KPI cards** (Status, Planned quantity, Planned output, Actual output, Yield
variance), a Batch `DescriptionList`, and — for an eligible batch — the "Complete
batch" form (draw inputs from, per-input actual qty with a required variance
reason, actual output, labour hours, output lot/expiry) whose consequence
paragraph starts *"Completion posts one atomic movement batch — consumption
negative, output positive — and cannot be edited. A mistake is corrected by a
reversal (DEC-028)…"* and which sits **below** the "Complete and post" button.

**Issues (ranked)**

1. `[7] interaction design` · **major** — **the completion consequence is below
   the button.** Identical to `/inventory/waste`: the one sentence that matters
   ("posts one atomic movement batch … cannot be edited") renders *after* the
   submit control. Move it above the button or into an (i) on it, and add a
   confirmation for an irreversible posted write.
2. `[10] visual direction` · **major** — **five equal KPI cards** in one row
   (Status + four metrics), competing equally; Status is a state, not a metric,
   and should be a `StatusPill`; the four quantities/outputs should be one hero
   + supporting. This is the densest card wall in the three areas.
3. `[5] explainability` · **major** — `Planned quantity` renders `—` with meta
   "Single recipe batch (DEC-125)" — an em-dash with an internal decision id as
   its only explanation. "Yield variance `0.00%`" needs an (i) (stored fact, no
   tolerance — PROD-003). "Draw inputs from" help text exposes an open point
   ("open point (e)").
4. `[3] progressive disclosure` · **minor** — for a `Completed` batch the whole
   screen is provenance; the Batch `DescriptionList` and movement detail should
   be collapsible, leaving status + yield at a glance.
5. `[9] consistency` · **minor** — the `Board | Plans` control here duplicates
   the area navigation and differs from the board's status tabs.

**Proposal.** Reorder the Complete form so the ledger-effect sentence precedes
the "Complete and post" button and the action confirms. Replace the five-card
wall with a `StatusPill` + one hero (Yield variance or Actual output) + a compact
supporting row. Add `InfoTip`s on Yield variance and on Planned quantity
(explain the `—`: batch planned from a plan line vs a single recipe batch).
Strip open-point references from help text. Collapse provenance for terminal
batches.

**New primitives needed.** `InfoTip`; `Collapsible`.

**Acceptance criteria.**
- The completion consequence (atomic movement batch, irreversibility, reversal
  path) is visible before the button, and the button confirms.
- Status is a pill; at most one hero metric, not five equal cards.
- (i) on yield variance and planned quantity; no open-point text in help.
- A completed batch shows status + yield first; provenance collapses.

- [ ] accept · [ ] adjust · [ ] skip

---

## Area summary — `production`

**Pattern this area must share.** A board whose status lives in one filter
control (not duplicated as equal KPI cards); a single hero metric per screen; one
consistent `Board | Plans` sub-navigation; every create ("Plan a batch", "Create
a plan") a **Modal** from the header primary; and the **Complete batch** write
showing its atomic-movement consequence **above** the button with a confirm.
Internal open points (PROD-003, open point (e)/(f)) must be removed from
user-visible microcopy and explained in docs instead.

**Highest-value screens, changed first.**

1. `/production/batches/[batchId]` — the five-card wall and the completion
   consequence placement; the batch complete is the area's only stock-fact write.
2. `/production` — duplicate status (cards + tabs) and the subtitle open-point.
3. `/production/plans` — the empty full-width count card and the create form.

**Wave 0 dependencies.** `InfoTip`, `Collapsible`.
