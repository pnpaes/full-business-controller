# UX review — `costs` (11 screens)

Audit-only. Contract: `docs/ux/README.md`; lens: `ux-screen-review` skill. Screens
reviewed against a signed-in `owner` session at `http://localhost:3000`, dimension
viewport 1440×900, screenshots read before judging.

## Coverage and evidence

| # | Route | Rendered? | Evidence |
| --- | --- | --- | --- |
| 1 | `/costs` | yes (some counts 0) | `costs-costs.png` |
| 2 | `/costs/cost-cards` | yes — empty | `costs-cost-cards.png` |
| 3 | `/costs/cost-cards/[id]` | **no** — 404 | `costs-cost-cards-detail-404.png` + source |
| 4 | `/costs/cost-pools` | yes — 1 row | `costs-cost-pools.png` |
| 5 | `/costs/allocation-rules` | yes — 1 row | `costs-allocation-rules.png` |
| 6 | `/costs/channel-fee-rules` | yes — empty | `costs-channel-fee-rules.png` |
| 7 | `/costs/labor-rates` | yes — 1 row | `costs-labor-rates.png` |
| 8 | `/costs/operating-costs` | yes — 1 row | `costs-operating-costs.png` |
| 9 | `/costs/price-scenarios` | yes — empty | `costs-price-scenarios.png` |
| 10 | `/costs/price-scenarios/[id]` | **no** — 404 | `costs-price-scenarios-detail-404.png` + source |
| 11 | `/costs/price-versions` | yes — empty | `costs-price-versions.png` |

**Blocked (no screenshot of populated screen).** The served organization
(`ORGANIZATION_ID=1448a476-…`, `apps/web/.env.local:5`) has **zero** `cost_card`
rows globally and its `price_scenario` rows live in a different organization
(`04355376-…`). Both detail routes therefore `notFound()` (Next default 404, no
area context — screenshot read). Screens 3 and 10 are reviewed from source with
that caveat; their populated-state visual judgement is deferred.

**States actually seen:** empty (2, 6, 9, 11, and 1 partially), populated
(4, 5, 7, 8), not-found (3, 10). Loading, error and permission-denied were **not**
observed (single-role install; no denial path).

**Cross-app facts used below** (verified in source, not inferred): `Modal`
exists and is used for create/edit in `jobs`, `ai`, `administration` and
`insights` — but **no `costs` screen uses it**. `Tooltip` exists; **`Tooltip` is
used in zero app files** — there is no `InfoTip` anywhere. `Breadcrumbs`,
`DescriptionList`, `Tabs`, `FilterBar` primitives exist but are **not** used in
`costs`.

---

## Shared pattern (stated once, applies to every screen unless noted)

Every list screen in this area is the **same shape**: one `SectionCard`
containing a dense `Table`, with the **register/create form rendered inline
directly beneath it** (`register-*-form.tsx`, a `SectionCard` with a `<form>`).
This is the area's defining problem: creation is not a modal, and secondary
registers are not collapsed. Issues marked **SP** below are instances of it and
are not re-argued per screen.

- **SP-1 `[3]` `[7]` `[9]` major — create inline, not modal.** README trigger
  "A create/edit form on a list screen → move to a modal" is fired on screens 4,
  5, 6, 7, 8, 9. The rest of the app (jobs, ai, administration, insights) already
  uses `Modal`; costs is the outlier.
- **SP-2 `[5]` major — no `(i) InfoTip` on any term, number or state.** Zero
  `Tooltip` usage in the repo. Raw enums, calculated figures and effective-window
  semantics are unexplained.
- **SP-3 `[10]` minor — raw codes and ISO dates leak to the UI.** Tables show
  `production_hours`, `location`, `stop`, `monthly`, `fixed`, `exclusive`, and
  windows as `2026-01-01 → open`; instants as `2026-09-28 12:00 UTC`
  (`format.ts:45,50`). No locale, no human label.
- **SP-4 `[10]` minor — money has no thousands grouping** (`12500.00 NOK`,
  `format.ts:29`) and cost-card tables render money **without currency** while
  list/detail KPIs append it — inconsistent `[9]`.
