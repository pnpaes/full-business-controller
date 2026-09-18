# 5. Workflows and State Machines

## 5.1 Common workflow rules

- Commands validate permission, scope, state, required evidence and period lock.
- Submit/approve/reject are separate actions with actor and timestamp.
- The requester may not approve sensitive changes when segregation is enabled.
- Posted records are corrected with reversal or adjustment.
- Alerts and tasks link to the exact record and recommended next action.

## 5.2 Supplier receipt

1. Create or select supplier/order.
2. Enter delivery reference, location and received time.
3. Enter line, supplier pack, received/accepted/rejected quantity, price, discount, tax, lot and expiry.
4. Convert accepted quantities to base units and calculate landed cost.
5. Validate conversions, duplicate document references, unexpected price variance and expiry.
6. Submit; authorized user accepts or rejects.
7. Acceptance atomically posts receipt stock movements, supplier-price history and evidence links.
8. Price changes above threshold create affected-product review tasks.

States: `DRAFT -> SUBMITTED -> ACCEPTED`; `SUBMITTED -> REJECTED`; accepted receipt may be `REVERSED` through a linked reversal.

## 5.3 Recipe change and cost card

1. Copy the current approved version into a draft.
2. Edit lines, quantities, conversions, yield, portion, labor, packaging and allergens.
3. Validate no cycles, missing costs, invalid units or overlapping effective dates.
4. Preview affected products and compare old/new variable cost.
5. Submit with change reason.
6. Approve with effective date; previous version remains historical.
7. Queue recalculation of affected draft/current cost views and alerts where thresholds are crossed.

Approved recipe versions are immutable. Emergency corrections create a new version.

## 5.4 Pricing

1. Select product variant, location(s), channel(s) and proposed effective date.
2. Load an approved/reproducible cost-card basis.
3. Enter proposed price or target margin and volume assumption.
4. Calculate tax, fees, contribution, full cost, expected period effect and sensitivities.
5. Compare current and proposed values.
6. Submit with reason and optional supporting experiment.
7. Approve; create future/current `PriceVersion` only for approved scope.
8. Publishing to external systems is manual in MVP and recorded as a completion task.

## 5.5 Production plan and batch

1. Demand view combines forecast, orders/commitments, current usable stock, expiry and safety stock.
2. Manager accepts or overrides suggested production quantity with reason.
3. Batch starts against an approved recipe version and reserves/validates inputs.
4. Operator records actual input exceptions, output quantity, waste, lot and expiry.
5. Completion atomically posts input consumption, finished/intermediate output and linked waste.
6. Yield variance outside tolerance creates a review task.

States: `PLANNED -> RELEASED -> IN_PROGRESS -> COMPLETED`; cancellation allowed before completion; completed corrections use reversing movements.

## 5.6 Transfer

1. Request items/quantities from source storage/location.
2. Source approves and dispatches, creating stock-in-transit and source reduction.
3. Destination receives actual quantity, records damage/difference and creates destination stock.
4. Differences create an exception linked to both sides.

States: `DRAFT -> REQUESTED -> APPROVED -> DISPATCHED -> RECEIVED`; cancellation rules depend on whether anything was dispatched.

## 5.7 Waste

Fast entry must require location, item/product/batch, quantity/unit, stage and reason. Optional photo/note and corrective action can follow. Value is calculated from the relevant cost method and stored in a snapshot. Waste linked to a batch affects actual yield but is not double-counted.

Waste stages: receiving, storage/expiry, preparation, production, display, unsold finished goods, customer/return, count-discovered and other.

## 5.8 Stock count

1. Define location, storage areas, item scope and count time.
2. Snapshot expected quantities; optionally hide them from counters.
3. Assign count sheets and record counted quantity/lot.
4. Recount thresholds and missing items before submission.
5. Reviewer sees value/quantity variance and movements near cutoff.
6. Approval posts variance adjustments with reason and closes the count.

Movement cutoff must be explicit. Backdated postings into a closed count window trigger review.

## 5.9 Sales import

1. Upload/select source and mapping profile.
2. Hash file and reject/recognize duplicates.
3. Parse into staging without changing canonical sales.
4. Validate schema, period, currency, location, totals and row identity.
5. Map external products/channels/taxes; unresolved rows enter a review queue.
6. Preview source totals versus accepted/rejected/unmapped totals.
7. Post valid rows when the import policy allows partial posting.
8. Replaying the same file or records must not duplicate sales.
9. Corrections create explicit reversals/adjustments and are linked to source records.

Import states: `UPLOADED -> PARSED -> NEEDS_REVIEW|VALIDATED -> POSTED`; failures can be retried safely; superseded runs remain visible.

## 5.10 Daily close

- verify sales import freshness and source totals;
- review unmapped/invalid sales;
- compare payments/settlements where available;
- review incomplete batches/transfers and high-priority stock exceptions;
- confirm waste and operational notes;
- close by location/day with approver and snapshot.

## 5.11 Month close

1. Ensure every day/location is reconciled or has an approved exception.
2. Confirm supplier costs, recurring costs, labor assumptions and allocation denominators.
3. Resolve or disclose inventory/count differences.
4. Generate contribution, full-cost, waste and location/channel reports.
5. Review data-quality report and exceptions.
6. Approve period snapshot and lock mutations affecting the period.
7. Export approved summaries and references to accounting.
8. Later correction uses a controlled adjustment period or reopen permission with audit.

## 5.12 Competitor and seasonal planning

Manual observation records source URL, observed date, product/offer, price, season and reviewer. A seasonal planning cycle reviews own sales/margins/waste, competitor observations, calendar factors and operational capacity. Recommendations require evidence and are converted into approved experiments or menu/price tasks.

