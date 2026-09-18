# Phase 1 Golden Calculation Fixtures

Status: **TEMPLATE + ILLUSTRATIVE worked examples.** The numbers below are synthetic placeholders used
to prove the structure and the math contract. They are **not approved figures**. Finance and the
product owner must replace them with real supplier/recipe/labor data and sign before they become the
release gate (`09:75`).

> **ILLUSTRATIVE ONLY** — these numbers are synthetic and MUST NOT be used to implement or validate
> calculations. They are `status: invalid_until_dec003`. Replace with real, signed data before any
> use.

Fixture authority: `09_TESTING_AND_ACCEPTANCE.md:15-26` (six products, component-level comparison,
owner sign-off) and `docs/phase0/CALCULATION_CONTRACT.md`.

## 1. Fixture schema

Each fixture is a YAML file under `tests/fixtures/` with this shape (fields map to the calculation
contract §5–§10). It stores **inputs and expected intermediates**, not only final totals.

```yaml
id: cheese_bun
version: 1
status: invalid_until_dec003 | illustrative | signed
signed_by: [finance, product_owner]
signed_at: null
source_refs: [supplier_invoice_ids, recipe_doc, labor_rate_ref]
tax_basis: exclusive | inclusive
currency: NOK
supplier_packs:
  - item_code: FLOUR
    pack_unit: bag
    pack_to_base_factor: 10000        # to grams
    gross_pack_price: "250.00"
    discount: "0.00"
    recoverable_tax: "false"
    freight: "0.00"
    import_fee: "0.00"
    tax_basis: inclusive
recipe:
  kind: batch
  planned_input_qty: "6.65"           # kg mixed input (illustrative)
  approved_usable_output: "50"        # buns
  planned_output_qty: "50"
  lines:
    - component: FLOUR
      qty: "3000"
      unit: g
      loss_factor: "1.000000"
    # ...
labor:                                  # loaded rates: docs/phase0/LABOUR_ASSUMPTIONS.md
  loaded_hourly_rate: "306.57"          # kitchen (NOK 240 base); front of house = 268.25
  productive_minutes_per_unit: "0.5"    # includes any owner production time, imputed at the kitchen rate
  # views: economic (imputed owner labour included) vs cash (excluded) — DEC-048 / COST-013
packaging:
  - component: PAPER_BAG
    qty: "1"
    unit: piece
channel:
  - channel: takeaway
    gross_price: "39.00"
    tax_rate_pct: "15.000000"
    fee_basis: net_price
    commission_pct: "0.000000"
expected:
  B1_landed_base_unit_cost: {}        # item -> value (4 dp)
  B2_line_cost: {}                    # item -> value (4 dp)
  B3_cost_per_usable_output_unit: "5.8800"
  ingredient_cost: "5.8800"
  packaging_cost: "0.9000"
  direct_labor_cost: "2.5548"
  unit_variable_cost_before_labor: "6.7800"
  unit_variable_cost_after_labor: "9.3348"
  unit_net_sales: "33.9130"
  contribution_before_direct_labor: "27.1330"
  contribution_after_direct_labor: "24.5782"
  contribution_margin_pct: "72.4743"                # after direct labor
  contribution_margin_pct_before_labor: "80.0077"   # before direct labor
rounding:
  method: HALF_UP
  scales: {qty: 6, money: 4, presented: 2}
```

## 2. Illustrative fixture A — cheese bun (batch, takeaway)

> All values illustrative. Input-VAT recoverability for food/restaurant is restricted in Norway and
> is the accountant's call (DEC-003). This fixture shows the non-recoverable case; a recoverable
> variant must be produced once DEC-003 is accepted. Net (ex-VAT) and gross (inc-VAT) figures are
> shown explicitly throughout.

**Supplier packs → landed base-unit cost (B1):**

| Item | Pack | Factor | Gross | Recoverable | Net pack | Landed | Landed/unit (B1, 4 dp) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FLOUR | 10 kg bag | 10 000 g | 250.00 | 0 | 250.00 | 250.00 | 0.0250 / g |
| MILK | 1 L carton | 1 000 ml | 24.00 | 0 | 24.00 | 24.00 | 0.0240 / ml |
| CHEESE | 2 kg block | 2 000 g | 240.00 | 0 | 240.00 | 240.00 | 0.1200 / g |
| BUTTER | 500 g | 500 g | 45.00 | 0 | 45.00 | 45.00 | 0.0900 / g |
| YEAST | 500 g | 500 g | 25.00 | 0 | 25.00 | 25.00 | 0.0500 / g |
| PAPER_BAG | 1 000 pcs | 1 000 pc | 850.00 | 0 | 850.00 | 850.00 | 0.8500 / pc |
| NAPKIN | 5 000 pcs | 5 000 pc | 250.00 | 0 | 250.00 | 250.00 | 0.0500 / pc |