- **SP-5 `[4]` minor — nested bordered container where an `EmptyState` sits
  inside a `SectionCard`** (screens 2, 6, 9, 11): two concentric bordered boxes.
  Seen in the screenshots; the table itself is *not* nested (DOM-verified — the
  perceived inner box is the card edge).
- **SP-6 `[6]` minor — not-found is the stock Next 404.** No area header, no
  Costs tabs, no "this card/scenario does not exist or is not in this
  organization" guidance (screens 3, 10).

---

## 1. `/costs` → `apps/web/app/(app)/costs/page.tsx`

**What it does today.** Area overview: a grid of six equal `KpiCard`s (record
counts per section) plus a `SectionCard` "Sections" listing seven bare `<a>`
links. The area `PageHeader` and the nine-tab strip come from `layout.tsx`.

**Issues (ranked).**
1. `[2]` major — the "Sections" list **duplicates the tab strip** rendered
   directly above it (same seven destinations, different order). Two navigation
   representations of one list.
2. `[10]` major — **six equal KPI cards with no rank**; README trigger "five
   equal cards with no rank → pick one hero metric". Nothing here is the screen's
   one job.
3. `[10]` minor — the "Sections" list renders **default browser link styling**
   (blue, underlined, disc bullets) and uses raw `<a>` (full reload) instead of
   the design system's link/label treatment — the only place in the area that
   looks unstyled.
4. `[5]` minor — counts have no `(i)`; "Cost pools", "Allocation rules" and
   "Channel fees" are register counts a new operator cannot interpret.

**Proposal.** Reframe as a **costing dashboard, not a directory.** Keep the
`PageHeader` + tabs (drop the duplicate "Sections" list). Promote one hero band:
**"Cost model"** status — e.g. `2 products costed · 0 scenarios pending approval ·
1 open price version` — then a compact secondary row of the remaining counts as a
quiet `DescriptionList` or three small stat lines, not six cards. The tab strip is
the navigation; the page is the status. Add InfoTips on "Cost card" and "Price
version".

**New primitives.** `InfoTip` (Wave 0); hero-metric band (may be a `SectionCard`
variant, no new primitive strictly required). No `Collapsible` here.

**Acceptance criteria.**
- The `/costs` page contains **no** list of section links that repeats the tabs.
- Exactly one visually dominant metric/statement; remaining counts are visually
  subordinate (smaller type, no card grid of six).
- Navigating to `/costs` shows the dashboard; every destination is reachable via
  the tab strip.
- No default-underline blue links remain on the page.

- [ ] accept · [ ] adjust · [ ] skip

---

## 2. `/costs/cost-cards` → `cost-cards/page.tsx`

**What it does today.** A `SectionCard` "Cost cards · 0 cards" wrapping a
six-column `Table` (Product, Location, Channel, State, Cost selection,
Calculated) or an `EmptyState`; a muted footnote about frozen snapshots. Rows link
to the detail. No create action (correct — cards are calculated).

**Issues (ranked).**
1. `[6]` major — the empty state is good copy but **has no next step / no
   pointer** to the prerequisite ("a recipe and sourced ingredient costs"), and
   the screen offers no filter or scope even though rows would need them.
2. `[5]` minor — "Cost selection" (`costSelectionPolicy`) is a raw policy value;
   "State" pill values have no `(i)`.
3. `[4]` minor — `EmptyState` (bordered) nested inside the bordered
   `SectionCard` (SP-5).
4. `[9]` minor — footnote duplicates provenance already stated on the detail.

**Proposal.** Keep as the eager list (no create). When empty, replace the nested
`EmptyState` with first-run guidance that links to the two prerequisites
(`/recipes`, `/purchasing`) — "Calculate a cost card" is not available until they
exist. Add `FilterBar` (product/location/channel) above the table so the list is
scannable once populated, persisting across navigation. Add `(i)` on "Cost
selection" and on the state pill.

**New primitives.** `InfoTip`; `FilterBar` exists but is unused in this area.

**Acceptance criteria.**
- Empty state names the required upstream objects and links to them.
- The table view has a `FilterBar`; filters survive navigating to a detail and
  back.
- "Cost selection" and state carry `(i)` explanations.

- [ ] accept · [ ] adjust · [ ] skip

---

## 3. `/costs/cost-cards/[id]` → `cost-cards/[id]/page.tsx` *(reviewed from source; 404, no data)*

