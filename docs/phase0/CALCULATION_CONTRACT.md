# Phase 1 Calculation Contract

Status: **Draft for finance + product-owner sign-off.** Every `[PROPOSED]` value is a decision
(DEC-xxx) until signed. This contract is the single authority for Phase 1 cost and price math; it
supersedes `04_CALCULATIONS.md` where they differ. Phase 2 inventory valuation is defined here only
where Phase 1 depends on it.

> **ACCEPTED DECISIONS.** DEC-003, DEC-006, DEC-021, DEC-022, DEC-023 and DEC-024 were accepted on
> 2026-09-13 (`12_OPEN_DECISIONS.md`). Their values are binding and this contract reflects them.
> DEC-003 sets the rate split: 25% output VAT for dine-in/restaurant service and 15% for takeaway,
> catering and pre-orders; input VAT is recoverable where the purchase carries VAT. Recoverability
> for restricted cases (staff meals and own-consumption purchases) remains for accountant
> confirmation before production use.

Pins: `DEC-003` tax, `DEC-006` direct labor, `DEC-007` overhead, `DEC-008` valuation,
`DEC-021` cost selection, `DEC-022` tax model, `DEC-023` FX, `DEC-024` rounding.
Requirements: COST-005/006/007/008, PRICE-001..004, PROC-003.

## 1. Precision, rounding and types

| Concept | Storage type | Scale | Notes |
| --- | --- | --- | --- |
| Quantity | `numeric` | 6 dp | paired with `unit_id`; never float |
| Money component | `numeric(19,4)` | 4 dp | ISO currency code alongside |
| Presented money (NOK) | derived | 2 dp | display/report only |

- Method: **HALF_UP** `[PROPOSED — DEC-024]`; accountant may require HALF_EVEN.
- Round **once at each named boundary**, never at intermediate algebra:
  - B0 quantity → 6 dp (required purchase quantity; quantity scale)
  - B1 landed cost → 4 dp (`PROC-003`)
  - B2 line cost → 4 dp
  - B3 per-unit totals → 4 dp
  - B4 presented money → 2 dp
- Never round percentages; store as `numeric(9,6)`. `contribution_margin_pct` is stored at 6 dp, not
  rounded to a money boundary.
- `CalculationSnapshot` stores: method, scale per boundary, software/rule version, and every input
  reference. Reproducibility means re-running stored inputs + method + scales yields the same
  values at the same boundaries within `10^-scale`.

## 2. Tax basis (DEC-003 / DEC-022)

Every monetary input and output carries a `tax_basis` ∈ {`inclusive`, `exclusive`}; every tax code
carries `recoverable: boolean`.

- Costs are converted to **net of recoverable tax** before costing (`04:8`). Gross and net views
  remain available on every figure (`08:55`).
- Sales: `net_sales = gross_sales − included_tax − discounts − refunds` (`04:65`).
- Rates are effective-dated by product/service type × channel × location scope.
- A calculation is **rejected** (not defaulted) when a monetary component lacks a tax basis
  (`04:21`).

**Line VAT resolution order (DEC-045).** A sales line resolves its rate in a defined order:

1. **Fixed item rate** where the item's tax rule is `tax_treatment = fixed` — for example books at **0 %**, or
   retail packs such as flour mixes and coffee bean bags at **15 %**.
2. Otherwise the **item default rate with a channel override** (`tax_treatment = channel_overridable`) — for
   example eat-in **25 %** / takeaway **15 %** on the same product.

The resolved rate must be stored as `applied_tax_rate` on the sales line so the applied VAT can be reconciled
against the POS export; it is never re-derived from the product alone after import.

## 3. Cost selection (DEC-021, DEC-047) — the Phase 1 anchor

Cost selection resolves in strict precedence; the first source that yields a cost wins:

```
selected_base_unit_cost(item, location, as_of)
  = 1. latest approved landed_base_unit_cost (supplier_price)
       for the item effective on or before as_of
    else 2. latest recorded cost observation for the item
       observed on or before as_of, converted to the base unit
    else 3. item.current_cost (manually maintained fallback)
```

- `selected_base_unit_cost` is the **policy-selected** cost. The default policy is
  `latest_approved_price`, i.e. the latest approved landed base-unit cost effective on or before
  `as_of` (replacement cost), snapshotted. It is intentionally **not** the inventory moving weighted
  average used for valuation (DEC-008).
