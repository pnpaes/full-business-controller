# UX review — area `inventory`

Date: 2026-09-28 · Reviewer: ux-designer (audit-only) · Lens: `ux-screen-review` · Contract: `docs/ux/README.md`

Screens reviewed (7/7): `/inventory`, `/inventory/[itemId]`, `/inventory/counts`,
`/inventory/counts/[countId]`, `/inventory/transfers`, `/inventory/transfers/[id]`,
`/inventory/waste`. Each opened in a browser as `owner`, screenshotted to
`storage/tmp/inv-*.png`, and the PNG read before judging. A second count variant
(approved vs cancelled) and the waste form were also captured.

State coverage actually seen: **with data** only (seed data, owner role).
**Not seen:** empty, loading, error, permission-denied. Mutation CTAs for the
movement flows (approve count, receive transfer) are **not reachable in the
current data** — every count is approved/cancelled, the only transfer is already
received. Their copy was read from source and is cited below; a live run needs a
draft count and a dispatched transfer.

Focus dimensions for this area: **[7] interaction design** on the stock-fact
writes (approve / receive / record waste), **[3] progressive disclosure** on the
three long registers, **[5] explainability** for lot, cost and negative-stock.

No `InfoTip` and no `Tooltip` is used anywhere in `inventory/**` — every
explanation today is an inline paragraph or a `help=` string (verified by grep).

---

## `/inventory` → `apps/web/app/(app)/inventory/page.tsx`

**What it does today.** Register of on-hand balances by item/location/storage
area/lot with three KPI cards (Stock value, Items with stock, Lots expiring ≤30d)
and a single dense Balances table. Three quiet header links (Counts, Transfers,
Waste) act as the section's navigation. `post-movement-form` /
`register-storage-area-form` also live on this route.

**Issues (ranked)**

1. `[3] progressive disclosure` · **major** — manual `post-movement` and
   `register-storage-area` are creation forms sitting on a read register. The
   README trigger "a create/edit form on a list screen → move to a modal" fires
   twice here. A register should not own two create forms.
2. `[5] explainability` · **major** — the table mixes `No lot`, a raw unit code
   (`DEMO_G`), `VALUE (NOK)` and `AVG UNIT COST (NOK)` with no (i) for "moving
   weighted average" (repeated verbatim in every KPI meta) or "lot". The
   DEC-008 reference is legible to the team, not to a new operator.
3. `[7] interaction design` · **minor** — the header links (Counts/Transfers/
   Waste) are the only way into the sub-registers; they are styled as quiet
   buttons and do not read as primary navigation, and there is no "current
   section" indication.
4. `[10] visual direction` · **minor** — three equal KPI cards, no hero. Stock
   value is the obvious hero statement; the other two are supporting.

**Proposal.** Keep the Balances table as the single primary section. Move manual
movement + storage-area creation into a single primary "Adjust stock" button
opening a `Modal` with tabs (Movement / Storage area). Add an `InfoTip` on
"moving weighted average" (first KPI meta) and on the `LOT` column header
(no-lot vs lot, why a lot exists). Make Counts/Transfers/Waste a `Tabs` control
or `Breadcrumbs`-style sub-nav so the area reads as one section. Promote Stock
value to the hero KPI band (1 large + 2 supporting).

**New primitives needed.** `InfoTip`; `Collapsible` (for the secondary
storage-areas table).

**Acceptance criteria.**
- No create form is rendered directly on `/inventory`; both live in a modal.
- An (i) on the moving-average term and on the LOT header, hover/focus
  reachable, definition matches the calculation contract.
- Sub-registers are navigable as a visible section control with current state.

- [ ] accept · [ ] adjust · [ ] skip

---

## `/inventory/[itemId]` → `apps/web/app/(app)/inventory/[itemId]/page.tsx`

**What it does today.** Item stock position: three KPIs (Stock value, Quantity
on hand, Average unit cost), a one-row Balances table with a footer note, and a
Movement history table below.

**Issues (ranked)**

1. `[5] explainability` · **major** — the item-level "Lot" column shows only
   `No lot` for this item, so the lot concept is never demonstrated; "Negative
   stock / low-stock status" is explained only by a footer paragraph stating the
   reorder threshold is not in the read model. A negative or below-zero balance
   would render with no visual cue and no explanation.
