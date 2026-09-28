# UX review — `sales`

Date: 2026-09-28 · Reviewer: `ux-designer` (`ux-screen-review` lens, audit only) ·
App: `http://localhost:3000`, session `ux-sales`, logged in as `owner`.
Contract: `docs/ux/README.md`. Screenshots were read and then deleted
(`storage/tmp/sales-*.png`).

Screens covered (6/6, each with a screenshot read): `/sales`, `/sales/import`,
`/sales/import/[runId]`, `/sales/reconciliation`, `/sales/transactions`,
`/sales/transactions/[id]`.

Real ids used: run `27eebd8e-b4c1-488d-9901-237f7e173f97` (partially posted),
transaction `bd58d078-565f-4f38-bd38-ec8393cfedab` (R-1001), source `zettie-legacy`.

Observed states: **data** (all six), **empty** (`/sales/import` "Needs review 1"
assembled from real rows; empty branches seen only in source, not on screen),
**error** (not seen on this area — see the products review for the raw
`DomainError` case), **permission-denied** (not testable as `owner`).
Loading: no `app/**/loading.tsx` exists anywhere in the app router.

---

## `/sales` → `apps/web/app/(app)/sales/page.tsx`

**What it does today.** Landing hub: `PageHeader`, the four-item `Tabs` row, then
three stacked `SectionCard`s ("Sales import", "Transactions", "Reconciliation"),
each holding a paragraph of prose plus an underlined "Open … →" link. It shows no
data of any kind.

**Issues (ranked).**

1. **[2] information architecture — `major`.** The screen is a pure way-station:
   three cards whose only payload is a link to a destination already reachable from
   the `Tabs` control directly above them (`sales/page.tsx:63`). It adds one click to
   every sales task and duplicates the destination copy.
2. **[1] job and hierarchy — `major`.** No hero metric and no unique primary action,
   against the "one hero metric or statement per screen" rule; three equal cards with
   no rank (`README.md` trigger "five equal cards with no rank", latent here).
3. **[5] explainability — `minor`.** `DEC-026 · DEC-035` is rendered as a bare `Badge`
   (`sales/page.tsx:107`) with no (i) — a decision id is a domain term a new operator
   cannot resolve.
4. **[9] consistency — `major`.** The `Tabs` config is copied verbatim into all four
   sales pages (`page.tsx:63`, `import/page.tsx:…`, `transactions/page.tsx:65`,
   `reconciliation/page.tsx:…`) instead of one `sales/layout.tsx`. Any new tab or
   rename is a four-file edit that can silently drift, and there is no layout file to
   own the area sub-nav.

**Proposal.** Make `/sales` earn its place or remove it. Preferred: turn it into the
sales *dashboard* — one hero statement (e.g. unposted/needing-review runs and open
reconciliation exceptions with a link into each), then the three destinations as
quiet secondary links, not three prose cards. Alternative if the dashboard is out of
scope now: drop the hub and make `/sales/import` the area landing tab, moving the
"Sales" tab label to the real work. Move the `Tabs` into a new
`apps/web/app/(app)/sales/layout.tsx` so the area sub-nav is defined once.

**New primitives needed.** None (uses existing `SectionCard`, `Tabs`, `KpiCard`).

**Acceptance criteria.**
- The four sales routes render their sub-nav from one shared definition (one
  `Tabs` call site), and `grep -c '<Tabs'` under `sales/` is 1.
- `/sales` shows at most three elements, at least one of which is a real figure read
  from the database (not prose), and every element links somewhere without prose
  paraphrase of the destination.

- [ ] accept · [ ] adjust · [ ] skip

---

## `/sales/import` → `apps/web/app/(app)/sales/import/page.tsx` (+ `runs-table.tsx`, `new-run-form.tsx`)

**What it does today.** `PageHeader`, `Tabs`, four `KpiCard`s (Import runs,
Needs review, Validated, Staged rows), then one `SectionCard` "Import history"
holding the runs `DataTable` (source, period, status, staged/mapped/unmapped,
errors, dispositions, created). The register-run form lives further down the page.

**Issues (ranked).**

