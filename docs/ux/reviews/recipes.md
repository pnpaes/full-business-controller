# Recipes — UX screen review

- **Date:** 2026-09-28
- **Reviewer:** `ux-designer` (audit-only; no screen code changed)
- **Lens:** `ux-screen-review` skill; contract `docs/ux/README.md`
- **Scope:** 2 routes under `apps/web/app/(app)/recipes/`
- **Evidence:** one screenshot per route, each read back; live app `http://localhost:3000` as `owner`. Real id `4e12a0bd-2718-4c28-861e-17fe1c73dca2` ("Demo House Blend", 1 version, `approved`). Screenshots were scratch and have been deleted.
- **State coverage:** data state seen (one recipe). Empty register, loading, error and permission-denied were **not** observed — re-review once a second recipe/version exists.

Recipes is the most developed area visually (breadcrumbs, a KPI band, a dense register table) but it repeats the same two faults as HMS at a larger scale: **four equally-weighted KPI cards** (README caps a hero band at 1–3 and warns against a wall of cards) and **create/edit forms living inline on the page**, here plus nested cards inside the cost preview. No `InfoTip` anywhere despite heavy calculation jargon.

---

## 1. `/recipes` → `apps/web/app/(app)/recipes/page.tsx`

**What it does today.** `Breadcrumbs` ("Aquarela Business Control · Products") + a "Products area" link. `PageHeader` title "Recipes" with purpose "Recipe identities with their latest version, state and cost preview." Then a **hero band of four `KpiCard`s** (Recipes · With a version · Latest version approved · Cost preview available), then an "All recipes" `SectionCard` with a dense table (CODE, NAME, LATEST VERSION, STATE, OUTPUT ITEM, COST / USABLE UNIT), then a **"New recipe"** `SectionCard` containing the inline `NewRecipeForm`.

**Issues (ranked)**
- `[10] visual direction` — **major** — four equal KPI cards with no rank; README: hero band is 1–3 KPIs and "never a wall of cards"/"five equal cards with no rank → pick one hero metric".
- `[7] interaction design` — **major** — creating a recipe is a full inline form at the bottom of the register; no header primary action.
- `[3] progressive disclosure` — **major** — the create form is permanently on the register page.
- `[9] consistency` — **minor** — the breadcrumb's last crumb is "Products" while the page title is "Recipes"; the top-right link reads "Products area", so the location in the IA is ambiguous.
- `[5] explainability` — **minor** — "STATE = approved", "COST / USABLE UNIT" and the KPI captions ("A cost preview requires an approved version and a resolvable cost source (DEC-047)") are referenced but not labelled with an (i).
- `[6] state coverage` — **minor** — only the one-row state seen; no empty-register first-run guidance observed.

**Proposal.** Reduce the hero to **one hero metric** (recipes with a cost preview available) plus at most one supporting KPI. Keep the dense table as the primary section. Move **New recipe** to a header primary action opening a `Modal`. Add an `InfoTip` on State and on "Cost / usable unit" (formula basis, DEC-047). Fix the breadcrumb to end at Recipes.

**New primitives needed:** `InfoTip`; `Modal` (exists).

**Acceptance criteria**
- Hero band has one hero metric and ≤2 supporting KPIs, visually ranked (not four equal cards).
- Header exposes one primary "New recipe" action opening a modal; no inline create form.
- State and cost columns carry `InfoTip`s; breadcrumb terminates at "Recipes".

**Triage line:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## 2. `/recipes/[recipeId]` → `apps/web/app/(app)/recipes/[recipeId]/page.tsx`

**What it does today.** Kicker "Aquarela Business Control · Recipes", title = code + name ("DEMO_HOUSE_BLEND — Demo House Blend"), sub-line = output item, "All recipes" link. Then **four `KpiCard`s** (Versions · Latest state · Yield rate · Cost / usable unit), a **Cost preview** card containing **three more nested cards** (Batch input cost / Batch output cost / Cost per usable unit) plus explanatory prose and an empty "no costed components" state, a **Versions** card (v1 `approved` meta, Lines empty, Allergens "None declared", Tests empty + inline **Record test** form), and finally a large **Register a version** form (version number, state, effective from/to, planned input/output/usable output, prep minutes, method, notes, Lines with Add ingredient/Add packaging, Direct labour mapping). Source is 783 lines; full-page screenshot ≈ 3 viewports of cards.

