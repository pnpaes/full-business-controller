# UX review — area `insights`

Audit only (no screen code changed; nothing committed). Lens: `ux-screen-review`
skill, contract `docs/ux/README.md`. 10 screens reviewed: the nine
`/insights/*` routes plus `/ai` (its own first segment, grouped here per the
task brief). Reviewer: `ux-designer`.

**Evidence:** app at `http://localhost:3000`, session `ux-insights`, logged in as
`owner`. One 1512×1100 screenshot per screen, each read before judging.
Scratch files `storage/tmp/insights-*.png`, deleted after this file was written.

**State coverage actually seen:** every screen was **empty / no-data**
(2026-09 period has no posted sales). The empty state was read on all 10.
**Loading, error and permission-denied states were not exercised** (no fixtures
and no error/permission route) — treat those dimensions as unverified here.
No mutations were performed, so success feedback is also unverified.

**Observed on all 10 (shell, out of per-screen scope):** the sidebar footer
overlaps the nav bottom-left — `aquarela.local` / `Sign in` bleed over the
`Jobs` item and the open user menu. Shell-level; flag to Wave 0.

---

### `/insights` → `apps/web/app/(app)/insights/page.tsx`

**What it does today**
Landing overview. A bordered hero card ("How much of net sales survives
ingredient cost?") with a nested bordered empty-state box, a 4-KPI "Period
measures" band, then three equal report cards (Sales & margin, Menu engineering,
Operations) each carrying an RPT code, a scope string, a link and its own nested
empty-state box.

**Issues (ranked)**
- [10] visual direction · major — three equal cards with no rank, and the hero
  answer is an empty box, not a hero metric. No confident hierarchy.
- [4] segmentation · major — nested bordered containers: a card containing the
  bordered `EmptyState` box, repeated four times. Boxy, not space-grouped.
- [3] progressive disclosure · major — every panel restates the full scope
  string (`2026-09 month-to-date · All locations · as of …UTC`); the RPT codes
  (`RPT-001/004/005`) are raw jargon; the report links are the only affordances.
- [5] explainability · major — no (i) on any number, RPT code or "contribution
  before labour"; the definitions live nowhere near the term.
- [2] information architecture · minor — the three report cards duplicate routes
  that the sidebar already exposes under `Insights`.

**Proposal**
Keep this as the area's editorial band. Hero = one metric or one honest
statement (net sales / contribution before labour for the scope), not an empty
box. Hoist a single scope line ("2026-09 MTD · All locations · as of …UTC") into
the `PageHeader`/hero once; delete the per-panel scope strings. Replace the
three equal cards with a ranked list (one primary report first, secondary rows
quiet). `EmptyState` becomes borderless inside a panel. Add an (i) `InfoTip` on
"contribution before labour", the scope stamp and each RPT code. Secondary
report catalogue moves into a collapsed "All reports" disclosure.

**New primitives needed** — `Collapsible`/`Disclosure`; `InfoTip`;
`EmptyState variant="plain"` (borderless in-panel).

**Acceptance criteria**
- One hero metric/statement above the fold; no bordered box nested inside a
  bordered card anywhere on the screen.
- Scope string appears exactly once on the page.
- Every RPT code and calculated label has an (i) InfoTip.
- Report catalogue is collapsed by default; primary report is visually ranked.

- [ ] accept · [ ] adjust · [ ] skip

---

### `/insights/benchmarks` → `apps/web/app/(app)/insights/benchmarks/page.tsx`

**What it does today**
Two stacked pill rows (dimension `Location|Product|Channel`; metric `Net sales|
Contribution before labour|…`) and a third period row (`Daily|Weekly|Monthly`),
under a two-KPI band (`Organization aggregate 0.00 NOK`, `Peer median n/a`). A
"Ranked by net sales" panel holds a nested empty-state box; a long explanatory
paragraph sits below the fold and its opening sentence is repeated inline beside
the filters.