- **Precedence (DEC-047).** Most items are bought ad hoc from grocery stores with no supplier master, so
  a supplier price often does not exist. The cost then falls back to the latest `cost_observation`
  (receipt, manual or Excel source) on or before `as_of`; only when neither exists does it use the item's
  manually maintained `current_cost`. The snapshot stores `source_type` (which of the three supplied the
  value) and the `observed_at`/effective date, so the origin is reproducible.
- A cost observation is a pack price converted to the item base unit (`pack_price / pack_size`, or via the
  package conversion), consistent with §5; a missing conversion rejects the calculation.
- Selection policy is configurable per item (`cost_selection_policy` enum:
  `latest_approved_price` default, `moving_weighted_average`, `standard_cost`).
- **Risk:** because the default is a replacement cost, a single out-of-pattern purchase can move
  every affected cost card; the owner may instead choose moving weighted average per item — see
  DEC-021.
- A recipe/cost card is **not approvable** only when none of the three sources (approved supplier price,
  cost observation, `current_cost`) exists for a required item.

## 4. FX (DEC-023)

- NOK is the only reporting currency for Phase 1. Foreign-currency amounts store `currency`,
  `amount`, `exchange_rate_id`.
- Rate source: Norges Bank daily reference `[PROPOSED]`; rate date = document/receipt date.
- Reject a calculation that mixes currencies without a resolved `ExchangeRate` (`04:21`).
- No FX revaluation in MVP.

## 5. Supplier pack and landed cost (PROC-003)

```
net_pack_price        = gross_pack_price − recoverable_tax − discount
landed_pack_cost      = net_pack_price + allocated_freight + import_fee + other_acquisition_cost
base_units_received   = accepted_pack_quantity × pack_to_base_unit_factor
landed_base_unit_cost = round(landed_pack_cost / base_units_received, 4 dp, HALF_UP)   # B1
```

Reject when: conversion missing, `base_units_received <= 0`, currency unresolved, or a component
lacks a tax basis. `accepted_pack_quantity` excludes rejected quantity.

## 6. Recipe quantity and yield (COST-001/002)

```
usable_yield_rate           = approved_usable_output / planned_input          # ∈ (0,1]
effective_line_qty          = recipe_line.quantity / loss_factor
required_purchase_quantity  = round(effective_line_qty / usable_yield_rate, 6 dp)  # B0
line_cost                   = round(required_purchase_quantity × selected_base_unit_cost, 4 dp)  # B2
```

Batch:

```
recipe_input_cost            = Σ line_cost
recipe_output_cost           = recipe_input_cost + direct_batch_labor + batch_variable_cost
cost_per_usable_output_unit  = round(recipe_output_cost / approved_usable_output, 4 dp)  # B3
```

- Expected trim/cooking loss lives in the yield rule; it is **not** re-counted as operational waste
  (WASTE-002). Actual abnormal loss is a waste event.
- Circular sub-recipes are prohibited; approved recipes cannot depend on drafts (COST-002).
- Sub-recipe cost is computed bottom-up and stored as an intermediate snapshot component.

## 7. Product variable cost (COST-005)

```
ingredient_cost       = Σ (recipe & sub-recipe component cost per portion)
packaging_cost        = Σ (packaging component cost for location/channel)
direct_labor_cost     = round(productive_minutes / 60 × loaded_hourly_rate, 4 dp)
channel_variable_cost = percentage_fee_rate × fee_basis_amount + fixed_order_fee_per_unit
other_variable_cost   = other unit/order-dependent costs
```

- `fee_basis_amount` is gross or net per `fee_basis` ∈ {`gross_price`,`net_price`,`per_order`}
  `[PROPOSED — part of DEC-022/PRICE-001]`. Default: percentage commission on **net** price; fixed
  per-order fees allocated by order size.
- `loaded_hourly_rate = (wage + employer_charges + holiday_pay + pension + approved payroll cost)
  / productive_paid_hours` (COST-004).