**What it does today.** `PageHeader` equivalent: a manual "← All cost cards"
link, `<h2>` product name, state pill, badge, and a scope line; then **four
`KpiCard`s** (Unit full cost, Contribution after labour, Contribution margin,
Direct labour) and **five always-open `SectionCard`s**: Variable components,
Direct labour, Overhead allocation, Historical comparison, Source drill-down.

**Issues (ranked).**
1. `[2]` `[3]` major — **nine blocks, none collapsed.** This is the densest
   screen in the area and everything is expanded; historical comparison and
   source drill-down are by definition secondary. README trigger "more than ~3
   primary sections → split or collapse" is fired hard.
2. `[5]` major — **every figure is explained nowhere.** "Unit full cost" (the
   landed cost), contribution margin (`DEC-063`), "Boundary" (`roundingBoundary`,
   B0–B4), component kinds (`ingredient`, `packaging`, `channel_variable`,
   `other_variable`, `direct_labor`, `allocated_overhead`) and provenance
   `key=value` blobs are shown raw. No `(i)`.
3. `[9]` major — bypasses the design system it has: no `Breadcrumbs` (manual back
   link), a two-column `Table` used where `DescriptionList` exists, and
   hand-rolled KPI grid.
4. `[10]` minor — money in component tables has **no currency** (`formatMoney`
   only) while the KPI header appends it; mixed within one screen.
5. `[3]` minor — the four `(i)`-worthy KPIs are unlabelled units; "Contribution
   after labour" is a second margin concept with no definition.

**Proposal.** Split into **one job per view**: a compact **hero** (Unit full
cost, large, with currency and an `(i)` for the landed-cost formula) + a
`DescriptionList` of the four totals; then **collapsible** sections in this
order: Variable components (open), Direct labour (collapsed), Overhead
allocation (collapsed), Historical comparison (collapsed), Source drill-down
(collapsed — the raw provenance). Replace the back link with `Breadcrumbs`
(Costs › Cost cards › {product}). Render money through one helper that always
pairs currency. `(i)` on Unit full cost (landed), contribution margin, each
boundary code, each component kind, and provenance.

**New primitives.** `Collapsible`/`Disclosure` (Wave 0 — none exists),
`InfoTip`; use existing `Breadcrumbs`/`DescriptionList`.

**Acceptance criteria.**
- Only the hero + Variable components are expanded on first paint; the other four
  sections are collapsed and keyboard-operable.
- Breadcrumbs show Costs › Cost cards › product, all clickable.
- Every calculated total and every boundary/kind token has an `(i)`.
- No money value appears without its currency.

- [ ] accept · [ ] adjust · [ ] skip

---

## 4. `/costs/cost-pools` → `cost-pools/page.tsx`

**What it does today.** `SectionCard` "Cost pools · 1 pool" with a four-column
table (Code, Name, Effective, Version = Current/Closed badge), then the inline
`RegisterCostPoolForm` (Code, Name, Effective from, Effective to).

**Issues (ranked).**
1. `[3]` `[9]` major — **SP-1**: the register form is inline and always expanded
   below the table; the app has `Modal`.
2. `[2]` major — **allocation rules for a pool are not visible here**, though a
   pool's meaning is inseparable from how it splits (the rules live on a
   separate screen, screen 5). The pool register shows a version but not its
   rule.
3. `[5]` minor — "Current/Closed" version semantics and the "versioned, not
   unique" rule (explained only as form microcopy) have no `(i)`.
4. `[10]` minor — "Effective" shows `2026-01-01 → open` (SP-3); the arrow/window
   is unexplained.

**Proposal.** Put **Register a cost pool** behind a `Modal` opened by the single
primary action in the section header. Make each pool row expandable or a detail
route showing its allocation rule(s) inline (see screen 5), so pool and rule stop
being two disconnected registers. `(i)` on Version and on the effective-window
term.

**New primitives.** `InfoTip`; `Modal` exists. `Collapsible` if rows expand.

**Acceptance criteria.**
- No create form is visible until the primary action is pressed; it opens a
  modal; on success the modal closes and the row appears.
- A pool's allocation rule is reachable from the pool row without hunting a
  separate tab.
- Effective-window and Version carry `(i)`.