**Issues (ranked)**
- `[3] progressive disclosure` — **blocker** — one page hosts the version read view, the **Record test** form and the entire **Register a version** form; three concerns, all expanded, no tabs/collapse/detail route.
- `[10] visual direction` — **major** — four KPI cards again, then three cost cards nested inside the cost card: seven cards compete. Nested bordered cards are explicitly discouraged.
- `[4] segmentation` — **major** — the Cost preview card contains three inner cards (nesting); "never nested bordered cards" — flatten to a description list or one band.
- `[7] interaction design` — **major** — "Register a version" is a long form at the foot of the page (belongs in a modal or a dedicated `.../versions/new` route); "Record test" is inline inside the Versions card.
- `[2] information architecture` — **major** — version detail (Lines, Allergens, Tests) is buried beneath the cost preview and above the register-version form; the primary object (the version and its lines) should lead.
- `[5] explainability` — **major** — heavy, unlabelled jargon: "planned output + planned input (B6)", "required quantity grossed up by the line loss factor and recipe yield… DEC-047 precedence", "Batch input plus any batch variable cost (B6)", "not the sign-off verified cost until the golden fixtures are signed (DEC-065)", unit codes "DEMO_G". No `InfoTip`.
- `[8] accessibility` / `[9] consistency` — **minor** — the "Record test" grid packs four fields per row with labels above and hints below; check tab/focus order at narrow widths; the area lacks a consistent section-question naming.

**Proposal.** Restructure into **`Tabs`**: **Version** (the selected version: cost preview summary, Lines table, Allergens, Tests history), **Tests** (record test), **New version** (or a modal/dedicated route). Default = Version read view. Flatten the cost preview into one band (description list of the three figures with their formula in an `InfoTip`), not nested cards. Reduce the hero to one metric (cost / usable unit) plus latest state. Move "Record test" to a compact modal/sheet; move "Register a version" to a `Modal` or `.../versions/new`. Put an `InfoTip` on every B-code, yield rate, cost figure and unit code; keep the "preview vs sign-off verified cost (DEC-065)" caveat as an `InfoTip` on the cost headline.

**New primitives needed:** `InfoTip`; `Tabs` (exists); `Modal` (exists); flatten nested cards (no new primitive, uses `DescriptionList`).

**Acceptance criteria**
- Detail page is tabbed; the default view is the version record (cost summary + lines + allergens/tests), not a form.
- Cost preview is a single band with no nested bordered cards; each figure has an `InfoTip` with formula/basis.
- "Record test" and "Register a version" open from actions (modal/detail route), not always-open forms.
- Hero band is one ranked metric + latest state, not four equal cards.

**Triage line:** `- [ ] accept · [ ] adjust · [ ] skip`

---

## Area summary — Recipes

**Pattern the area should share.** Register (`/recipes`): `Breadcrumbs` → `PageHeader` with one header primary action (`Modal`) → a **single hero metric** (≤1 supporting KPI) → filter chips → the dense recipes table. Detail (`/recipes/[recipeId]`): `PageHeader` → **`Tabs`** (Version / Tests / New version) where the default tab is the read view and every mutation opens a `Modal` or a dedicated route.

**Highest value first.**
1. `[3]` **`/recipes/[recipeId]`** — the blocker: tab the page, move both forms off it, flatten the nested cost cards.
2. `[10]` **both screens** — collapse the four-card KPI bands to one hero metric (README-triggered).
3. `[5]` **`/recipes/[recipeId]`** — remove the B-code/DEC-065 jargon from primary UI into `InfoTip`s.
4. `[7]` **`/recipes`** — move "New recipe" to a header modal.

**Wave-0 primitives this area demands:** `InfoTip` (shared with HMS) — the only new build; `Tabs`, `Modal`, `DescriptionList`, `KpiCard` already exist and cover the rest.
