# 9. Testing and Acceptance

## 9.1 Test layers

- **Unit:** value objects, conversions, calculations, state transitions, validation and permissions.
- **Property/invariant:** conversion consistency, balanced movement values, snapshot reproducibility, idempotency and rounding bounds.
- **Database integration:** constraints, repositories, effective-date overlap, transactions, locks and migrations.
- **Application/API:** authorization, commands, errors, concurrency and audit.
- **Connector contract:** source fixtures, schema drift, mapping, totals and replay.
- **End-to-end:** core user workflows on desktop/mobile viewports.
- **Security:** authorization matrix, file access, CSRF/session, injection and sensitive-log review.
- **Performance:** representative catalog, movement, sales and reporting volumes.
- **Recovery:** backup restore, failed migration rollback, dead-letter import replay.

## 9.2 Golden calculation fixtures

Create reviewed fixtures for at least:

1. cheese bun: batch recipe, yield and unit sale;
2. açaí medium takeaway: prepared base, topping options and packaging;
3. coffee drink: ingredient, cup/lid and channel differences;
4. cake slice: batch yield, decoration/sub-recipe and waste;
5. quiche slice: batch yield and labor;
6. chicken pie: nested recipe and labor-intensive production.

Each fixture contains supplier packs, unit conversions, prices/tax basis, recipe/yield, labor, packaging, selected overhead policy, expected intermediate results and final results. Finance/product owners sign the expected calculations. Tests compare components, not only final totals.

## 9.3 Critical invariants

- No approved recipe contains a draft dependency or sub-recipe cycle.
- No effective-dated version overlaps within the same scope.
- Posted stock history cannot be edited or deleted.
- Every stock balance equals the sum of its movements at the same cutoff.
- Accepted receipt, completed batch, received transfer and approved count post atomically.
- Reversal references and financially offsets the original according to policy.
- Import replay cannot duplicate canonical transactions or lines.
- Closed-period facts cannot change without authorized correction workflow.
- Cost snapshots can be reproduced from stored components within rounding tolerance.
- Users cannot read or mutate records outside location/module scope.

## 9.4 Functional acceptance scenarios

### Cost and pricing

- Create an ingredient in a supplier pack and calculate landed base-unit cost.
- Create nested recipe versions with yield, portion, packaging and labor.
- Trace a cost-card number to its supplier price/recipe/rule inputs.
- Change supplier price and list every affected active product.
- Compare price scenarios by location/channel and approve a future price.
- Preserve the previous approved cost/price result after inputs change.

### Inventory, production and waste

- Receive stock with lot/expiry and see balance/movement/value update.
- Complete a batch and post actual input/output/waste with yield variance.
- Dispatch/receive a transfer and expose discrepancies.
- Complete a blind count and approve an adjustment.
- Explain stock variance between cutoffs from movements and unresolved difference.
- Produce reorder suggestions from stock, commitments, lead time and safety stock.

### Sales and close

- Import, validate, map and post a representative POS file.
- Repeat the import without duplicate sales.
- Correct a posted source record using linked reversal/adjustment.
- Reconcile source sales and settlement within tolerance.
- Close a day/month and block unauthorized backdated change.
- Filter reports by location, channel, category, product and period with freshness.

## 9.5 Release gates

No pilot release until:

- all Must requirements for that phase have passing acceptance tests;
- golden fixture calculations reconcile with manual owner-approved results;
- import totals reconcile for representative real files;
- permissions are tested for every role/scope combination;
- backup restore succeeds in staging;
- migration and rollback procedure is rehearsed;
- critical/high security findings are resolved;
- support/runbook ownership is assigned;
- pilot users complete core flows without blocking usability issues.

No company-wide adoption until one location completes at least one full operating and close cycle in parallel with the existing process and differences are resolved.

## 9.6 Defect severity

- **Critical:** data loss/corruption, security boundary failure, duplicated financial/stock postings or unrecoverable close error.
- **High:** wrong calculation, unreconciled totals hidden, workflow cannot complete or audit missing.
- **Medium:** workaround exists; confusing report, validation or operational friction.
- **Low:** cosmetic/non-blocking issue.

Critical issues block any release. High issues block the affected workflow unless explicitly accepted with containment and deadline.

## 9.7 Traceability

Every test case references requirement IDs and, where relevant, a decision/ADR and golden fixture version. CI reports coverage by requirement group; code coverage alone is not acceptance evidence.

