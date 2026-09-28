# UX review — area `purchasing`

Date: 2026-09-28 · Reviewer: ux-designer (audit-only) · Lens: `ux-screen-review` · Contract: `docs/ux/README.md`

Screens reviewed (3/3): `/purchasing`, `/purchasing/new`,
`/purchasing/receipts/[id]` (real id `b586ac3c-9e09-49e8-9e1e-ff0ac954a05c`).
Each opened in a browser as `owner`, screenshotted to `storage/tmp/inv-*.png`,
and the PNG read before judging.

State coverage actually seen: **with data** (owner role). **Not seen:** empty,
loading, error, permission-denied, and any receipt lifecycle action — the
reviewed receipt is in `Submitted` state and the only `Accepted` receipt has
lines; no accept/approve control is rendered on the detail route (source
confirmed: `receipts/[id]/page.tsx` contains no `Button`).

No `InfoTip`/`Tooltip` in `purchasing/**`; explanations today are inline
`help=` strings (the `new` form is unusually good at these).

---

## `/purchasing` → `apps/web/app/(app)/purchasing/page.tsx`

**What it does today.** Purchasing overview: two KPIs (Receipts recorded,
Recorded value `1215.00 NOK` with meta "Σ price × received packs on this page"),
a Goods receipts table (Received, Supplier / store, Location, Status, Total), and
a second "Suppliers" register section below (code, name, currency) with its own
create-supplier form. "Record a receipt" is a quiet text link at the top right.

**Issues (ranked)**

1. `[3] progressive disclosure` · **major** — two registers (receipts +
   suppliers) plus a supplier create form on one screen. "Suppliers" is
   configuration provenance, not the screen's job; the README threshold "more
   than ~3 primary sections → split or collapse" is close, and "a create form on
   a list screen → modal" fires for the supplier form.
2. `[1] job and hierarchy` · **major** — the screen's one job is "receive
   deliveries"; its primary action ("Record a receipt") is a quiet link that
   reads as tertiary, not a `PageHeader` primary button. The two KPIs are peers
   with no hero.
3. `[5] explainability` · **major** — one row's Location renders a raw id
   `loc_1_c1cb3a3f33b6` while the other shows `DEMO_CAFE`; status values
   `Submitted`/`Accepted` have no (i) explaining what each means or who changes
   it. "Recorded value — on this page" implies pagination scope with no page
   control visible.
4. `[7] interaction design` · **minor** — a `Submitted` receipt with zero lines
   shows `Total 0.00 NOK` with no hint that it is incomplete; the operator has
   no affordance to finish it from the register.

**Proposal.** Make "Record a receipt" the single `PageHeader` primary (button →
the `/purchasing/new` route, see below). Move the Suppliers register to a
`Collapsible` "Suppliers" section (collapsed by default) and its create form to
a `Modal`. Resolve location codes to their label everywhere (no raw
`loc_…` ids), add `InfoTip`s on `Submitted` / `Accepted`, and label the KPI scope
("this page" → explicit page/total). Promote "Recorded value" to hero.

**New primitives needed.** `InfoTip`; `Collapsible`; `Modal` (exists — reuse).

**Acceptance criteria.**
- Exactly one primary action in the header; Suppliers is collapsed by default and
  its create form is a modal.
- No raw `loc_…` identifier is rendered in the register.
- (i) on both status values; KPI scope states page vs total.

- [ ] accept · [ ] adjust · [ ] skip

---

## `/purchasing/new` → `apps/web/app/(app)/purchasing/new/page.tsx`

