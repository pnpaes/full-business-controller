# UX review — `products`

Date: 2026-09-28 · Reviewer: `ux-designer` (`ux-screen-review` lens, audit only) ·
App: `http://localhost:3000`, session `ux-sales`, logged in as `owner`.
Contract: `docs/ux/README.md`. Screenshots were read and then deleted
(`storage/tmp/products-*.png`).

Screens covered (4/4):
- `/products`, `/products/[itemId]`, `/products/sellables` — screenshots read.
- `/products/sellables/[variantId]` — screenshots read, **but no variant existed in
  the owner's organization**, so the first visit hit the error state and a real sample
  was seeded to photograph the data state (see the note in that entry).

Real ids used: item `83e3e3de-74fa-4295-b2ba-e711a511c292` (`DEMO_HOUSE_BLEND`,
finished good). Seeded for the screenshot and **removed afterwards**:
product `aaaaaaaa-0000-4000-8000-000000000001`, variant
`…-000000000002`.

Observed states: **data** (`/products`, `/products/[itemId]`), **empty**
(`/products/sellables` "No products yet"; item's Supplier packs / Conversions /
Price history / Affected recipes), **error** (`/products/sellables/[variantId]` raw
`DomainError` — the state I actually hit), **permission-denied** (not testable as
`owner`). No `loading.tsx` exists anywhere in the app router.

---

## `/products` → `apps/web/app/(app)/products/page.tsx` (+ `items-table.tsx`, `register-item-form.tsx`)

**What it does today.** Header "Products" with the description "Items and their
supplier packs, base units and current cost…", a single "Looking for what we sell?
Products and variants →" link, a `SectionCard` "Register an item" whose body is a
collapsed `<details>`, then the `Items` `SectionCard` with a search field, an item-type
select, a `Filter` button and a paginated table (Code, Name, Type, Base unit, Policy,
Current cost (NOK), Lot tracked, Active).

**Issues (ranked).**

