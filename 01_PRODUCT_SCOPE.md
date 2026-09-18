# 1. Product Scope

## 1.1 Product objective

Create one trusted internal system that makes the economics and physical operation of Aquarela Kafé explainable from purchase to sale. Management must be able to see both locations separately and consolidated, understand what changed, drill from summaries to source records, and act on exceptions.

## 1.2 Success outcomes

- Every active sellable product has an approved, reproducible cost card.
- Ingredient, packaging, channel and selected direct-labor costs are visible per unit.
- Contribution and allocated full cost are shown separately.
- Sales totals reconcile to source systems and settlements within an approved tolerance.
- Stock quantity changes are traceable to receipts, production, sale consumption, transfer, waste, count or adjustment.
- Managers can compare planned production, actual output, sales and waste.
- Monthly operating results can be closed and later corrections remain explicit.
- Alerts identify cost changes, low stock, expiry risk, abnormal waste, missing mappings and stale data.
- Menu decisions combine popularity, contribution, labor, waste and operational complexity.
- Staff shifts and worked hours are planned and captured, and a monthly payroll-input report (employee, hours, hourly rate, expected pay) is produced for the accountant.

## 1.3 Users

| Role | Main responsibility | Typical access |
| --- | --- | --- |
| Owner / General Manager | Company performance, policy and approvals | All locations; financial and commercial records |
| Location Manager | Daily operation and local control | Assigned locations; stock, production, sales, tasks |
| Kitchen / Production | Plans, recipes, batches, yield and waste | Assigned production locations; limited cost visibility |
| Front of House | Availability, transfers, quick waste and close tasks | Assigned location; operational records only |
| Purchasing | Suppliers, items, prices, orders and receipts | Procurement and inventory; restricted payroll data |
| Finance / Controller | Costs, imports, reconciliation, close and export | Financial data; no operational editing unless assigned |
| System Administrator | Identity, configuration and integrations | Technical administration; sensitive data only when required |
| Read-only Analyst | Reporting and exports | Approved reporting scopes without mutations |

## 1.4 Functional modules

1. **Organization:** company, locations, storage areas, channels, users, roles and settings.
2. **Procurement:** suppliers, supplier items, pack conversions, purchase orders, receipts, invoices and cost history.
3. **Products and recipes:** ingredients, supplies, packaging, sub-recipes, recipe versions, yields, portions, allergens and product variants; the platform owns the product taxonomy (base / variant / add-on) and the SKU catalogue published to the POS (DEC-044).
4. **Cost control:** recurring and one-off costs, cost centers, fixed/variable classification, labor assumptions, assets and allocation drivers.
5. **Pricing:** cost cards, target rules, scenarios, approvals, channel-specific prices and effective dates.
6. **Inventory:** stock ledger, on-hand projection, lots, expiry, counts, adjustments, transfers, reorder policies and commitments.
7. **Production:** demand plan, production plan, batches, material consumption, output, yield, shelf life and availability.
8. **Workforce:** employees, roles, shift/rota planning, staff self-assignment to open shifts, worked hours and the monthly payroll-input report.
9. **Waste:** waste event, reason, quantity, value, source stage, responsibility and corrective action.
10. **Sales:** import, validation, product mapping, discounts, refunds, taxes, fees and channel attribution.
11. **Reconciliation:** sales-source totals, payment/settlement totals, exception queue and period close.
12. **Insights:** dashboards, trends, variance, menu engineering, forecast (starting at daily location/category grain and automatically promoting to product-level grain once a clean-history threshold is met, always showing the active grain), budget and scenario comparison, and AI-assisted advisory analysis and suggestions.
13. **Commercial planning:** seasonal calendar, competitor observations, experiments, recommendation workflow and AI-assisted advisory suggestions.
14. **Tasks and alerts:** actionable exceptions, ownership, due dates, comments and resolution evidence.
15. **Administration:** audit, data quality, imports, integrations, period locks, exports and retention.

## 1.5 In scope for first operational MVP

- Both locations and company consolidation.
- Manual entry plus controlled CSV imports.
- Suppliers, items, receipts and purchase-price history.
- Recipe/sub-recipe versioning, yield, packaging and cost cards.
- Fixed/variable operating costs and a small approved set of overhead pools.
- Price scenarios and approval workflow.
- Inventory movements, counts, transfers, production batches and waste.
- Workforce scheduling: employee records, shift/rota planning, staff self-assignment to open shifts and worked-hours capture.
- A monthly payroll-input report (employee, hours, hourly rate, expected pay) for the accountant.
- Daily sales import, product mapping and source-total reconciliation.
- Per-source approved publishing of prices and menu data to external systems (POS and Medusa/Sanity
  first; Wolt and Fiken later), governed by per-source allowed-operations approval, confirmation
  read-back and rollback (DEC-015).
- Daily/weekly/monthly reporting and a basic menu engineering matrix.
- Role-based access, audit log, backups, import monitoring and exports.

> Note: workforce scheduling, worked hours and the monthly payroll-input report expanded the first
> operational MVP by owner decision (DEC-037); the monthly report is a payroll **input**, not payroll
> processing.

## 1.6 Explicitly later

- Automatic invoice extraction.
- Barcode or QR scanning beyond prepared interface hooks.
- Advanced machine-learning forecasting.
- Automated competitor crawling without approved sources and legal review.
- Statutory payroll processing, tax withholding and payslip generation.
- General-ledger replacement, statutory accounting or tax filing.
- Customer CRM, loyalty and marketing automation.

> Scope note (DEC-039): AI-assisted analysis and suggestions are advisory only and require human
> approval; they never auto-publish prices, place orders or change menus. Scheduled AI analysis depends
> on an external LLM provider and is subject to a provider data-processing/privacy (DPA) review before
> use. This does not change the non-goal that commercial decisions require human approval.

> Scope note (DEC-015): per-source approved publishing of prices and menu data to external systems
> (POS, Medusa/Sanity, later Wolt and Fiken) moved into scope — see §1.5 and §1.8. Free-form
> bidirectional sync is still out of scope. Statutory payroll processing, tax withholding and payslip
> generation (DEC-037), general-ledger replacement and statutory accounting or tax filing remain later.

## 1.7 Non-goals

The platform is not a POS, webshop, accounting system, payroll engine or food-safety certification system. It is not a payroll processor: it does not run statutory payroll or produce payslips, but it does hold the minimum operational employee and shift information required for control and it does produce a payroll-input report for the accountant. It may integrate with those systems.

## 1.8 Operating principles

- Source evidence is preserved; summaries are drillable.
- Current truth and historical truth are both available.
- Totals without scope, period, currency, tax basis and freshness are invalid UI.
- Contribution and allocated full cost must not be conflated.
- Manual overrides require a reason and are visible in reports.
- Internal cost/price decisions are the source of truth; external writes are push-only from approved
  internal changes, one operation per approved source, never a free-form bidirectional sync (DEC-015).
- Repeated imports and retried jobs must be safe.
- The mobile experience is optimized for short operational transactions, not dense analysis.