**What it does today.** A dedicated route holding the "Record a receipt" form:
`PageHeader` (title, purpose) + a single large bordered form card with Supplier,
Location, Received on, Delivery reference, Price tax basis, then repeating
"Line N" blocks (pack, received qty, price, lot, expiry). Almost every field
carries a `help=` string (e.g. Supplier: "Only known suppliers can append
effective-dated price history"; Location: "Defaults to the location of the most
recent receipt"; Delivery reference: optional).

**Verdict on modal vs full route.** **A full route is the right call here, not a
modal.** The form is long, repeating (N delivery lines), and each line is itself
a sub-form; a modal would be a scroll trap and would fight the line repetition.
The README allows "a modal **or a detail route**", and this is a detail route.
What is wrong is not the route but (a) the register links to it as a quiet text
link rather than a header primary, and (b) the route needs to be discoverable as
a focused task. Do **not** convert to a modal; do tighten the route (below).

**Issues (ranked)**

1. `[4] segmentation` · **major** — **nested bordered containers.** Each "Line 1"
   block is a bordered card inside the bordered form card — two container levels,
   exactly the pattern the contract says to flatten ("avoid nested bordered
   cards"). Use a section band / `FormSection` per line with spacing, not a box
   inside a box.
2. `[5] explainability` · **major** — "Price tax basis", "landed cost", "lot" and
   "expiry" are domain concepts central to the write, explained only when a
   `help=` string happens to exist; the *effect* of recording (that it appends
   price history and posts stock) is never stated on the screen.
3. `[7] interaction design` · **major** — the commit action ("Record a receipt")
   is at the very bottom after all lines; the ledger effect (stock in + price
   history append at record time) is not stated at the trigger, and there is no
   confirm. Same class of gap as `/inventory/waste`.
4. `[9] consistency` · **minor** — the route is the only "new" creation route in
   these three areas; every other create in inventory/production is an inline
   form. One pattern should win (recommendation: keep the route, move the
   others to modals).

**Proposal.** Keep the route and the rich inline `help=`. Replace the nested
"Line N" cards with `FormSection` bands (space, not boxes). Add an `InfoTip` on
"Price tax basis" and "landed cost", and a consequence line **above** the submit
— *"Recording appends effective-dated price history and posts the received
quantities to stock."* — plus a confirm. Keep the route as the single primary
target of `/purchasing`.

**New primitives needed.** `InfoTip`; (no new layout primitive — `FormSection`
already exists).

**Acceptance criteria.**
- No bordered card is nested inside another on the route.
- (i) on price tax basis and landed cost.
- The ledger effect + price-history append is stated before the submit, and the
  submit confirms.
- Reached from the `/purchasing` header primary, not a quiet text link.

- [ ] accept · [ ] adjust · [ ] skip

---

## `/purchasing/receipts/[id]` → `apps/web/app/(app)/purchasing/receipts/[id]/page.tsx`

**What it does today.** Goods-receipt detail: `PageHeader` title `Receipt
b586ac3c` with a quiet "Back to receipts" link, two KPIs (Gross total `0.00 NOK`,
Lines `0`), a `Receipt` description list (supplier, location, status, received,
delivery reference, accepted by/at), and a Lines table with a proper empty state
("No lines on this receipt … so no landed cost was …"). Status `Submitted`.

**Issues (ranked)**

1. `[1] job and hierarchy` · **major** — the title is a truncated UUID
   (`Receipt b586ac3c`). The screen is a *receipt*, not a hex string; the header
   should be supplier + date (or delivery reference), with the id demoted to meta.
2. `[7] interaction design` · **major** — status is `Submitted` but the detail
   offers **no lifecycle action** (no accept, no way to move it forward) and
   "Accepted by / Accepted at" show `—` with no explanation of how acceptance
   happens or who does it. A status the operator cannot act on and cannot
   interpret is a dead end.
3. `[5] explainability` · **major** — "landed cost" (in the subtitle:
   "the landed cost appended to price history at record time") is the key term
   and has no (i) with the formula/basis; `Submitted` / `Accepted` are unlabelled
   status values.
4. `[10] visual direction` · **minor** — two equal KPI cards for a
   receipt that may be empty; Gross total `0.00 NOK` reads as a real zero rather
   than "no lines recorded yet".
5. `[6] state coverage` · **minor** — the **empty state is good** (explicit, with
   guidance) and should be the model for the other two areas; note it.

**Proposal.** Header title = supplier + received date (id in scope line). Add an
`InfoTip` on "landed cost" (formula + basis) and on each status value. Either add
the missing acceptance action (accept / mark accepted) with a confirm and its
ledger effect, or, if acceptance is out of scope, state explicitly where it
happens so `Submitted` is not a dead end. Empty receipt should show "no lines
yet" rather than a `0.00 NOK` hero.

**New primitives needed.** `InfoTip`.

**Acceptance criteria.**
- Title identifies the receipt by supplier/date; no UUID in the H1.
- (i) on landed cost and on status values.
- `Submitted` either has a next action or a stated explanation of where it is
  actioned.
- An empty receipt does not present `0.00 NOK` as a metric.

- [ ] accept · [ ] adjust · [ ] skip

---

## Area summary — `purchasing`

**Pattern this area must share.** A register whose only primary action is the
`PageHeader` "Record a receipt" button; supporting registers (Suppliers) and
their create forms collapsed/modal; the receipt **detail route is the one
justified full-page form in the app** (long, repeating lines) — but every other
create in the reviewed areas should be a modal by comparison. All three screens
must state the ledger effect (stock in, price-history append) at the point of
commit, with an (i) on landed cost and on status values.

**Highest-value screens, changed first.**

1. `/purchasing/new` — nested line cards flattened, consequence + (i) added; it
   is the app's stock-and-price write and the pattern others will copy.
2. `/purchasing/receipts/[id]` — UUID title and the dead-end `Submitted` status.
3. `/purchasing` — header primary + collapse Suppliers.

**Wave 0 dependencies.** `InfoTip`, `Collapsible`.