**Recipe lines (B2):**

| Item | Qty | × unit cost | Line cost (4 dp) |
| --- | --- | --- | --- |
| FLOUR | 3 000 g | 0.0250 | 75.0000 |
| MILK | 1 500 ml | 0.0240 | 36.0000 |
| CHEESE | 1 200 g | 0.1200 | 144.0000 |
| BUTTER | 400 g | 0.0900 | 36.0000 |
| YEAST | 60 g | 0.0500 | 3.0000 |
| **batch input** | | | **294.0000** |

`B3` here stores the batch **ingredient** cost per usable output unit: `294.0000 / 50 = 5.8800`.
Direct batch labor is added afterwards per portion. This matches the two-view labor presentation in
`CALCULATION_CONTRACT.md` §6–§7: the contract's batch-level `B3`
`cost_per_usable_output_unit` includes `direct_batch_labor`, while this fixture keeps ingredient and
portion labor separate.

**Per portion (takeaway):** ingredient 5.8800 + packaging (bag 0.8500 + napkin 0.0500 = 0.9000) =
**6.7800**; direct labor `0.5/60 × 306.57 = 2.5548` (kitchen loaded rate,
`docs/phase0/LABOUR_ASSUMPTIONS.md`); **6.7800 before labor / 9.3348 after labor**. Any owner
production time is included in this labour input at the same kitchen loaded rate (DEC-048); these
figures are the **economic view** (imputed owner labour included) — the **cash view** excludes it
(COST-013).

**Tax / net sales (B4):** gross **39.00 inc-VAT** inclusive 15% → net **33.9130 ex-VAT**
(`39 / 1.15 = 33.9130`, 4 dp). `contribution_before = 33.9130 − 6.7800 = 27.1330`;
`after = 24.5782`; margin **72.4743% after labor** (**80.0077% before labor**).

## 3. Illustrative fixture B — coffee drink (channel differences, `09.2`)

Ingredients 4.5000; direct labor 0.4 min × 268.25/h = 1.7883 (front-of-house loaded rate,
`docs/phase0/LABOUR_ASSUMPTIONS.md`).

| Channel | Gross | Net @15% | Packaging | Fee (basis) | Variable before labor | After labor | Contribution (after) | Margin |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dine_in | 49.00 | 42.6087 | 0.0000 | 0 | 4.5000 | 6.2883 | 36.3204 | 85.24% |
| takeaway | 52.00 | 45.2174 | 1.5000 | 0 | 6.0000 | 7.7883 | 37.4291 | 82.78% |
| wolt | 62.00 | 53.9130 | 1.5000 | 16.1739 (30% of net) | 22.1739 | 23.9622 | 29.9508 | 55.55% |

Demonstrates: channel-specific price, packaging and fee basis all change contribution; the same net
price math applies everywhere.

## 4. Remaining fixtures (to be built from real data)

| # | Product | Machine id | Must exercise |
| --- | --- | --- | --- |
| 3 | açaí medium takeaway | acai_medium_takeaway | prepared base sub-recipe, topping options, packaging |
| 4 | cake slice | cake_slice | batch yield, decoration sub-recipe, waste event |
| 5 | quiche slice | quiche_slice | batch yield + direct labor |
| 6 | chicken pie | chicken_pie | **nested** sub-recipe, labor-intensive production |

## 5. Acceptance and sign-off

- Tests compare stored components at B0–B4, not only final totals (`09:26`).
- Each signed fixture reconciles with a manual owner-approved computation (`09:75`); differences are
  resolved and recorded before sign-off.
- Signed fixtures are versioned; changing an approved fixture requires a new version and re-sign-off.
- Sign-off table:

| Product | Fixture (machine id) | Version | Finance | Product owner | Date | Source refs |
| --- | --- | --- | --- | --- | --- | --- |
| cheese bun | cheese_bun | — | ⬜ | ⬜ | | |
| açaí medium takeaway | acai_medium_takeaway | — | ⬜ | ⬜ | | |
| coffee drink | coffee_drink | — | ⬜ | ⬜ | | |
| cake slice | cake_slice | — | ⬜ | ⬜ | | |
| quiche slice | quiche_slice | — | ⬜ | ⬜ | | |
| chicken pie | chicken_pie | — | ⬜ | ⬜ | | |

## 6. Inputs required before sign-off

Real supplier packs/prices (I4), recipe documents and yields (I5), labor rates (**I8** — loaded
rates in `docs/phase0/LABOUR_ASSUMPTIONS.md`: front of house 268.25, kitchen 306.57), tax rates
and recoverability (I9), and packaging costs (I4). Owner production time is included at the kitchen
loaded rate (306.57) and both the economic (imputed owner included) and cash (excluded) views are
reported (DEC-048, COST-013). Without DEC-003/021/022/024 signed, fixtures remain illustrative.