- Direct labour uses the **role/cost-centre loaded rate**. A **working owner**'s production time is
  **imputed at the kitchen loaded rate** (COST-013, DEC-048) even though unpaid, so the contract
  supports both an **economic view** (imputed owner labour included) and a **cash view** (excluded).
  The statutory/cash P&L shows no salary; hiring a paid replacement later makes the imputation an
  actual cost with no formula change.

Two mandatory labor views when staffing behavior is mixed (DEC-006, COST-006):

```
contribution_before_direct_labor = unit_net_sales − (ingredient + packaging + channel + other)
contribution_after_direct_labor  = contribution_before_direct_labor − direct_labor_cost
```

## 8. Net sales and contribution (PRICE-001)

```
unit_net_sales          = unit_gross_sales − included_tax − unit_discount − unit_refund
unit_contribution       = unit_net_sales − unit_variable_cost
contribution_margin_pct = unit_contribution / unit_net_sales × 100
```

If `unit_net_sales <= 0`, contribution percentage is undefined and must render as "n/a", never 0
(`04:71`).

## 9. Full cost and allocation (COST-007)

```
allocated_pool_amount   = period_cost_pool × entity_driver_share
allocated_unit_overhead = allocated_pool_amount / eligible_driver_volume
unit_full_cost          = unit_variable_cost + allocated_unit_overhead
full_cost_margin        = unit_net_sales − unit_full_cost
```

- Drivers and denominators are explicit per `AllocationRule` (DEC-007). Default pool→driver table:
  `04:84-95`. Start with a small number of pools.
- Missing/zero denominator **stops allocation** or invokes a configured fallback; never divides
  silently (`04:97`).
- Contribution and full cost are always shown separately (`01:82`).

## 10. Price scenarios and target solving (PRICE-004)

```
required_net_price = unit_variable_cost / (1 − target_contribution_pct)
```

- If a fee basis is `gross_price`, solve algebraically or by bounded iteration; the solved gross
  price must satisfy the net-price equation within 4 dp.
- Scenario output must include: gross/net price, tax, fees, contribution before/after labor, full
  cost, margin, volume assumption, expected monthly effect, break-even volume, sensitivities.
- Approval may create a `PriceVersion` only for the approved scope; unapproved scenarios can never
  become effective (PRICE-003).

## 11. What every snapshot must store (COST-008)

- all input quantities, units, unit costs and their `SupplierPrice`/`CostObservation`/receipt references;
- cost-selection policy + as-of date (DEC-021) and, per resolved cost, its `source_type`
  (`supplier_price` / `cost_observation` / `current_cost`) and `observed_at` (DEC-047);
- tax rule version and basis (DEC-022);
- FX rate + rate date (DEC-023);
- rounding method + scales (DEC-024);
- allocation rule version and denominator;
- yields, portion and labor assumptions;
- software version / rule version;
- all intermediate values at B0–B4, not only totals.

## 12. Rejection rules (must not silently default)

1. missing unit conversion or incompatible dimension;
2. `accepted_quantity <= 0` or `approved_usable_output <= 0`;
3. mixed currencies without a resolved rate;
4. monetary component without a tax basis;
5. recipe depending on a draft or forming a cycle;
6. allocation with zero/missing denominator and no configured fallback;
7. target price that is unattainable with the given fee basis.

## 13. Ledger corrections, cost concurrency and period lock

- Reversals never restate downstream movements; they post a value correction. Automatic reversal is
  blocked when reconciled downstream sales depend on the original (DEC-028).
- Postings that change item cost serialize per `(organization, item, location)` via
  `SELECT … FOR UPDATE` on the `stock_balance` row, with bounded retry (DEC-034).
- Allocation denominators and recurring costs are frozen at period lock; corrections require a new
  approved rule version in an adjustment period (DEC-027).

## 14. Acceptance tests for this contract

- One worked fixture per `docs/phase0/GOLDEN_FIXTURES.md` reproduces every B0–B4 component.
- Changing a supplier price lists every affected active product (PROC-005, PRICE-001).
- Two implementations following this contract produce identical values at the same boundaries and
  differ by ≤ `10^-scale` after rounding (COST-008, `09:38`).
- Re-running a signed snapshot with its stored inputs is bit-identical at B0–B4.

## 15. Open items blocking sign-off

- DEC-003 caveat on staff-meal and own-consumption recoverability (accountant confirmation).
