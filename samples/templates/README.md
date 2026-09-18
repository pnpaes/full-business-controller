# Phase 0 capture templates

Fill-in templates for the external inputs that block Phase 0. Each maps to an input in
`docs/phase0/SOURCE_DATA_REQUEST.md` / `PHASE0_CLOSEOUT_PLAN.md §4` and to a place in the
calculation contract (`docs/phase0/CALCULATION_CONTRACT.md`) and the golden fixtures
(`docs/phase0/GOLDEN_FIXTURES.md`).

**Format:** every file is UTF-8, comma-delimited, with a header row and dot (`.`) decimals.
Numbers are plain (for example `250.00`, `25.5`). If Excel in a Norwegian locale splits the
columns wrong, import with "Fra tekst" and set comma as the delimiter (or re-save as semicolon +
comma decimals) — do not change the header names.

**Delete every row marked `EXAMPLE` before use.** The examples exist only to show the shape; they
are synthetic and must never be treated as real data.

## `cost_observations_template.csv` — inputs I4 / I6

One row per **pack bought**, with the store and the date the price was observed. This is the cost
catalogue for ad-hoc grocery purchases, where there is no supplier master. Feeds the cost-selection
precedence in `CALCULATION_CONTRACT.md §3` (DEC-047): a cost resolves as **latest approved supplier
price → latest cost observation → the item's manually maintained `current_cost`**. It also feeds §5
(pack → base-unit conversion) and the `supplier_packs` block in `GOLDEN_FIXTURES.md §1` / the B1 tables
in §2 for items with no supplier price.

The supplier price list is only for **real suppliers** (effective-dated, landed cost, invoice
matching). Anything bought ad hoc without a supplier relationship belongs here instead.

| Column | Meaning |
| --- | --- |
| `store` | Store the pack was bought from (free text, e.g. `Rema 1000`, `Kiwi`). |
| `item` | Ingredient/packaging name as you call it (e.g. `FLOUR`, `CHEESE`). |
| `pack_size` + `pack_unit` | Pack size and unit, e.g. `10` + `kg`, `1000` + `piece`. |
| `price_incl_vat` | Price for one pack **including VAT**, dot decimals. |
| `currency` | ISO code (`NOK` for Phase 1). |
| `observed_date` | Date the price was observed / the receipt is dated (`YYYY-MM-DD`). |
| `source` | Where the number came from: `receipt`, `manual` or `excel`. |
| `receipt_ref` | Receipt or file reference (leave blank for `manual`). |
| `notes` | Free text — VAT basis, promotions, pack comments. |

## `recipe_capture_template.csv` — input I5

One row per **component** of a recipe. Feeds `CALCULATION_CONTRACT.md §6` (recipe quantity and
yield, `COST-001/002`), the `recipe` block in `GOLDEN_FIXTURES.md §1` and the six fixtures in §2/§4.

The six fixture product names are already listed with blank component rows: **Cheese bun, Açaí
medium takeaway, Coffee drink, Cake slice, Quiche slice, Chicken pie**. Add one row per ingredient,
packaging and labour component. The **Coffee drink** example row set is filled in to show the shape.

| Column | Meaning |
| --- | --- |
| `product` | Fixture/product name. |
| `output_qty` + `output_unit` | How much one recipe/batch produces (e.g. `1` + `each`, `50` + `piece`). |
| `component_kind` | `ingredient`, `packaging`, `labour` or `other`. |
| `component` | Component name. Leave blank for a `labour` row that only carries time. |
| `qty` + `unit` | Quantity of the component per recipe (base units, e.g. `g`, `ml`, `piece`). |
| `loss_pct` | Trim/cooking loss percentage, `0` if none. |
| `prep_minutes` | Preparation time for the recipe or per portion (`CALCULATION_CONTRACT.md §7`). |
| `portion_size` | Portions the row's `output_qty` yields; `1` for per-portion rows. |
| `notes` | Free text — allergen, sub-recipe link, yield note. |

## `labour_rates_template.csv` — input I8

One row per **role × location**. Feeds `CALCULATION_CONTRACT.md §7` (`COST-004`
`loaded_hourly_rate`, `direct_labor_cost`) and the `labor` block in `GOLDEN_FIXTURES.md §1`.

| Column | Meaning |
| --- | --- |
| `role` | Job role (no employee names — aggregate only). |
| `location` | Location, or `All`. |
| `base_hourly_rate_nok` | Base hourly wage, NOK. |
| `holiday_pay_pct` | Holiday pay / feriepenger. Norwegian default **~12.0 %**. |
| `employer_tax_pct` | Employer tax / arbeidsgiveravgift. Norwegian default **~14.1 % (Oslo)**. |
| `pension_pct` | OTP pension. Norwegian default **2 %**. |
| `insurance_nok` | Insurance cost, NOK. |
| `other_cost_nok` | Any other employer cost, NOK. |
| `loaded_hourly_rate` | Loaded rate = all employer costs ÷ productive paid hours; leave blank to compute later. |
| `productive_hours_pct` | Productive share of paid hours (business assumption, e.g. `85`). |
| `notes` | Free text — correction, source payslip reference. |

## `opening_counts_template.csv` — input I7

One row per counted item. Feeds `DEC-004`/`DEC-017` and the Phase 2 opening stock position
(`CALCULATION_CONTRACT.md §13`, moving weighted average per `DEC-008`).

| Column | Meaning |
| --- | --- |
| `location` | Location counted. |
| `storage_area` | Storage area within the location. |
| `item` + `unit` | Item counted and its base unit. |
| `counted_qty` | Counted quantity in that unit. |
| `count_date` | Count date (`YYYY-MM-DD`). |
| `counter` | Person or role who counted (no personal data if avoidable). |
| `blind` | `true`/`false` — blind count before totals are revealed. |
| `notes` | Free text — variance, packaging state. |

## Where these feed the build

- **I4/I6** → cost catalogue (cost observations; supplier price only for real suppliers) → base-unit
  cost (B1) → cost cards (`PROC-002..005`, DEC-047).
- **I5** → recipe lines and yields (B0/B2/B3) → cost cards and theoretical consumption (`COST-001/002`).
- **I7** → opening stock position → Phase 2 valuation and variance.
- **I8** → loaded hourly rate → direct labour cost and contribution (`COST-004`, `COST-005/006`).

Cost observations / supplier prices (**I4/I6**), recipes/yields (**I5**) and labour rates (**I8**) are the
three genuine Phase 1 blockers — see `docs/phase0/UNBLOCK_CHECKLIST.md`.
