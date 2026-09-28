# UX / UI contract

The design and interaction rules every screen follows, the process for auditing
and redesigning screens, and how the owner triages proposals. Reviewed screens
live in `docs/ux/reviews/<area>.md`; the route inventory is
`docs/ux/screen-inventory.md`.

The review lens itself is the **`ux-screen-review`** skill (loaded by the
`ux-designer` agent). This document is the human-readable contract behind it.

## Design direction

Restraint and hierarchy, borrowed from two houses — and deliberately not their
marketing scale.

**Apple — clarity, deference, depth**

- **One idea per view.** A screen has one job; name it in the header.
- **One primary action.** Secondary actions are quiet; destructive actions live
  apart from the primary and always confirm.
- **Space is the grouping device.** Segregate with whitespace and section bands
  before boxes; avoid nested bordered cards; elevation only where it means depth.
- **Progressive disclosure.** Summary at a glance (KPIs, status, the current
  task); details on demand (collapsible sections, tabs, detail routes, modals).
  **Creating and editing happen in a modal or a detail route**, never in a form
  that dominates the page.
- **Precise type scale, 4/8pt rhythm, high-contrast text**, and microcopy that
  explains rather than decorates. The interface recedes: few accents, one primary
  colour.

**Nike — confident hierarchy**

- **One hero metric or statement per screen** (large, bold) — not five equal
  cards competing.
- **Strong black/white base with a single accent**; oversized section titles as
  anchors; **editorial section bands** rather than a continuous wall of content.

**Explicitly not borrowed:** display-scale type inside tables, decorative imagery
or motion, or any density reduction that hurts scanning. **Data tables stay
dense**; the whitespace lives around them.

## The screen recipe

For a list/register screen (the common case), top to bottom:

1. **Breadcrumbs + `PageHeader`** — title, scope, one-sentence purpose, and the
   single primary action ("New …", opening a **modal**).
2. **Hero metric band** (optional) — 1–3 KPIs that frame the screen (count,
   status). Never a wall of cards.
3. **Filters** — a `FilterBar` that is quiet and collapses when unused; filters
   survive navigation.
4. **Primary section** — the one table or set of rows that answers the screen's
   job. Dense, scannable, with pagination.
5. **Secondary sections** — history, provenance, configuration, secondary tables:
   **collapsible**, collapsed by default.
6. **Explanations** — an **(i) `InfoTip`** on any domain term, calculated number,
   status value or irreversible action; inline microcopy only for the primary
   instruction.

Detail screens: `PageHeader` + a `DescriptionList`/read view, with edits in a
modal, and secondary material collapsible.

## Creation and hierarchy (hard rules)

Two rules from the owner's 2026-09-28 triage, applied everywhere:

1. **Creation and editing are a button + `Modal` — never an inline or collapsed
   (`<details>`) form on a register.** A collapsed form is not progressive
   disclosure; it is a wasted band that pushes the list down. A register's header
   carries exactly **one** primary button and **no** form. (Full-page creation is
   justified only for a genuinely long form with repeating lines — e.g.
   `/purchasing/new` — or a versioned publish flow.)
2. **Children live inside their parent; a child is never created at the parent's
   level.** Variants are added from their product, not from the products list.
   The parent list shows a **child-count indicator** (e.g. "3 variants") and opens
   the parent's own view, where its data, its children and the child "New …"
   button live. Clicking a child opens it for editing.

Corollary: if a screen needs the word "and" in its title to describe two things
(e.g. "Products and variants"), it is two screens or a parent with children.

## Explainability policy ((i) InfoTips)

Add an `InfoTip` when the reader must *know* something to use the screen safely:

- a domain term or abbreviation (e.g. `HALF_UP`, `landed cost`, `supersede`);
- a calculated number (its formula, basis, date, currency);
- a status value (what it means, who can change it);
- an action's consequence (what a retry/discard/approve actually does).

Do **not** use a tooltip for required instructions (that is inline microcopy) or
for anything essential to complete the task (tooltips are hover/focus only).

## State coverage

Every screen defines: **empty** (with first-run guidance, never a blank table),
**loading**, **error** (recoverable, with the next step), **permission-denied**
(say why and who to ask), and **success feedback** after a mutation.

## Process

1. **Audit** (`ux-designer`, audit-only): review each screen with the
   `ux-screen-review` lens, screenshot it and read the screenshot, and write
   `docs/ux/reviews/<area>.md` — per-screen issues (ranked, tagged by dimension),
   the proposal, needed primitives, acceptance criteria, and a **triage line**.
2. **Triage** (owner): mark each entry `accept` / `adjust` / `skip`.
3. **Implement** (waves, one area per wave): implement accepted proposals,
   browser-verified with before/after screenshots. Tests are added only where
   logic changed; pure layout stays test-free (repo policy).

## Wave plan

- **Wave 0 — primitives and tokens** (after triage): the design-system work the
  audits will demand, batched once rather than per screen. Known candidates:
  - **`Collapsible` / `Disclosure`** — accessible progressive disclosure (no
    such primitive exists today).
  - **`InfoTip`** — a standard (i) trigger wrapping the existing `Tooltip`.
  - **Token refresh** — type scale, spacing/rhythm, radius/elevation and accent
    usage, shown live in `/styleguide`.
- **Wave 1..n — one area per wave**, in the order the triggers below imply.

## Triggers (when a screen must change)

- More than ~3 primary sections on one screen → split or collapse.
- A create/edit form on a list screen → move to a modal.
- Any number, status or term a new operator would not know → `InfoTip`.
- Nested cards or more than two container levels → flatten, use space.
- Five equal cards with no rank → pick one hero metric.
- A blank empty state → first-run guidance.
- An unlabelled destructive action → confirm + separate.