**Issues (ranked)**
- [5] explainability · major — "peer median", "n/a", "unmapped bucket", "standard
  competition ranking (1,2,2,4)", "organization aggregate" are unexplained;
  the definition exists only as a footnote paragraph far from the term, and is
  **duplicated** (inline note + footnote).
- [3] progressive disclosure · major — the four-sentence methodology paragraph
  belongs in an "About this benchmark" disclosure, not always-on body copy.
- [9] consistency · major — three stacked tab rows (flagship filter pattern
  differs from competitors' `FilterBar`); scope string repeated in the panel
  title and both KPI metas.
- [4] segmentation · major — bordered `EmptyState` nested inside the panel card.
- [10] visual direction · minor — two equal KPI tiles; no hero; no accent
  hierarchy on the dimension/metric selectors beyond purple pills.

**Proposal**
One filter row: `SegmentedControl` for dimension, `SegmentedControl` for metric,
period as a third compact control — grouped in a single quiet `FilterBar` with
the scope stamp once. Collapse the methodology into an "About this benchmark"
`Collapsible`, remove the duplicate inline sentence. `InfoTip` on "peer median",
"organization aggregate", "n/a" and the unmapped bucket. `EmptyState` borderless.

**New primitives needed** — `Collapsible`/`Disclosure`; `InfoTip`;
`EmptyState variant="plain"`.

**Acceptance criteria**
- One filter band, not three stacked rows; filter selection survives navigation.
- Methodology text appears once, collapsed by default, with an (i) summary inline.
- No duplicated scope string; no nested bordered boxes.

- [ ] accept · [ ] adjust · [ ] skip

---

### `/insights/competitors` → `apps/web/app/(app)/insights/competitors/page.tsx`

**What it does today**
A yellow `Alert` ("A pending observation is not intelligence (DEC-126)"), a
`FilterBar` (status chips `Pending/Reviewed/Rejected/All`, competitor select,
from/to dates, dark `Apply` + `Reset`), a "Competitor register" panel, and an
inline "Register a competitor" form (name + notes + submit). Four `DataTable`s
sit lower on the page (register, observations, sources, comparison).

**Issues (ranked)**
- [3] progressive disclosure · **blocker** — the create form ("Register a
  competitor") is inline on a list/register screen and dominates the page; the
  contract requires create/edit in a modal or detail route.
- [4] segmentation · major — five-plus primary sections (alert, filters,
  register table, create form, observations, sources, comparison) on one screen.
- [1] job and hierarchy · major — the dark `Apply` button reads as the page's
  primary action; there is no unambiguous primary action ("New observation"?) and
  the create form is buried mid-page.
- [5] explainability · major — `DEC-126`, `DEC-020`, "pending is not
  intelligence", "reviewed observations only" are policy jargon; a full-width
  warning banner is used where an (i) + short inline microcopy would do.
- [9] consistency · major — filter pattern (chips + Apply/Reset) differs from
  the tab rows used by benchmarks/forecast/trends/reports.

**Proposal**
`PageHeader` gets the one primary action ("Register competitor" → **modal**,
and "Record observation" → modal). The two long Alert banners collapse to inline
microcopy plus an (i) `InfoTip` on the "pending" status. The register becomes the
primary section (competitors table); observations, sources and comparison move
behind `Tabs` or collapsed sections, each drilling to a detail route. Replace
`Apply`/`Reset` with auto-applying filters so no filter button competes with the
primary action.

**New primitives needed** — `InfoTip`; `Collapsible`/`Disclosure`; a form-in-
`Modal` pattern (`Modal` exists — needs a form footer pattern).

**Acceptance criteria**
- No create/edit form visible on the page; both open in modals.
- One primary action in the header; filters apply without a competing button.
- At most three primary sections visible; the rest behind tabs/collapse.
- Policy terms have (i) InfoTips; no full-width policy banner.

- [ ] accept · [ ] adjust · [ ] skip

---

### `/insights/forecast` → `apps/web/app/(app)/insights/forecast/page.tsx`

**What it does today**
Metric tab row (7 metrics) + period row, two KPI tiles ("Projected net sales
145.67 NOK", "Backtested accuracy (MAPE) 77.5% — in-sample over 1 points"), a
"History and projection" line chart with **unlabelled y-axis**, a "Projection"
table (±1σ band), then a tracking section (raw `<details>`) with status alerts.

**Issues (ranked)**
- [1] job and hierarchy · major — the screen's stated job ("projected net sales
  from a fitted trend") has no hero: projection and an accuracy judge sit as two
  equal tiles.
- [5] explainability · major — `MAPE`, "in-sample", "±1 residual standard
  deviation", "n/a", "1 points" are unexplained; the chart has no y-axis values
  or unit; "lower is better" is a dangling fragment.
- [10] visual direction · major — chart y-axis unlabelled and the projected
  spike dominates the frame without annotation; no "model, not fact" cue inside
  the chart area (it is in the intro copy only).
- [3] progressive disclosure · minor — tracking history uses a bespoke
  `<details>` rather than a shared disclosure; projection table repeats the full
  scope string in its header.
- [9] consistency · minor — metric/period tab rows duplicate benchmarks/trends.

**Proposal**
One hero metric (projected net sales with its band) + one quiet accuracy
accessory (MAPE as a signed quality cue, not a peer KPI). Annotate the chart:
y-axis unit, a "projection starts here" divider and a "model" hatching/label;
move the model/assumption note into an (i) on the chart title. `InfoTip` on
MAPE, in-sample, ±1σ and the insufficient-history alert. Tracking section becomes
the shared `Collapsible`.

**New primitives needed** — `InfoTip`; `Collapsible`/`Disclosure`; chart
annotation support (axis labels/unit + projection divider).

**Acceptance criteria**
- Projection is the single hero; accuracy is visibly subordinate.
- Chart shows y-axis unit and a visible projection boundary + model label.
- MAPE, in-sample, ±1σ each carry an (i) InfoTip.
- One scope string; tracking is a shared disclosure, not ad-hoc `<details>`.

- [ ] accept · [ ] adjust · [ ] skip

---

### `/insights/menu-engineering` → `apps/web/app/(app)/insights/menu-engineering/page.tsx`

**What it does today**
Period tabs, three KPI tiles — the third renders the sentence
"category-relative (per row)" at display size, wrapping over two lines. A
"Contribution / popularity matrix" panel with a nested empty-state box, then two
long explanatory paragraphs below the fold covering thresholds, DEC-109, waste
attribution and forecast reliability.

**Issues (ranked)**
- [10] visual direction · major — a prose phrase rendered as a giant KPI number
  ("category-relative (per row)") is display-scale type doing a badge's job; the
  three tiles are equal weight.
- [5] explainability · major — "popularity threshold", "contribution threshold",
  "category-relative", "moving-average", "unmapped bucket", "DEC-109" are
  unexplained; two paragraphs of dense caveats carry what InfoTips should.
- [3] progressive disclosure · major — the caveat paragraphs are always-on and
  repeat the scope stamp; they belong in a collapsed "About this matrix".
- [4] segmentation · major — nested bordered empty-state inside the matrix card.
- [2] information architecture · minor — "Every product drills to its sales
  lines" is stated but the empty state gives no drill affordance/preview.

**Proposal**
Hero = one matrix or one headline statement ("N products classified"). The third
tile becomes a `Badge`/status line ("thresholds: category-relative per row"), not
a number. Thresholds and caveats move into an "About this matrix" `Collapsible`;
(i) on popularity/contribution/shortfall terms. Non-empty state should render the
2×2 matrix with quadrant labels, not a table only.

**New primitives needed** — `InfoTip`; `Collapsible`/`Disclosure`;
`EmptyState variant="plain"`; a matrix/quadrant display primitive.

**Acceptance criteria**
- No prose phrases at KPI display scale; thresholds shown as a labelled status.
- Caveats collapsed by default and not duplicated.
- Quadrant matrix rendered when data exists; (i) on all threshold terms.

- [ ] accept · [ ] adjust · [ ] skip

---

### `/insights/operations` → `apps/web/app/(app)/insights/operations/page.tsx`

**What it does today**
Period tabs, four equal KPI tiles (stock value 567.62 NOK, stock variance —,
production batches 1, waste value 4.89 NOK), then four stacked `Panel`s each
with its own `DataTable` (stock value by location, variance, production yield,
waste) and its own `View records` link.

**Issues (ranked)**
- [4] segmentation · major — four stacked primary sections on one screen (the
  contract's limit is ~3); reading order is not the task order.
- [10] visual direction · major — four equal KPI tiles, no hero; "yield 0.0% ·
  ratio 1.00" and "2 events · moving average only" are crammed into tile metas.
- [5] explainability · major — "stock variance adjustment", "yield ratio",
  "moving average only", "point-in-time ledger value" are unexplained.
- [3] progressive disclosure · minor — all four tables are always expanded; the
  value is the KPI band, the tables are provenance.
- [10] visual refresh · minor — scope string repeated in every panel header and
  in every KPI meta; radius is uniform `2xl` on every container.

**Proposal**
One hero metric (stock value) + a compact secondary band. The four tables become
`Tabs` (Stock · Variance · Production · Waste) or collapsed sections, each with
its `View records` drill. Hoist one scope line. (i) InfoTips on variance, yield
ratio and moving-average. Keep tables dense.

**New primitives needed** — `InfoTip`; `Collapsible`/`Disclosure`.

**Acceptance criteria**
- One hero metric; at most one table visible at a time (tabs or collapse).
- Single scope line; no repeated scope stamps.
- Each metric/label has an (i) InfoTip; tables stay dense.

- [ ] accept · [ ] adjust · [ ] skip

---

### `/insights/reports` → `apps/web/app/(app)/insights/reports/page.tsx`
(this is the reports *hub* — a single grouped report builder)

**What it does today**
Dimension tab row (`Location|Channel|Category|Product|Period`) + period row, a
four-KPI band (Net sales, Ingredient cost, Contribution before labour,
Transactions), a "Sales by category" panel with nested empty-state box, and a
long footnote paragraph about contribution, unmapped rows and RPT-003.

**Issues (ranked)**
- [1] job and hierarchy · major — as a "reports hub" it offers no list of
  reports; it is a single report with a dimension toggle. The hub job and the
  report job are conflated.
- [4] segmentation · major — nested bordered empty state inside the panel.
- [5] explainability · major — "contribution before labour", "Unmapped",
  "RPT-003", "normalized efficiency measures deferred" appear as body prose, not
  (i) InfoTips; "margin n/a" is unexplained.
- [3] progressive disclosure · major — the three-sentence footnote is always on.
- [10] visual direction · minor — four equal KPI tiles; scope string repeated
  per tile.

**Proposal**
Split the job: this route becomes a report index (ranked list/table of reports
with the RPT code, scope and a link), and a selected report renders in a detail
route (or a `Tabs`-driven panel). Within a report: one hero metric, up to three
supporting KPIs, one dense table. Move the footnote into an "About this report"
`Collapsible`; (i) InfoTIPs on contribution, margin, Unmapped and RPT codes.

**New primitives needed** — `InfoTip`; `Collapsible`/`Disclosure`;
`EmptyState variant="plain"`.

**Acceptance criteria**
- The hub shows a ranked, scannable list of reports (not a single report).
- Each report has one hero metric; footnotes collapsed; scope stated once.
- No nested bordered boxes; all jargon terms have (i) InfoTips.

- [ ] accept · [ ] adjust · [ ] skip

---

### `/insights/simulation` → `apps/web/app/(app)/insights/simulation/page.tsx` + `simulation/simulation-client.tsx`

**What it does today**
"Build a scenario" — a long form (location, baseline from/to, volume/price/wage
% fields, "Remove menu options", "Add menu options", "Headcount change") filling
the page; results (`KpiCard`s, two tables, model/assumption `Alert`s) render in
the client component after submit.

**Issues (ranked)**
- [3] progressive disclosure · major — the inputs that are genuinely optional
  (menu add/remove, headcount) are always expanded, so the primary inputs
  (location, baseline, the three % deltas) are buried in a long scroll.
- [7] interaction design · major — no visible primary action above the fold and
  no scenario summary/commit step; the user cannot see "what will this do" before
  running, and there is no save/compare scenario affordance.
- [5] explainability · major — "baseline period", "unmodelled", "resolves its
  effective recipe version", "moving" deltas lack (i) InfoTips.
- [10] visual direction · minor — panel-within-form nesting ("Remove menu
  options" inside the scenario card) adds container levels; spacing rhythm
  inside the form is tighter than the rest of the area.
- [1] job and hierarchy · minor — "What-if simulation" hero copy is a paragraph;
  a statement of what a scenario *is* would anchor it.

**Proposal**
Keep the form as this screen's job, but split it: **step 1** baseline + deltas
(the hero form, visible immediately), with menu and headcount changes in
collapsed sections ("Add optional changes"). Add a sticky "Run scenario" primary
action and a scenario summary line before running. After run, results render in
a distinct section with a "model, not fact" banner and one hero outcome; consider
a `/[scenarioId]` detail route for saved scenarios. (i) InfoTips throughout.

**New primitives needed** — `Collapsible`/`Disclosure`; `InfoTip`; sticky form
action bar; scenario-save pattern (or defer saved scenarios to a later wave).

**Acceptance criteria**
- Primary inputs and "Run scenario" visible without scrolling; optional changes
  collapsed by default.
- A pre-run summary of the deltas is visible; results are clearly separated from
  inputs and labelled as a model.
- Every assumption term has an (i) InfoTip; no triple-nested containers.

- [ ] accept · [ ] adjust · [ ] skip

---

### `/insights/trends` → `apps/web/app/(app)/insights/trends/page.tsx`

**What it does today**
Metric tab row (7 metrics) + period row; a "Latest net sales 0.00 NOK" tile with
a red `-100.0%` pill and "previous 506.00 NOK", and a "Flat band ±5.0%" tile; a
"Net sales over time" line chart with **unlabelled y-axis**; a "Period by period"
dense table (period, net sales, previous, change, change %, direction).

**Issues (ranked)**
- [5] explainability · major — "flat band ±5%", "a change inside the band reads
  as flat", "direction" and the previous-period basis are unexplained; the
  `-100.0%` pill's basis is not discoverable.
- [10] visual direction · major — y-axis unlabelled; the single spike dominates
  the chart and the flat baseline is invisible; no annotation for the flat band.
- [1] job and hierarchy · minor — the delta pill and the flat band are two
  competing interpretations of the same number with equal weight.
- [9] consistency · minor — metric/period tab rows duplicate benchmarks/forecast.

**Proposal**
Hero = latest net sales with an explicit delta and direction; the flat-band
threshold becomes an (i) on that delta ("changes within ±5% read as flat"),
optionally drawn as a shaded band on the chart. Label the y-axis with unit, and
annotate the flat band and the latest point. Keep the period table dense (it is
the right density). `InfoTip` on "change %", "direction", "previous".

**New primitives needed** — `InfoTip`; chart y-axis label + flat-band annotation.

**Acceptance criteria**
- One hero interpretation of the latest value; flat-band threshold explained via
  an (i) on the delta (and/or shaded on the chart).
- Chart y-axis labelled with unit and NOK; flat band annotated.
- Table stays dense; no duplicated scope strings.

- [ ] accept · [ ] adjust · [ ] skip

---

### `/ai` → `apps/web/app/(app)/ai/page.tsx` + `ai/ai-register.tsx`

**What it does today**
A status `SegmentedControl`/chip row (`Proposed`, `Approved`, `Rejected`,
`Superseded`), a "Suggestions" `Panel` with a nested empty-state box ("No
suggestions for this filter"), and a closing footnote: "A decision is a human
verdict … The API is `/api/v1/ai/suggestions`."

**Issues (ranked)**
- [5] explainability · major — "superseded", "verdict", and "advisory only …
  triggers no action (ADR-0009)" are policy/API jargon; the raw API path is
  developer-facing and exposed as body copy.
- [4] segmentation · major — nested bordered empty state inside the panel; the
  screen is otherwise a single section.
- [1] job and hierarchy · minor — the review action (approve/reject a
  suggestion) is the job, but no primary action is visible in the empty state
  (the empty state offers no next step for a reviewer).
- [9] consistency · minor — the header scope says "Insights" while the nav places
  AI as its own area; pick one and keep it consistent with the sidebar.
- [10] visual direction · minor — status filter is a chip/segment control whose
  active state is easy to miss; large empty region below the panel.

**Proposal**
Header scope should match the nav ("AI advisory" / not "Insights"). Keep the
status filter as `Tabs` (consistent with the area). The footnote's non-API half
becomes inline microcopy; the API path and "superseded"/"verdict"/ADR reference
move into an (i) `InfoTip`. Empty state gains first-run guidance for the
reviewer ("No suggestions yet — they appear after a scheduled run") plus, when
suggestions exist, an approve/reject action in a modal with the consequence
explained. `EmptyState` borderless inside the panel.

**New primitives needed** — `InfoTip`; `EmptyState variant="plain"`;
decision-modal pattern (consequence copy + confirm).

**Acceptance criteria**
- Header scope matches the nav; no raw API path in body copy.
- Empty state gives the reviewer a next step; decision actions open a modal that
  states their consequence.
- (i) InfoTips on "superseded"/"verdict"; no nested bordered boxes.

- [ ] accept · [ ] adjust · [ ] skip

---

## Area summary

**Shared pattern the area should adopt.** Every screen here is an analytics
screen and should share one recipe: `PageHeader` with a **single** scope line
(`period · scope · as-of`) stated once; a compact, uniform filter band
(`SegmentedControl` for dimension/metric/period — not three stacked pill rows,
and not a competing Apply button); **one hero metric** with at most 2–3 quiet
supporting metrics; one dense `DataTable`/chart as the primary section; every
secondary table, history or provenance block in a shared `Collapsible` (collapsed
by default) or a `Tabs` group; and an "About this calculation" disclosure holding
the methodology prose — never always-on footnotes. **No `EmptyState` may render a
bordered box inside a panel.** Every domain term, calculated number and status
gets an (i) `InfoTip`. Cross-screen consistency wins: pick the `FilterBar` +
`SegmentedControl` combination once and use it on all ten.

**Visual refresh notes (owner approved).** Row of two/four equal `KpiCard`s is
the dominant failure — collapse to one hero + quiet accessories; stop using
display-scale type for prose values ("category-relative (per row)"); stop
repeating tiny muted scope strings in every panel and tile (they hurt both
contrast and rhythm); reduce uniform `2xl` radius and container nesting so
spacing, not boxes, groups content; give charts y-axis units and let the accent
(purple) carry exactly one meaning per screen.

**Highest-value screens first.**
1. `/insights` — the area's front door, sets the pattern (hero + ranked reports).
2. `/insights/competitors` — has the worst contract violation (inline create form
   on a register) and five-plus sections to split.
3. `/insights/reports` — the hub/report conflation; fixing it unblocks the rest
   of the area's drill-down story.

Then the tab-row screens (`benchmarks`, `forecast`, `trends`, `operations`,
`menu-engineering`) can be normalised in one wave, and `/ai` + `/insights/simulation`
in a follow-up.