1. **[1]/[9] terminology and job — `blocker`.** The screen is titled **Products** but
   its rows are **items** (the table is "Items", the header copy is "Items and their
   supplier packs"), and a *different* screen is called **Sellable products**. "Product",
   "item", "variant" and "sellable" are four distinct domain nouns used interchangeably
   in the UI; a new operator cannot tell which screen holds what they want.
2. **[3] progressive disclosure — `minor`.** The register form is already a collapsed
   `<details>` (good starting point) but it is still a page section, not a modal, and
   the collapsed card renders as a near-empty bordered card whose only content is the
   summary "New item" — it reads like an empty section rather than a create action.
3. **[5] explainability — `major`.** Every row shows "No cost yet" for Current cost
   (a calculated number with no (i) naming the source or why it is absent), and the
   Policy ("stocked") and Lot-tracked pill are domain states with no definition. The
   header's `Item type` filter values (`ingredient`, `finished_good`, `packaging`) are
   likewise undefined.
4. **[8] accessibility — `minor`.** The items table links only the Code cell
   (`items-table.tsx:82` renders an `<a>` inside the first column); the row is not a
   target and no row header (`scope="row"`) is exposed, so the same row-navigation gap
   as the sales transaction table applies.
5. **[10] visual direction — `minor`.** The table's two right-hand columns are mostly
   "No cost yet" and "—", so the screen reads as empty even with data; there is no hero
   figure (e.g. item count or items missing a cost).

**Proposal.** Fix the nouns first: title the screen **Items** (or keep "Products" but
rename the sellables screen to **Sellable variants** and add an (i) glossary), and
state in the header why items and sellables are separate. Turn "Register an item" into a
primary button → modal. Add (i) on Current cost ("No cost yet" — what records it),
Policy, Lot tracked and each Item type. Give the row a link with an accessible name
(whole-row link or "Open <code>") and mark the Code cell as the row header. If
"missing a cost" matters, surface it as the hero count.

**New primitives needed.** `InfoTip`; a `DataTable`/table capability for a whole-row
link and `scope="row"`.

**Acceptance criteria.**
- The screen title and rows use one noun consistently, and the sellables screen's name
  distinguishes it; the header says which is which.
- Creating an item happens in a modal, and the collapsed-card-as-empty-state artefact
  is gone.
- Current cost, Policy, Lot tracked and Item type each expose a focusable (i).
- Each row exposes one link whose accessible name identifies the item.

- [ ] accept · [ ] adjust · [ ] skip

---

## `/products/[itemId]` → `apps/web/app/(app)/products/[itemId]/page.tsx`

**What it does today.** For `DEMO_HOUSE_BLEND`: `PageHeader`, then **eight**
`SectionCard`s down one scroll — Identity, Edit item (a collapsed `<details>`),
Supplier packs (empty), Register a supplier pack (collapsed `<details>`), Conversions
(empty), Stock (one row: location, storage area, lot, quantity, value, avg unit cost),
Price history ("not available yet"), Affected recipes ("not available yet").

**Issues (ranked).**

1. **[3] progressive disclosure — `blocker`.** Eight primary sections on one detail
   route, against the contract's ">3 primary sections → split or collapse" trigger.
   Two of them (Price history, Affected recipes) are **permanently empty
   placeholders** that render a full card and an empty-state paragraph for a read model
   that does not exist yet — pure noise on every item.
2. **[2] information architecture — `major`.** Three concerns are interleaved rather
   than grouped: *what this item is* (Identity, Stock), *what it costs* (Supplier packs,
   Conversions, Price history), and *where it is used* (Affected recipes). The reading
   order does not match the task order for any single task.
3. **[3] / [1] — `major`.** Two create/edit forms (Edit item, Register a supplier pack)
   live inline as page sections instead of modals, so editing competes with reading.
4. **[5] explainability — `major`.** "Stock" cites "moving weighted average (DEC-008)"
   as meta text; "Value (NOK)" and "Avg unit cost (NOK)" are calculated figures with no
   (i). **Landed cost has no surface on this screen at all** — the supplier-pack section
   is the natural home and shows nothing about cost composition. Conversions explain the
   formula as inline prose ("1 from = factor × to") where an (i) belongs.
5. **[10] visual direction — `minor`.** "Current cost (NOK) — No cost recorded" sits in
   the Identity grid at the same weight as the code, though cost is the figure the
   screen is about; there is no hero metric.

**Proposal.** Reorganise into three tabs (or three collapsible bands), overview first:
- **Overview** — Identity + a hero for Current cost (with (i)) + Stock.
- **Cost & pricing** — Supplier packs (with landed cost and its (i)), Conversions,
  Price history (with effective price + (i)). This is the home for the (i) the task
  asks for on **landed cost** and **effective price**.
- **Usage** — Affected recipes.
Move Edit item and Register supplier pack to modals. Drop the two "not available yet"
cards from the default view entirely until their read models land; if they must stay,
fold both into one collapsed "Not yet available" note, not two full cards.

**New primitives needed.** `InfoTip`; `Collapsible`/`Disclosure` (or a detail-tab
pattern); `Modal` (exists).

**Acceptance criteria.**
- At most three primary sections/tabs visible on load; the two placeholder cards are
  absent or inside one collapsed disclosure.
- Current cost is the hero figure and exposes an (i) (source, date, currency).
- Landed cost appears on the supplier-pack view with an (i) naming its components;
  effective price appears on the price-history view with an (i).
- Edit item and Register supplier pack open in modals; no create/edit form renders
  open in the page body.

- [ ] accept · [ ] adjust · [ ] skip

---

## `/products/sellables` → `apps/web/app/(app)/products/sellables/page.tsx` (+ `register-product-form.tsx`, `register-variant-form.tsx`)

**What it does today.** Header "Sellable products", a "← Back to items" link, two
stacked `SectionCard`s — "Register a product" (collapsed `<details>`) and "Register a
variant" (collapsed `<details>`) — then a "Products" `SectionCard` that shows the
first-run empty state ("No products yet").

**Issues (ranked).**

1. **[2] information architecture — `major`.** Two peer create cards ("Register a
   product", "Register a variant") imply a variant is an independent sibling of a
   product, when the domain is hierarchical (a variant belongs to a product). Creating a
   variant from the top level also forces the operator to pick the parent product from a
   select rather than from the product they are looking at.
2. **[9] consistency / [1] — `major`.** The screen is named "Sellable products" but it
   also registers variants; the register below is titled "Products". Three names
   ("sellable products", "products", "variants") for two entities again.
3. **[3] progressive disclosure — `minor`.** Two stacked collapsed create cards above
   the (empty) register; once products exist, the dominant task is browsing them, and
   creation should not occupy two full sections above the list.
4. **[5] explainability — `minor`.** Meta chips "DEC-128 · create" and "DEC-030 ·
   sellable identity" are decision ids with no (i); "sellable identity", "product kind"
   and "finished-good item" are domain terms a new operator will not know.
5. **[6] state coverage — `positive`.** The empty state is correct first-run guidance
   ("Register a product above, then add the variants you sell…"), not a blank table;
   this is the one screen in the area where the empty state was reachable with real
   data and it reads well.

**Proposal.** Make "New product" the single primary action (modal). Create variants
from within a product row ("Add variant" → modal with the parent pre-bound), never as a
top-level peer card. Rename the screen **Sellable variants** (or add a one-line (i)
explaining product vs variant) and rename the register to match. Add (i) on "sellable
identity", "product kind" and "finished-good item".

**New primitives needed.** `InfoTip`; `Modal` (exists).

**Acceptance criteria.**
- One primary action on the screen; variant creation is reached from a product, with the
  parent product fixed, not from a peer top-level card.
- Screen and register names use the same nouns; "product vs variant" is explained once.
- The empty state is preserved.

- [ ] accept · [ ] adjust · [ ] skip

---

## `/products/sellables/[variantId]` → `apps/web/app/(app)/products/sellables/[variantId]/page.tsx` (+ `edit-variant-form.tsx`)

**Note on data.** No variant existed in the owner's organization — the only
`product_variant` row belongs to another org — so opening the route with a real id
produced the **error state** below. A product and variant were seeded directly for the
screenshot and deleted afterwards; the data-state findings are from that rendered page.

**What it does today.** `PageHeader` (`UX_AUDIT_PROD · UX_AUDIT_VAR`, scope "Sellable
variant"), then `Identity` (read-only `DescriptionList`), **Edit variant** — an
always-open form, not collapsed — then `Recipe assignment` (empty state + an inline
`AssignRecipeForm`) and `Add-on applicability` (empty state + an inline
`AddonApplicabilityForm`).

**Issues (ranked).**

1. **[6] state coverage — `blocker`.** A variant id that does not exist in the current
   organization throws `DomainError: product variant not found in organization`
   (`packages/application/src/products/reads.ts:191`) and the app has **no
   `error.tsx`, `not-found.tsx` or `loading.tsx` anywhere**, so the user gets the
   framework's raw error overlay (dev) or default page (prod) instead of a "variant not
   found — back to sellables" state. Any stale bookmark, deleted variant or cross-org id
   is a 500.
2. **[3] progressive disclosure — `major`.** The Edit-variant form renders open on
   load, and two more inline forms (assign recipe, add-on) sit at the bottom of their
   sections; three editing surfaces dominate a *read* screen. This is worse than the
   item detail, where Edit is at least collapsed in a `<details>`.
3. **[9] consistency — `major`.** The same "edit the entity" job is a collapsed
   `<details>` on `/products/[itemId]` and an always-open form here. Two disclosure
   patterns for one job.
4. **[2] information architecture — `major`.** "Recipe assignment" (what it is made
   from) and "Add-on applicability" (what it attaches to / price effect) are the
   domain answer to "this sellable"; they are split into two sections each carrying its
   own inline form, with no grouping surface.
5. **[5] explainability — `major`.** Add-on "Price effect" is a bare number with a
   currency appended (`page.tsx:216`) and no (i). **Effective price and price history
   have no surface on this screen at all** — the screen that defines what we sell shows
   no price. "Open-ended" windows and `v<n>` recipe versions are undefined terms.
6. **[10] visual direction — `minor`.** No hero metric; the identity block is all muted
   terms and values with nothing leading.

**Proposal.** Reorganise: **Overview** (Identity + hero SKU, read-only) · **Recipe &
add-ons** (recipe assignment and add-on applicability together, each with an "Add"
modal) · **Pricing** (effective price history, with (i) on effective price). Move
Edit variant, Assign recipe and Add-on forms into modals; make the edit pattern match
the item screen exactly. Add (i) on price effect, effective price, recipe version and
"Open-ended". Add the missing `error.tsx`/`not-found.tsx` (area-level is fine) so a
missing variant is a recoverable state, not a raw `DomainError`.

**New primitives needed.** `InfoTip`; `Modal` (exists); area-level `error.tsx` +
`not-found.tsx` route files (state coverage, not a UI primitive).

**Acceptance criteria.**
- A variant id not in this organization renders a "not found / no access" state with a
  link back to `/products/sellables`; no raw error overlay.
- No form renders open on load; edit/assign/add are modals.
- The edit pattern is identical to `/products/[itemId]`.
- Effective price is present with an (i); price effect and recipe version have (i)s.

- [ ] accept · [ ] adjust · [ ] skip

---

## Area summary — `products`

**The pattern this area should share.** One noun per entity, stated once (item vs
product vs variant vs sellable) with an (i) glossary; detail screens as three tabs —
**Overview** (identity + hero figure + stock), **Cost & pricing**, **Usage/recipe** —
with every create/edit in a modal and *no* permanently-empty placeholder cards; and the
same disclosure pattern for the same job on every detail screen. Tables keep the sales
a11y fixes (whole-row link, row header, unit per cell, short caption).

**Figures and terms that need an (i) `InfoTip`.** `landed cost` (and its components),
`effective price` and its history/version, `current cost` / "No cost yet",
`moving weighted average` (DEC-008), `Stock value` / `Avg unit cost`, `lot tracked`,
`inventory policy` (`stocked`), item `type` values, `product kind` (DEC-128),
`sellable identity` (DEC-030), `finished-good item`, recipe `version` / `Open-ended`,
add-on `price effect`, and the `DEC-0xx` chips.

**Highest value first.** 1) the missing `error.tsx`/`not-found.tsx` (blocker; the
observed raw `DomainError` is user-facing and cheap to fix); 2)
`/products/[itemId]` progressive disclosure — 8 sections, two dead placeholders, inline
forms; 3) the item/product/variant/noun cleanup plus the sellables create hierarchy;
4) `/products/sellables/[variantId]` tabs, modal edits and the missing price surface.
Wave 0 `InfoTip` + `Collapsible`/disclosure unblock 2–4; the route error files are
independent.