2. `[3] progressive disclosure` · **major** — Movement history (6 rows, growing
   forever) is a full second table on the same screen as Balances; history is
   the textbook "on demand" section and should be collapsible/tabbed.
3. `[10] visual direction` · **minor** — three equal KPI cards again; Stock value
   or Quantity on hand should be the hero.
4. `[5] explainability` · **minor** — "A reversal is an exact offset and cannot
   itself be reversed" is important domain semantics buried in table microcopy.

**Proposal.** Keep KPIs + one-row Balances as the at-a-glance band. Move Movement
history into a `Collapsible` (collapsed by default) or a tab. Add `InfoTip`s on
"moving weighted average" (Average unit cost) and on "reversal" in the history
header. Define a negative-balance treatment (error-toned value + (i) explaining
that stock cannot go negative / what a negative implies) even if the state is
currently unreachable.

**New primitives needed.** `InfoTip`; `Collapsible`.

**Acceptance criteria.**
- Movement history is collapsed by default and does not push KPIs off-screen.
- A negative or zero quantity has a defined, documented rendering with (i).
- (i) on moving weighted average and reversal.

- [ ] accept · [ ] adjust · [ ] skip

---

## `/inventory/counts` → `apps/web/app/(app)/inventory/counts/page.tsx`

**What it does today.** Stock-count register: KPIs (Open / Approved / Total),
a two-row Counts table (location, cutoff, status, blind, lines/counted,
variances) and an "Open a count" create form at the bottom of the same page.

**Issues (ranked)**

1. `[3] progressive disclosure` · **major** — "Open a count" (cycle count) is a
   create form on the register; move it to a `Modal` behind the single primary
   "Open a count" action in the `PageHeader`. README trigger fires.
2. `[5] explainability` · **major** — status values `Cancelled`/`Approved` use
   coloured dots with no (i); "Blind" is a bare word; "Variances: hidden" is
   unexplained. Cutoff is printed as a raw instant with no timezone note.
3. `[1] job and hierarchy` · **minor** — the screen's one job is "find and open
   the current count", but the primary action (open a count) is at the page
   bottom rather than in the header; there are really two jobs competing.
4. `[3] progressive disclosure` · **minor** — "Lines / Counted" and "Variances"
   columns are hidden for blind counts and carry no explanation of the blind
   rule inline.

**Proposal.** Header gets one primary "Open a count" → `Modal`. Keep the table as
the primary section. Add `InfoTip`s on: "Blind" (why quantities are hidden until
approval), "Variances", and each status value (who can change it, what it means).
Move the "hidden until approval" rule into the column, not a legend.

**New primitives needed.** `InfoTip`; `Modal` (exists — reuse).

**Acceptance criteria.**
- No create form on the register page; opening a count happens in a modal.
- Every status value and the word "Blind" have an (i) reachable by hover/focus.
- The blind-count column rule is explained at the point of use.

- [ ] accept · [ ] adjust · [ ] skip

---

## `/inventory/counts/[countId]` → `apps/web/app/(app)/inventory/counts/[countId]/page.tsx`

*(Reviewed both states available: this route's cancelled count (`02b6d7a8…`) and
approved count (`20000000…`).)*

**What it does today.** Count detail: Status hero KPI, Lines counted, Variances,
a blue banner explaining blind counts, a Variance review table (expected /
counted / variance / reason / recount), and — for approved counts — a green
success `Alert`. The Approve form (`count-actions.tsx`) renders an explanatory
paragraph, a conditional "Unit cost for positive variances" field with `help`,
a Reason field, and the primary "Approve and post variances" button. `Cancel
count` is a secondary button next to it.

**Issues (ranked)**