- [ ] accept · [ ] adjust · [ ] skip

---

## 5. `/costs/allocation-rules` → `allocation-rules/page.tsx`

**What it does today.** `SectionCard` "Allocation rules · 1 rule" with a
six-column table (Pool, Driver, Scope, Denominator source, Fallback, Effective)
showing raw vocabulary (`production_hours`, `location`, `production_hours`,
`stop`), then the inline `RegisterAllocationRuleForm`.

**Issues (ranked).**
1. `[5]` blocker — **the register is unusable without a definition.** "Driver",
   "Denominator source", "Scope" and "Fallback" are closed domain vocabularies
   (`ALLOCATION_DRIVER`, `ALLOCATION_DENOMINATOR_SOURCE`, `SCOPE_TYPE`,
   `ALLOCATION_FALLBACK`) rendered as raw snake_case with **no explanation
   anywhere** — not in the table, not in the form. This is the single most
   costly explainability gap in the area.
2. `[2]` major — belongs with cost pools (screen 4); as its own top-level tab it
   is a rule about an object shown elsewhere.
3. `[3]` `[9]` major — SP-1 inline register form.
4. `[10]` minor — raw codes, ISO window (SP-3).

**Proposal.** **Do not keep this as a standalone tab.** Move allocation rules
into the cost-pool register/detail (a pool's "How this pool splits" table),
leaving a read-only "Allocation rules" view only if a flat cross-pool list is
genuinely needed — then it becomes a tab *within* Cost pools. Give each column an
`(i)`: Driver (what the split follows), Denominator source (how the base is
obtained — explicit, measured, etc.), Scope (organization/location/…), Fallback
(stop/even-share when the driver is missing). Register via `Modal`.

**New primitives.** `InfoTip` (essential, Wave 0); `Modal`.

**Acceptance criteria.**
- Allocation rules are reachable from a cost pool without a separate top-level
  tab.
- Every vocabulary column and select option carries an `(i)` with a plain-language
  definition.
- Register is a modal launched from the pool screen.

- [ ] accept · [ ] adjust · [ ] skip

---

## 6. `/costs/channel-fee-rules` → `channel-fee-rules/page.tsx`

**What it does today.** `SectionCard` "Channel fee rules · 0 rules" with an
`EmptyState`, then `RegisterChannelFeeRuleForm` in its own `SectionCard` which —
because no channels exist — renders a **second `EmptyState`** ("No channels
registered") instead of a form.

**Issues (ranked).**
1. `[2]` major — **the duplicate register tab.** Channel fees are a fee on the
   channel; tax rules already live in `administration` (`tax-rule-register.tsx`).
   A "Fees & tax" register would be one screen, not two registers in two areas.
2. `[4]` minor — **two nested `EmptyState`s stacked** (register section's empty
   state inside the area), the first inside a bordered card (SP-5).
3. `[3]` `[9]` major — SP-1 (when channels exist, form is inline).
4. `[5]` major — fee kind (`commission_pct`), fee basis (`net_price`),
   percentage rate and the effective window are unexplained; these are the exact
   inputs behind a scenario's channel cost.

**Proposal.** Fold channel fees and tax rules into one **"Fees & tax"** register
(one screen, one table of rule kinds with a `kind` column), reachable from the
tab strip and cross-linked from price-scenarios. When channels are absent, the
empty state should **link to where a channel is created** rather than dead-end.
Register via `Modal`. `(i)` on fee kind, fee basis, rate and window.

**New primitives.** `InfoTip`; `Modal`.

**Acceptance criteria.**
- One register screen covers channel fees and tax rules, or the two are tabs of
  one screen.
- The "no channels" state links to channel creation.
- Fee kind/basis/rate/window each carry an `(i)`.

- [ ] accept · [ ] adjust · [ ] skip

---

## 7. `/costs/labor-rates` → `labor-rates/page.tsx`

**What it does today.** `SectionCard` "Labour rates · 1 rate" with a five-column
table (Role, Cost centre, Loaded hourly rate, Productive hours, Effective) —
`kitchen`, `Demo Shared Cost Centre`, `306.57` (no currency), `85.00%`,
`2026-01-01 → open` — then the inline `RegisterLaborRateForm` (Cost centre, Role,
Base hourly rate, …).

**Issues (ranked).**
1. `[5]` blocker — **"Loaded hourly rate" (`306.57`) is a calculated number with
   no currency, no formula and no `(i)`.** The footnote says it derives from base
   wage + statutory percentages, but the *rate* in the row itself is opaque; this
   is the number the whole area depends on.
2. `[3]` `[9]` major — SP-1 inline register form.
3. `[10]` minor — "Productive hours `85.00%`" mixes a percentage into a table of
   hours without a header cue; "Effective" raw ISO (SP-3).
4. `[9]` minor — role `kitchen` is a lowercase code, not a label.

**Proposal.** `(i)` on Loaded hourly rate with the formula (base × (1 +
statutory) ÷ productive hours) and the currency; `(i)` on Productive hours. Move
the register into a `Modal` from the section's primary action. Label roles.
Keep the table dense.

**New primitives.** `InfoTip`; `Modal`.

**Acceptance criteria.**
- Loaded hourly rate shows its currency **and** an `(i)` stating the formula.
- Productive hours has an `(i)`; the column header says it is a percentage.
- Register is a modal; the table remains the only primary content.

- [ ] accept · [ ] adjust · [ ] skip

---

## 8. `/costs/operating-costs` → `operating-costs/page.tsx`

**What it does today.** `SectionCard` "Operating costs · 1 cost" with an
eight-column table (Cost centre, Location, Vendor, Amount, Recurrence, Behaviour,
Tax basis, Effective) — `12500.00 NOK`, `monthly`, `fixed`, `exclusive`,
`2026-01-01 → open` — then the inline `RegisterOperatingCostForm` (Cost centre,
Location, Cost pool, …).

**Issues (ranked).**
1. `[10]` major — **the densest table in the area carries the most opaque
   vocabulary.** `monthly`, `fixed`, `exclusive` are enums; `exclusive` in
   particular is a tax-basis term a new operator cannot read. No `(i)`.
2. `[3]` `[9]` major — SP-1 inline register form (the form is longer than the
   table).
3. `[5]` minor — the footnote ("the cost-pool amount derived from these rows is
   an application convention pending an owner decision") is **essential
   provenance in muted xs text**, not an `(i)` — exactly the anti-pattern the
   README warns about.
4. `[10]` minor — amount `12500.00 NOK` lacks thousands grouping (SP-4).

**Proposal.** Demote Recurrence/Behaviour/Tax basis to compact labelled values
with `(i)` each; move the "pending owner decision" caveat into an `(i)` on the
amount/pool link. Group the eight columns with light visual separation (cost
centre/location/vendor | amount/recurrence | behaviour/tax/effective) rather than
one flat run. Move the register into a `Modal`. Format money with grouping.

**New primitives.** `InfoTip`; `Modal`; possibly a small column-group separator in
`Table` (token-level, Wave 0).

**Acceptance criteria.**
- Recurrence, Behaviour and Tax basis each carry an `(i)`.
- The pending-decision caveat is reachable from the affected number, not only as
  a footnote.
- Amount uses thousands grouping; register is a modal.

- [ ] accept · [ ] adjust · [ ] skip

---

## 9. `/costs/price-scenarios` → `price-scenarios/page.tsx`

**What it does today.** `SectionCard` "Price scenarios · 0 scenarios" with an
eight-column table (Product, Location, Channel, State, Gross price, Net price,
Contribution margin, Created) or `EmptyState`, plus a `RegisterScenarioForm`
("Calculate a price scenario") that, with no product variant, renders an inline
note instead of a form.

**Issues (ranked).**
1. `[2]` major — **`price-versions` is a separate top-level tab for what is a
   life-cycle stage of a scenario.** An approved scenario creates exactly one
   effective version (`price-scenarios/[id]/page.tsx:83`). Two tabs for one
   object.
2. `[5]` major — "Contribution margin" (`DEC-063`), "Net price" vs "Gross price",
   and the state pill are unexplained (the `DEC-063` definition sits in a
   footnote, not an `(i)`); "n/a" appears with no reason in-row.
3. `[3]` `[9]` major — SP-1: "Calculate a price scenario" is an inline form
   (blocked here) rather than a modal; when unblocked it will dominate the page.
4. `[6]` minor — the blocked note ("this organization has none yet. Create a
   product with a variant first.") is static microcopy, not a link to
   `/products`.

**Proposal.** Keep the register table. Merge **Price versions** into this screen
as a second tab or a "versions" filter, or expose versions only inside the
scenario detail (recommended: tabs `Scenarios | Effective versions`). Move
"Calculate" into a `Modal` launched from the primary action. `(i)` on gross vs
net vs inclusive tax, contribution margin, and each state value. Turn the blocked
note into a link to product creation.

**New primitives.** `InfoTip`; `Modal`; `Tabs` primitive exists (use it instead
of the bespoke `tabs.tsx` for the sub-tabs).

**Acceptance criteria.**
- Price version is not a separate top-level tab; versions are reachable from the
  scenarios screen or a scenario.
- Calculate opens a modal; the list is the only primary content.
- Gross/net/margin/state each carry an `(i)`; the blocked state links to
  `/products`.

- [ ] accept · [ ] adjust · [ ] skip

---

## 10. `/costs/price-scenarios/[id]` → `price-scenarios/[id]/page.tsx` *(reviewed from source; 404, no data)*

**What it does today.** Manual "← All price scenarios" link, `<h2>` product,
state pill, badge, scope line; four `KpiCard`s (Proposed price, Net price, Unit
contribution, Contribution margin); four always-open `SectionCard`s — Price and
tax, Margins, Sensitivity and volume, Approval (with `StatusPill`, target
contribution, and a **`JSON.stringify(feeBreakdown)`** blob in a table cell) —
then either the inline `ApproveScenarioForm` or the effective-version summary.

**Issues (ranked).**
1. `[5]` blocker — **the fee breakdown is printed as raw JSON inside a table
   cell** (`page.tsx:248-259`). This is the definition of unexplained machine
   output in a human surface.
2. `[2]` `[3]` major — eight blocks all expanded; Sensitivity/volume and the
   approval history are secondary and should collapse.
3. `[5]` major — "Unit contribution", "Channel variable cost", "Required gross
   price (target contribution)", "Break-even units" are all calculated and
   undefined; the approval action's consequence (creates the effective version)
   is unstated near the button.
4. `[9]` major — `ApproveScenarioForm` is **inline** inside the detail (a
   mutation form in a read view); should be a `Modal` behind the primary action.
   Manual back link instead of `Breadcrumbs`.
5. `[5]` minor — the effective version is shown as a raw UUID + text line; no
   `(i)` on the half-open window.

**Proposal.** Hero = proposed price; a `DescriptionList` for the rest of the
totals. Collapse Price and tax (open), Margins, Sensitivity and volume
(collapsed), Approval. Replace the JSON blob with a small **fee table**
(kind · basis · amount) rendered from the breakdown keys with `(i)` per kind.
Put **Approve** as the single primary action opening a `Modal` (effective window
fields) with a consequence note; after success the version summary replaces it.
`(i)` on every calculated figure, the half-open window, and the state.

**New primitives.** `Collapsible` (Wave 0), `InfoTip`, `Modal`; `Breadcrumbs` /
`DescriptionList` exist.

**Acceptance criteria.**
- No JSON string is rendered anywhere; the fee breakdown is a table with `(i)`.
- Only one section is expanded on first paint; the rest are collapsible.
- Approve opens a modal and states that it creates the effective price version.
- Breadcrumbs and a `DescriptionList` replace the manual back link and 2-col
  measure table.

- [ ] accept · [ ] adjust · [ ] skip

---

## 11. `/costs/price-versions` → `price-versions/page.tsx`

**What it does today.** `SectionCard` "Price versions · 0 versions" with an
`EmptyState` and a long muted footnote explaining the `All locations`/`All
channels` scope and the half-open effective window (`page.tsx` footnote).

**Issues (ranked).**
1. `[2]` major — a **standalone register for the output of approval**; belongs as
   a view/tab of price scenarios (see screen 9).
2. `[5]` major — the footnote is the *only* place the half-open window and the
   "All locations/All channels" scope are defined, and it is muted xs text below
   a table — essential semantics in the least discoverable place. Must be `(i)`
   on the term.
3. `[4]` minor — `EmptyState` nested in `SectionCard` (SP-5).
4. `[6]` minor — empty state has no link to the approval flow that creates a
   version.

**Proposal.** Retire this as a top-level tab; expose effective versions as a tab
inside Price scenarios (or inside a scenario detail). Where the table renders,
move the scope/window semantics into `(i)` on the "Effective" and "Scope"
columns, with a `FilterBar` (product/channel/date). Empty state links to Price
scenarios.

**New primitives.** `InfoTip`; `FilterBar` and `Tabs` exist (unused here).

**Acceptance criteria.**
- No standalone Price versions top-level tab; reachable from Price scenarios.
- Effective window and scope carry `(i)`; the footnote is removed.
- Empty state links to the scenario approval flow.

- [ ] accept · [ ] adjust · [ ] skip

---

## Area summary

**Shared pattern.** This area is nine near-identical registers: `SectionCard` →
dense `Table` → inline register form, all always expanded, zero `(i)`, raw enums
and ISO dates, money without grouping. It is the only area in the app that has
not adopted the existing `Modal`, `Breadcrumbs`, `DescriptionList`, `Tabs` and
`FilterBar` primitives. The tabs strip is the one strong structural idea already
in place.

**Information architecture (the "fewer screens with tabs?" question).**
The route count is not the problem — independent addressability is good — but the
**tabs are.** Collapse nine tabs to about six by grouping along real object
boundaries:

- **Costing** — Cost cards · Price scenarios (with *Effective versions* as a
  sub-tab) · (Cost-card detail unchanged as a route).
- **Overhead model** — Operating costs · Labour rates · Cost pools (allocation
  rules shown inside a pool) · Fees & tax (channel fees + tax rules) ·
  *Overview* as the dashboard entry.

That removes the two "output as a top-level tab" screens (price-versions,
allocation-rules) without losing a destination.

**Progressive disclosure.** Two moves cover most of it: (1) every register form
becomes a `Modal` behind the section's single primary action; (2) both detail
screens get `Collapsible` secondary sections and one hero metric. These two
changes are the highest-value work in the area.

**InfoTip targets — the calculated/financial numbers that must be explained
(wave-priority order):**

1. **Unit full cost / landed cost** (cost-card detail, and the cost-card column).
2. **Contribution margin** (`DEC-063`) and **unit/channel contribution**
   (cost-card detail, price-scenario list and detail).
3. **Loaded hourly rate** formula and **productive hours** (labour rates).
4. **Allocation basis** — Driver, Denominator source, Scope, Fallback
   (allocation rules).
5. **Channel fee** — fee kind, fee basis, rate, window (channel fees; scenario
   fee breakdown).
6. **Effective price version / half-open effective window** and
   `All locations`/`All channels` scope (price versions, price-scenario detail).
7. **Rounding boundary** codes and **component kinds** (cost-card detail).
8. **Recurrence / Behaviour / Tax basis** (operating costs).

**Highest-value screens first (implementation order after triage).**

1. **`/costs/allocation-rules` + `/costs/cost-pools`** — the blocker-level
   explainability gap (allocation basis) and a merge that removes a tab.
2. **`/costs/price-scenarios` (+ versions)** — merge the output tab, modal
   create, kill the JSON blob path before it ships.
3. **`/costs/cost-cards/[id]`** — the densest screen; hero + collapsible +
   `InfoTip` establishes the detail pattern the rest copy.
4. **`/costs/labor-rates`** and **`/costs/operating-costs`** — cheap `InfoTip`
   wins on the two most opaque numeric tables.
5. **`/costs`, `/costs/cost-cards`, `/costs/channel-fee-rules`,
   `/costs/price-versions`** — dashboard restructure and de-duplication last.

**Wave 0 primitives this area demands:** `Collapsible`/`Disclosure`,
`InfoTip` (wrap existing `Tooltip`), and a money formatter with thousands
grouping. Reuse `Modal`, `Breadcrumbs`, `DescriptionList`, `Tabs`, `FilterBar` —
do not build new ones.

**Environment blocker (not a UX finding).** The served organization has no
`cost_card` rows and its `price_scenario` rows belong to another organization, so
screens 3 and 10 could not be judged populated. Restore coherent demo data
(`ORGANIZATION_ID` aligned with the seeded org) before implementing this area, or
the redesign cannot be browser-verified against real records.
