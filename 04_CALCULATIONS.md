# 4. Business Rules and Calculations

## 4.1 Calculation principles

- Store source quantity, unit, price, tax basis, currency, effective version and provenance.
- Use decimal arithmetic. Suggested internal precision: quantity 6 decimals, money components 4 decimals, presented NOK 2 decimals.
- Round only at defined boundaries; store the rounding method in snapshots.
- Calculate using net-of-recoverable-tax costs when the accountant confirms recovery. Gross and net views must remain available.
- Every result records location, channel, period/effective time, currency, rule version and freshness.
- Approved historical snapshots are immutable. Recalculation creates a new version.

## 4.2 Supplier pack and landed unit cost

```text
net_pack_price = gross_pack_price - recoverable_tax - discount
landed_pack_cost = net_pack_price + allocated_freight + import_fee + other_acquisition_cost
base_units_received = accepted_pack_quantity × pack_to_base_unit_factor
landed_base_unit_cost = landed_pack_cost / base_units_received
```

Reject a calculation if the conversion is missing, accepted quantity is not positive, currencies are mixed without an approved FX rate, or cost components lack a tax basis.

## 4.3 Recipe quantity and yield

For each recipe line:

```text
required_purchase_quantity = usable_quantity / usable_yield_rate
line_cost = required_purchase_quantity × selected_base_unit_cost
```

For a batch recipe:

```text
recipe_input_cost = sum(line_cost)
recipe_output_cost = recipe_input_cost + direct_batch_labor + batch_variable_cost
cost_per_usable_output_unit = recipe_output_cost / approved_usable_output
```

Expected trim/cooking loss belongs in the recipe/yield rule. Avoid counting the same loss again as operational waste. Actual abnormal loss is recorded as waste.

## 4.4 Product variable cost

```text
ingredient_cost = sum(recipe and sub-recipe component cost per portion)
packaging_cost = sum(packaging component cost)
direct_labor_cost = productive_minutes / 60 × loaded_hourly_rate
channel_variable_cost = percentage_fee × applicable_sales_basis + fixed_order_fee allocation
other_variable_cost = other unit/order-dependent costs

unit_variable_cost = ingredient_cost + packaging_cost + selected_direct_labor_cost
                   + channel_variable_cost + other_variable_cost
```

Direct labor must support two displayed views when staffing behavior is mixed:

1. contribution before standard direct labor;
2. contribution after standard direct labor.

## 4.5 Net sales and contribution

Tax configuration is effective-dated by product/service/channel and must be confirmed in Phase 0.

```text
net_sales = gross_sales - included_tax - discounts - refunds
unit_contribution = unit_net_sales - unit_variable_cost
contribution_margin_pct = unit_contribution / unit_net_sales × 100
period_contribution = sum(net_sales) - sum(variable_cost)
```

If net sales is zero or negative, percentage contribution is undefined and must not be displayed as zero.

## 4.6 Full cost and overhead allocation

Full cost is a decision view, not a claim that every allocated krone changes when one unit is sold.

```text
allocated_pool_amount = period_cost_pool × entity_driver_share
allocated_unit_overhead = allocated_pool_amount / eligible_units_or_driver_volume
unit_full_cost = unit_variable_cost + allocated_unit_overhead
full_cost_margin = unit_net_sales - unit_full_cost
```

Initial driver recommendations:

| Cost pool | Starting driver |
| --- | --- |
| Location rent/common cost | direct location assignment; occupied area for shared space |
| Utilities | location/equipment usage or production hours |
| Cleaning fixed contract | location operating hours or transactions |
| Management labor | recorded time or approved location share |
| Shared kitchen labor | standard/actual production minutes |
| Equipment depreciation/lease | workstation use, production hours or eligible products |
| Software/insurance/admin | revenue, transactions or equal company share |
| Front-of-house fixed labor | operating hours or transactions |

Every report must identify driver and denominator. A missing/zero denominator stops allocation or invokes an explicitly configured fallback; it never silently divides equally.

## 4.7 Price scenarios

Support solving for a target contribution percentage:

```text
required_net_price = unit_variable_cost / (1 - target_contribution_pct)
```

Gross price depends on configured tax and any fee whose basis is gross price. Percentage channel fees may require algebraic solving or iteration. Scenario output includes:

- proposed gross and net price;
- price change in NOK and percent;
- variable-cost components;
- contribution before/after standard direct labor;
- allocated full cost and margin;
- channel fee and tax;
- assumed unit volume, expected monthly revenue/contribution change;
- break-even volume and sensitivity to input-cost/volume changes.

Approval must not publish or activate a price outside the scenario scope.

## 4.8 Break-even and management metrics

```text
break_even_units = fixed_cost / weighted_average_unit_contribution
break_even_net_sales = fixed_cost / weighted_average_contribution_margin_pct
food_cost_pct = ingredient_cost / net_sales × 100
prime_cost = ingredient_or_COGS_cost + selected_direct_labor
waste_pct = waste_value / relevant_input_or_available_value × 100
stock_variance = counted_quantity - expected_quantity
stock_turn = COGS / average_inventory_value
sell_through = units_sold / units_available
forecast_error_pct = abs(actual - forecast) / actual × 100
```

Weighted averages must use the relevant expected or actual sales mix.

## 4.9 Inventory valuation

Use moving weighted average for operational valuation by item/location unless Phase 0 approves another policy:

```text
new_average_cost = (old_quantity × old_average_cost + receipt_quantity × receipt_unit_cost)
                   / (old_quantity + receipt_quantity)
```

Outbound movements use the average cost at posting time and retain it. Reversals restore quantity/value using the original movement value. Negative inventory should normally be blocked; an approved emergency override creates a high-priority exception and requires later revaluation.

## 4.10 Theoretical consumption

```text
theoretical_item_use = sum(sales_quantity × active_recipe_quantity_per_sale)
```

The policy must define whether theoretical consumption posts inventory per sale import, per day, or only as a comparison. Production of stocked intermediates must prevent double consumption between production and sales.

## 4.11 Menu engineering

Each product is assessed on contribution and popularity, then annotated with labor, waste, forecast reliability and strategic role. Thresholds may be median, category-relative or approved targets. The system must show the actual threshold and source period rather than only a label such as Star or Puzzle.

## 4.12 Forecasting

Start with explainable baselines by location/category/day:

- recent comparable periods;
- day of week;
- season, holiday and event factors;
- manager override with reason.

Store forecast version, method, training window, feature assumptions, prediction, interval, override and realized error. Advanced models are adopted only when they outperform the baseline for multiple periods and materially improve ordering, production or staffing decisions.