1. `[7] interaction design` · **major** — **approve consequence is not surfaced
   at the trigger.** The consequences ("posts one count adjustment movement per
   non-zero variance", "not reversible by editing — a correction is a reversal")
   are in a plain paragraph above the fields, and the ledger effect is not on or
   near the button. There is **no confirmation step** before a post-once,
   irreversible stock write. The screen must state, at the button, exactly which
   movements will be posted and that it cannot be undone.
2. `[7] interaction design` · **major** — `Approve` (primary, irreversible) and
   `Cancel count` (secondary) render in adjacent sections with no separation or
   confirm; the contract requires destructive actions to live apart and confirm.
3. `[5] explainability` · **major** — no `InfoTip` on "count adjustment", "blind
   count", "variance" or "expected". The "Unit cost for positive variances" help
   text explains the fallback but not the valuation basis (which average, which
   date) — that lives only in DEC-008.
4. `[3] progressive disclosure` · **minor** — "Variance review" and the approve
   form are stacked full-width sections; once approved the Variance review table
   becomes provenance and should collapse.
5. `[9] consistency` · **minor** — the approve control is a bespoke `SectionCard`
   form rather than the modal/inline pattern used elsewhere.

**Proposal.** Keep the KPI band + blind-count banner. The approve action becomes
a `Modal` (or inline confirm panel) whose body states the ledger effect verbatim
— *"Posts N count-adjustment movements … valued at the moving weighted average.
This cannot be edited; a correction is a reversal (DEC-028)."* — with the unit
cost and reason fields inside and a required confirm. Move `Cancel count` away
from `Approve` (quiet, behind a "…" menu or its own section) with its own confirm.
Add `InfoTip`s on "count adjustment", "blind count" and "variance". After
approval, collapse Variance review.

**New primitives needed.** `InfoTip`; a confirm pattern (reuse `Modal`).

**Acceptance criteria.**
- The exact ledger effect (movement count, valuation basis, irreversibility) is
  visible in the same view as the approve button, before it can be pressed.
- Approve requires an explicit confirmation; `Cancel count` is not adjacent to
  the primary and confirms.
- (i) on count adjustment, blind count, variance.
- Once approved, provenance collapses and the success alert states the reversal
  path (already present — keep).

- [ ] accept · [ ] adjust · [ ] skip

---

## `/inventory/transfers` → `apps/web/app/(app)/inventory/transfers/page.tsx`

**What it does today.** Transfers register: KPIs (Transfers / In transit /
Discrepancies), a one-row table (from, to, status, dispatched, received,
discrepancy, `Open` link) and a "Request a transfer" create form at the bottom.

**Issues (ranked)**

1. `[3] progressive disclosure` · **major** — "Request a transfer" is a
   multi-field create form (from location/area, to location/area, lines) on the
   register. Move to a `Modal` behind the header primary action.
2. `[5] explainability` · **major** — "In transit" (virtual holding point),
   "Discrepancy" and the status value `received` have no (i). The transit concept
   is the least obvious in the area and is stated only in the page subtitle.
3. `[7] interaction design` · **minor** — quantities render as `250.000000`
   (6 dp) and `Dispatched / Received` are movement-derived totals; a raw
   six-decimal figure with no unit-code suffix hurts scanning and invites
   misreading.
4. `[10] visual direction` · **minor** — three equal KPI cards; "In transit"
   (the actionable number) should be the hero when non-zero.

**Proposal.** Header primary "Request a transfer" → `Modal`. Keep the table;
format quantities to the item's base-unit precision. Add `InfoTip`s on "In
transit", "Discrepancy" and status. Make `Open` the row's only action and keep it
as is.

**New primitives needed.** `InfoTip`; `Modal` (reuse).

**Acceptance criteria.**
- No create form on the register; requesting a transfer is a modal.
- (i) on in-transit, discrepancy and status.
- Quantities are formatted to a sane precision with unit code.

- [ ] accept · [ ] adjust · [ ] skip

---

## `/inventory/transfers/[id]` → `apps/web/app/(app)/inventory/transfers/[id]/page.tsx`

*(Reviewed the received transfer `11111111…`. The request/approve/dispatch/receive
CTAs render only for other statuses; their copy was read from
`transfer-actions.tsx`.)*

**What it does today.** Transfer detail: one-line status + route + timestamps
under the header, three KPIs (Dispatched / Received / Discrepancy), a Lines
table, and a Workflow section. For a `dispatched` transfer the receive form
prefills the dispatched quantity, offers a "Discrepancy note", and submits
"Receive transfer"; success copy says a difference is recorded as a discrepancy.
The received state shows "This transfer is received; no further action is
available."

**Issues (ranked)**

1. `[7] interaction design` · **major** — **the receive form does not state the
   consequence at the trigger.** The form paragraph explains *how* to enter the
   figure ("change it only when the delivery differs") but not *what happens* on
   a difference — that a discrepancy is recorded against the transfer and the
   receiving line posts at the source valuation. This is a stock-fact write; the
   effect must be visible before submitting.
2. `[5] explainability` · **major** — "Discrepancy" (KPI and column) has no (i);
   the transit-elimination rule ("the transit leg is eliminated in a
   consolidation") is header prose a reader will not retain.
3. `[3] progressive disclosure` · **minor** — Lines (1 row) + Workflow are
   stacked full-width cards; for a terminal state the whole detail is provenance.
4. `[10] visual direction` · **minor** — three equal KPI cards; Discrepancy
   (Yes/No) is a status, not a metric, and competes equally with the quantities.

**Proposal.** On the receive form, replace the paragraph with: an `InfoTip` on
"Received" stating the valuation basis and that a difference posts a discrepancy
movement; and a short inline line above the button — *"Any difference from the
dispatched quantity is recorded as a discrepancy on this transfer."* Demote
Discrepancy from a KPI card to a `StatusPill`. Collapse Lines/Workflow once the
transfer is received.

**New primitives needed.** `InfoTip`; `Collapsible`.

**Acceptance criteria.**
- The receive form states the ledger effect (discrepancy movement, valuation
  basis) in the same view as the submit button.
- (i) on received and discrepancy.
- Discrepancy is a status affordance, not a third equal KPI card.

- [ ] accept · [ ] adjust · [ ] skip

---

## `/inventory/waste` → `apps/web/app/(app)/inventory/waste/page.tsx`

**What it does today.** Waste register: KPIs (Waste events / Waste value, both
scoped "newest 50"), a Waste log table (date, item, quantity, stage, reason,
value) and a "Record waste" fast-entry form at the bottom. The form has a
`help=` string under every field and a consequence paragraph **below** the
"Record waste" button: "Recording posts a negative waste movement to the
append-only ledger at the locked moving weighted average (DEC-008); a mistake is
corrected by a reversal, never by editing a row."

**Issues (ranked)**

1. `[7] interaction design` · **major** — **the consequence is below the button.**
   The single most important sentence on the screen (it posts an append-only
   ledger movement) sits *after* the submit control; a user reads the button
   before the effect. Move it above the button or into an (i) attached to it,
   and add an explicit confirm for the write.
2. `[3] progressive disclosure` · **major** — "Record waste" is a create form on
   the register. Move it to a `Modal` behind the header primary action.
3. `[5] explainability` · **major** — KPIs are scoped "newest 50" (so they are
   *not* totals) but read as totals; "Stage" values are bilingual
   (`Preparation / Tilberedning`) with no (i) for why, and "moving weighted
   average" / `DEMO_G` are unlabelled.
4. `[10] visual direction` · **minor** — two KPI cards of unequal width for two
   peer metrics; value formatting wraps (`1.76 NOK` breaks the line).

**Proposal.** Header primary "Record waste" → `Modal`. Keep the log as the
primary table. Move the consequence line above the submit and add a confirm.
Add `InfoTip`s on "moving weighted average", "Stage" and the "newest 50"
scope. Format value on one line. Keep the neutral, blame-free stage copy
(DEC-018) — it is good.

**New primitives needed.** `InfoTip`; `Modal` (reuse).

**Acceptance criteria.**
- No create form on the register; recording waste is a modal.
- The ledger-effect sentence precedes the submit control, and the submit
  confirms.
- (i) on moving weighted average, stage, and the KPI "newest 50" scope.

- [ ] accept · [ ] adjust · [ ] skip

---

## Area summary — `inventory`

**Pattern this area must share.** One `PageHeader` per register with the single
primary create action opening a **Modal**; the register table as the only primary
section; every domain term, status and calculated number carrying an **(i)
InfoTip**; and every stock-fact write (post movement, approve count, receive
transfer, record waste) showing its **ledger effect at the trigger, before the
button, with a confirm**.

**Highest-value screens, changed first.**

1. `/inventory/counts/[countId]` and `/inventory/waste` — the two irreversible
   writes whose consequence is currently misplaced (approve) or below the button
   (waste). Fixing these removes the highest-severity risk in the area.
2. `/inventory/transfers/[id]` — receive-form consequence gap.
3. The three registers — pull the create forms into modals (mechanical, unblocks
   the area's consistency).

**Wave 0 dependencies.** `InfoTip` and `Collapsible` primitives (neither exists
in `packages/ui`; `Tooltip` exists but is hover/focus-only and cannot carry
required information).