1. **[1] job and hierarchy — `major`.** Four equal KPI cards and no unique primary
   action above the fold; the thing the operator came to do ("Register an import
   run") is not the first or most prominent control, and is below the register table.
2. **[5] explainability — `major`.** "Needs review", "Validated", "Staged rows",
   "Staged / mapped / unmapped" and "Dispositions" are all status/count terms with no
   (i). A new operator cannot tell "staged" from "mapped", or why a run with 0 mapped
   rows is "Partially posted" (the screenshot shows exactly that: 4 staged, 0 mapped,
   status *Partially posted*).
3. **[10] visual direction — `minor`.** The status pill column ("Partially posted",
   "Needs review", "Uploaded") is the most information-dense cell but is styled at the
   same weight as the metadata columns; nothing in the row is the hero.
4. **[3] progressive disclosure — `minor`.** The create form is a page-level section
   rather than a modal, so the "register a run" task and the "review runs" task share
   one scroll (same anti-pattern the contract names for list screens).

**Proposal.** Keep the register form but move it behind a primary "Register run"
button opening a `Modal`. Lead with one hero figure — runs needing action — instead of
four equal cards, or keep at most two KPIs (needs review, exceptions). Add (i)
`InfoTip`s on "staged", "mapped", "disposition" and each status value, giving the
meaning and who can change it. Consider a "needs action" filter chip row so the
default view is the work, not all history.

**New primitives needed.** `InfoTip` (wraps the existing `Tooltip`); `Collapsible`
only if the history section is made collapsible. Both are Wave 0 candidates per
`README.md`.

**Acceptance criteria.**
- Exactly one primary action on the screen; it opens the register form in a modal, and
  the page body below the header contains the history table first.
- Every status pill and the "staged/mapped/unmapped" header have a focusable (i)
  trigger exposing a definition; keyboard-only users can reach and read each one.
- Empty run list shows first-run guidance linking to the register action (already true
  in `runs-table.tsx:26` — keep it).

- [ ] accept · [ ] adjust · [ ] skip

---

## `/sales/import/[runId]` → `apps/web/app/(app)/sales/import/[runId]/page.tsx`

**What it does today.** For the partially-posted run: `PageHeader`, a green status
`Alert` ("Posted"), **five** `KpiCard`s (Rows, Mapped, Unmapped, Errored/conflicted,
Residual 555.0000 NOK), a "Run" `SectionCard` with a `DescriptionList`, then
"Validation issues", "Staging rows", "Dispositions", the disposition form and
"Preview totals" — up to **eight** primary sections down one scroll.

**Issues (ranked).**

1. **[2] information architecture / [3] progressive disclosure — `blocker`.** Eight
   primary sections on one detail route, against the contract's "more than ~3 primary
   sections → split or collapse" trigger. The page is two screens stapled together:
   *the run* (identity, totals, residual) and *the work* (issues, staging rows,
   dispositions, preview).
2. **[2] information architecture — `major`.** The run detail already computes and
   shows Residual and tells the operator to reconcile, while `/sales/reconciliation`
   independently holds the reconciliation table and the create form. The overlap is
   real: the run's residual and the reconciliation's variance are the same question
   asked twice; there is no link from the run to its reconciliation row.
3. **[5] explainability — `major`.** "Residual" is shown as `555.0000 NOK` with the
   sub-label "Source − posted − dispositions" but is the highest-stakes figure on the
   page; it is the exact calculated number the policy says needs an (i) with formula,
   basis and currency. "Errored / conflicted" cites `DEC-033` inline as prose.
4. **[6] state coverage — `minor`.** The status `Alert` is tone-coloured and carries
   meaning ("posted", "ready to post", "not yet postable") but conveys no next step for
   the not-postable case beyond "stage, validate and map".
5. **[10] visual direction — `minor`.** Five equal KPI cards again; `Residual` is the
   decision figure and should be the one hero metric, with the four counts as a quiet
   supporting row.

**Proposal.** Split by task, not by data already on the page:
- **Summary tab** — `PageHeader` + status + the Run `DescriptionList` + one hero metric
  (Residual, with (i)) + a compact counts row + a link to "Reconcile this run" when
  posted.
- **Rows tab** — Staging rows + Validation issues + Dispositions (with the disposition
  form behind a "Record disposition" modal).
- **Preview totals** — collapsible, collapsed by default.
Own the two tabs with the shared `sales/layout.tsx` pattern; do not invent a bespoke
inner tab strip. Move the create/edit forms (disposition) to a modal. Deep-link the
run → reconciliation once a reconciliation exists for it.

**New primitives needed.** `InfoTip`; `Collapsible`/`Disclosure` (for Preview totals
and Validation issues); tab-in-detail-route pattern (or reuse `Tabs` with nested hrefs).

**Acceptance criteria.**
- At most three primary sections visible on load; Preview totals and Validation issues
  are collapsed by default and reachable by keyboard.
- Residual carries a focusable (i) naming the formula, the currency and that it is
  read from posted lines; its value is the largest single figure in the summary.
- A posted run links to its reconciliation row, and the reverse link exists from
  `/sales/reconciliation`.
- Staging/dispositions/preview content is unchanged (no data loss), only relocated.

- [ ] accept · [ ] adjust · [ ] skip

---

## `/sales/reconciliation` → `apps/web/app/(app)/sales/reconciliation/page.tsx` (+ `reconcile-form.tsx`, `reconciliation-table.tsx`, `resolve-form.tsx`)

**What it does today.** `PageHeader`, `Tabs`, four KPIs (Reconciliations, Within
tolerance, Exceptions, Open), a blue "Tolerance" `Alert`, the "Reconcile" create form,
the "Reconciliations" table, and a "Settlements" `Alert`. Three of the four alerts on
the page are explanatory prose.

**Issues (ranked).**

1. **[2] information architecture — `major`.** The create form sits between the KPIs
   and the table, so "read the exceptions" and "make a reconciliation" are interleaved;
   the operator's dominant task (see which rows are open) is pushed below a form.
2. **[5] explainability — `major`.** The tolerance is explained in a large paragraph
   alert ("max of 0.5% and 5 NOK", "DEC-026", "DEC-035") rather than an (i) on the
   Tolerance field. The variance/difference figures — the reason the screen exists —
   are the figures most in need of an (i): formula, basis, currency, tolerance applied.
3. **[1] job and hierarchy — `minor`.** Four equal KPIs, no hero; "Open" is the number
   the operator acts on and is rendered the same size as the rest.
4. **[5]/[3] — `minor`.** The three explanatory `Alert` bands (Tolerance, Nothing to
   reconcile, Settlements) consume prime vertical space and read as permanent chrome;
   the Settlements one is reference material, not a live state.

**Proposal.** Lead with the exceptions: move the `Reconciliations` table directly under
the header/KPIs and put "New reconciliation" behind a primary button → modal. Keep one
hero metric (Open exceptions) and demote the other three. Replace the Tolerance and
Settlements prose alerts with (i) `InfoTip`s on the Tolerance field and on the
"Settlement" term; keep an inline alert only when it reflects live state.

**New primitives needed.** `InfoTip`; `Modal` already exists (`packages/ui/src/modal.tsx`).

**Acceptance criteria.**
- The exceptions table is visible without scrolling past a form.
- Tolerance, variance/difference, "within tolerance" and "settlement" each expose a
  focusable (i); no explanatory prose paragraph remains above the table.
- Creating a reconciliation happens in a modal and the table refreshes with success
  feedback.

- [ ] accept · [ ] adjust · [ ] skip

---

## `/sales/transactions` → `apps/web/app/(app)/sales/transactions/page.tsx` (+ `transactions-table.tsx`)

**What it does today.** `PageHeader`, `Tabs`, three KPIs (Transactions 2, Line items 3,
Currencies NOK "No conversion is applied"), one `SectionCard` with the transaction
`DataTable`. Two rows, newest first; the date cell stacks the instant with the
external id in mono.

**Issues (ranked).**

1. **[8] accessibility — `major`.** The row is only a link in its **first cell**
   (`transactions-table.tsx:44` passes a React node for `date`, and `DataTable` wraps
   only column 0 in an `<a>`, `patterns.tsx:565`). A screen-reader or keyboard user
   tabs through links named "2026-08-01 12:15 UTC R-1001"; the row advertises itself as
   clickable (hover) but the hit target and the accessible name are one small cell. No
   row header is exposed either: the date is a `<td>`, so table navigation cannot
   announce "row R-1001".
2. **[8] accessibility — `major`.** Missing values render as `—` (`orDash`, e.g.
   Location and Channel here) with no accessible text; a screen reader announces "em
   dash" for both columns and cannot tell the row genuinely has no location from an
   empty value.
3. **[5] explainability / [8] — `major`.** Amount cells are bare numbers with
   `fontVariantNumeric` only (`transactions-table.tsx:62`). The currency (`NOK`) lives
   in a KPI card, not the table and not the cell, so neither a sighted reader scanning
   the Gross column nor a screen reader knows the unit of a cell. A row's gross is
   therefore not self-describing.
4. **[5]/[8] — `minor`.** The table's `<caption>` (`transactions-table.tsx:71`) is a
   40+ word paragraph, including the `DEC-043` reference; it is read as the table's
   name. Long explanation belongs in an adjacent description (or an (i)), with a short
   caption as the name.
5. **[7] interaction design — `minor`.** The list is hard-capped at 100 with the only
   signal being the KPI meta "Newest 100 (more exist)"; there is no pagination control
   or filter, so a bigger dataset is unreachable from the screen (the products screen
   does paginate — inconsistent).

**Proposal.** Make the whole row the link: wrap the row (or add a trailing, visually
quieter "Open" link with an accessible name such as "Open transaction R-1001"), and
give the first column `scope="row"` semantics so row navigation announces the id.
Render absent values as a neutral dash **plus** visually-hidden "not captured".
Append the currency to the amount cells (or carry it in the header, e.g. "Gross (NOK)")
so cells are self-describing. Shorten the caption to "Posted sales transactions" and
move the DEC-043 explanation to an (i) on the table header or an inline note below.
Add the same pagination pattern the products register uses, or an explicit "load more".

**New primitives needed.** `InfoTip`. A small `DataTable` capability: whole-row link /
`scope="row"` on the first column, and an accessible-text hook for placeholder cells.

**Acceptance criteria.**
- Every table row exposes one link whose accessible name identifies the transaction
  (id or R-number), and the clickable area covers the row.
- Placeholder dashes carry visually-hidden text; a screen reader never says "em dash".
- Each amount cell's unit is discoverable from the cell or its header.
- The table caption is a short name; the explanation is an on-demand (i) or a note.
- The register paginates or explicitly loads more; the count and page are visible.

- [ ] accept · [ ] adjust · [ ] skip

---

## `/sales/transactions/[id]` → `apps/web/app/(app)/sales/transactions/[id]/page.tsx`

**What it does today.** `PageHeader` ("Sales transaction · R-1001", scope, "… · NOK ·
zettie-legacy"), a "Header" `SectionCard` with a `DescriptionList` (source, external
id, occurred at, location, channel, gross, net, tax, discount, refund, currency, lines,
import run), then a "Lines" `SectionCard` with the line table.

**Issues (ranked).**

1. **[5] explainability — `major`.** The header's calculated/derived figures — Gross,
   Net, Tax, Discount, Refund — are bare `numeric(19,4)` values with no (i) and no
   visible currency on the row (the currency is a separate line item). The tax basis,
   the meaning of discount vs refund, and the zero net/tax shown here (gross 377.0000,
   net 0.0000, tax 0.0000 on this real row) are exactly the kind of number a new
   operator cannot interpret.
2. **[2] information architecture — `major`.** "Import run `34c277b4-4f91-4865-ba49-e242dc6d5763`"
   is a raw UUID printed as dead text; it is the provenance of the whole transaction and
   should link to `/sales/import/[runId]` (and the run should list its transactions).
3. **[2]/[3] — `minor`.** Location and Channel are shown partly as prose in the values
   ("— (the source carried no resolvable location)") rather than as a state with an (i)
   explaining why a POS row can carry no resolvable location.
4. **[3] — `minor`.** The line table sits directly in the page; with a long transaction
   the header read and the line scan compete. Not urgent at 2 lines, but the pattern
   should be settled here.

**Proposal.** Make the Header list the *identity + status* (source, external id, time,
location, channel, currency, lines, run link) and keep the money figures in a small
totals block led by one hero (Gross), each figure with an (i) for formula/basis. Link
the import run id to its run detail and add the reverse link. Where the source carried
no location/channel, show a neutral "Not in source" state with an (i) rather than a
sentence inside the value column.

**New primitives needed.** `InfoTip`.

**Acceptance criteria.**
- Gross/Net/Tax/Discount/Refund each expose a focusable (i) (definition, basis,
  currency).
- Import run id is a link to `/sales/import/[runId]`; the run detail links back to this
  transaction.
- Missing location/channel renders as a status with explanation, not prose in the value.

- [ ] accept · [ ] adjust · [ ] skip

---

## Area summary — `sales`

**The pattern this area should share.** One `sales/layout.tsx` owning the four-tab
sub-nav (kills the four-way duplication); one hero metric per screen with the
supporting counts demoted; tables that are self-describing (unit per cell or header,
accessible row link, short caption); explanatory prose replaced by `InfoTip`; and
create/edit forms in modals, not inline sections. `/sales` should either become a real
dashboard or be removed as a way-station.

**Figures and terms that need an (i) `InfoTip`.** `Residual` (formula: source − posted
− dispositions; currency; basis), reconciliation `variance/difference` and `tolerance`
(DEC-026 default `max(0.5%, 5 NOK)`), `disposition` codes (DEC-035/DEC-083), `staged`
vs `mapped` vs `validated`, each run status, `DEC-043` (zero-price option line),
`DEC-033` (mapping conflict), `moving weighted average` (DEC-008), "No conversion is
applied", and every bare `DEC-0xx` id currently rendered as prose or a `Badge`.

**Highest value first.** 1) `/sales/import/[runId]` (blocker: eight sections) and the
run↔reconciliation overlap; 2) `/sales/transactions` table accessibility (row link,
dash, currency); 3) the `sales/layout.tsx` extraction plus the `/sales` hub decision;
4) reconciliation form-below-table and prose→InfoTip. Wave 0 `InfoTip` and
`Collapsible` unblock 1 and 4.

**Cross-area note (for the products review too).** The app router has **no**
`error.tsx`, `loading.tsx` or `not-found.tsx` anywhere. Any thrown `DomainError`
renders the framework's raw error overlay in dev and the default page in prod — observed
live on `/products/sellables/[variantId]` (see `products.md`).
