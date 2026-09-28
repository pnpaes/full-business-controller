# UX review — triage index

The audit-only pass over **all 71 `(app)` screens** (2026-09-28), one review per
area, each screen closed by a triage line. This file is the entry point: read the
cross-cutting findings, then triage the per-area files.

- Contract: `docs/ux/README.md` · Lens: the `ux-screen-review` skill · Inventory: `docs/ux/screen-inventory.md`
- Per-area reviews: `insights.md`, `workforce.md`, `costs.md`, `inventory.md`,
  `purchasing.md`, `production.md`, `sales.md`, `products.md`, `hms.md`,
  `recipes.md`, `misc.md` (documents, tasks, jobs, administration, home, styleguide).

## Owner triage recorded so far

- **`products` — accepted (2026-09-28), with direction.** `/products` is the
  **Items** register (title it so) and must not spend a band on a collapsed form:
  a compact **"New item" button + modal** above the filtered list. `/products/sellables`
  becomes **Products → Variants** hierarchy: the products list shows a
  **variants indicator**, opening a product shows its data + its variants + a
  **"New variant" button (modal)**, and clicking a variant opens it for editing.
  Variants are never registered at the products level. The two new hard rules are
  in `docs/ux/README.md` ("Creation and hierarchy").
- Everything else: awaiting triage.

## How to triage

In each area file, every screen ends with:

```
- [ ] accept · [ ] adjust · [ ] skip
```

Mark one box per screen (`adjust` = accept with your note added inline). Send the
files back, or tell me the decisions area by area. **Nothing on screen changes
until triage.** After triage: Wave 0 (primitives + tokens) once, then
implementation waves, one area at a time, browser-verified before/after.

## Coverage and its limits (be honest when reading)

- Every screen was **screenshotted and the screenshot read** before judging.
- The dev database is mostly empty, so most screens were reviewed in their
  **empty state**; loading, error and permission-denied states were **not**
  observable, and a few mutation CTAs are unreachable in seed data (noted per
  file). Treat "today" descriptions as empty-state truth.
- Two cost detail routes (`/costs/cost-cards/[id]`, `/costs/price-scenarios/[id]`)
  **404'd**: the served org has no cost cards and its price scenarios belong to a
  different organization. Reviewed from source with a caveat.
- Audit agents seeded a few dev rows to reach detail routes (see Cleanup). The
  sales agent seeded and then removed its own; two seeds were added by US to
  `/workforce/employees/[id]` etc.

## Cross-cutting findings (fix once, not per screen)

1. **Creation and editing are inline on registers.** Almost every list screen owns
   its create form; `Modal` already exists and is used elsewhere. This is the
   single largest source of screen length.
2. **No explainability anywhere.** No `InfoTip`/`Tooltip` is used on any of the 71
   screens; raw enums (`production_hours`, `exclusive`, `monthly`), ISO windows,
   `HALF_UP`, `supersede`, `DEC-0xx` chips, formulas and consequences are all
   unexplained. `Tooltip` exists — a standard (i) trigger does not.
3. **`EmptyState` always draws a bordered box**, so an empty panel nests a
   container inside a container. A plain variant is needed app-wide.
4. **KPI walls.** Four to five equal `KpiCard`s instead of one hero metric
   (README caps a hero band at 1–3, with rank).
5. **No shared page scaffolding.** `Tabs` config is copy-pasted per page (e.g. four
   sales pages) instead of a `layout.tsx`; filter patterns differ between areas
   (`FilterBar`+Apply vs stacked pill rows).
6. **Numbers and money are raw.** No grouping/currency on amount cells; charts have
   no axis units; captions are long paragraphs; a fee breakdown is rendered as
   `JSON.stringify`.
7. **Destructive actions are not separated or confirmed.** Blocker example:
   `/workforce/employees/[id]` shows **Retire** as a full-width bar inside the
   read-only profile card.
8. **Stock-fact writes bury the consequence.** Waste, batch-complete, transfer
   receive, receipt detail and count approve state the ledger effect below the
   submit button or not at all.
9. **No route-level error boundaries.** There is no `error.tsx` / `not-found.tsx` /
   `loading.tsx` anywhere in the app, so a raw `DomainError` surfaces (seen on a
   variant route).
10. ~~**Shell bug:** the sidebar footer overlaps the bottom nav.~~ **Corrected
    2026-09-28 — not an app bug.** Reproduced at the screenshot's own viewport:
    the collision is the **Next.js dev-tools badge** (`N` / `localhost:3000`)
    painted over the footer, a dev-only overlay. The sidebar reserves its footer
    correctly; the layout was still hardened (`min-height: 0` nav, non-shrinking
    footer) for engine independence. The nav label `Products` → **`Items`** was
    changed (the register is the inventory identity).
11. **Internal references leak into user copy** on the production screens
    (`PROD-003`, "open point (e)/(f)").

Items **7, 9, 11** are defects to fix **before** the redesign; 11 is trivial and 9
is small but high-value. (10 was withdrawn — see above.)

## Wave 0 — what the audits converge on

Batch these once, in the design system, then implement:

- **`InfoTip`** — a standard (i) trigger wrapping the existing `Tooltip`.
- **`Collapsible` / `Disclosure`** — accessible progressive disclosure.
- **`EmptyState variant="plain"`** — an unbordered empty state for use inside panels.
- **`MetricHero`** (and a documented hero band) — one ranked metric, not a card wall.
- **Grouped money/number formatter** and chart axis units.
- **Documented `Modal` pattern** (create/edit), a **success toast**, and a styled
  **`FileField`**.
- **Token refresh**: type scale, 4/8pt spacing rhythm, radius/elevation and accent
  usage — shown live in `/styleguide`, which becomes the contract's reference.

## Suggested implementation order

Value × risk, after triage:

1. **Defects first** — sidebar overlap, production copy leak, route error/loading
   boundaries, the Retire placement.
2. **Wave 0** — primitives + tokens + `/styleguide`.
3. **Home, Jobs, Administration** — highest signal per change (home is a sales
   dashboard, not an ops board; `/administration` is one 7,700 px page of 8 sections;
   `/jobs` needs its dead-letter hero).
4. **Workforce** → **Inventory / Purchasing / Production** (ledger-consequence copy)
   → **Sales / Products** (IA + a `sales/layout.tsx`) → **Costs** (merge 9 screens
   toward ~6) → **Insights / AI** → **HMS / Recipes** (tabs + timeline).

## Before implementation

- **Align the dev data**: the served `ORGANIZATION_ID` and the seeded org differ
  (cost scenarios live under another org; several registers are empty). Pick one
  coherent demo org so redesigns can be verified against real records.
- **Cleanup**: audit-seeded rows to remove when convenient — Workforce employee
  "Audit Reviewer" (`994bdbdb-…`) + payroll report (`6af7cb2a-…`), an HMS incident
  (`bc841abb-…`), equipment (`c832210b-…`) and a recipe (`4e12a0bd-…`). Ask and I
  will remove them.
- Note: the `ux-screen-review` skill was created mid-session, so the skill registry
  (snapshotted at start) does not list it yet; agents read it from disk. It will be
  loadable by name after the next session restart.
