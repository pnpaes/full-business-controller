# 8. Interface Specification

## 8.1 Navigation

Primary areas:

1. Home
2. Sales
3. Products
4. Production
5. Inventory
6. Purchasing
7. Costs
8. Insights
9. Tasks
10. Documents (staff document library; visible to all staff)
11. HMS (monitoring, incidents, checklists, equipment; visible to operators and managers)
12. Administration

Navigation is role-aware, but authorization never depends on hidden links. A persistent scope control shows company/location and date context.

## 8.2 Role home screens

- **Owner/GM:** consolidated performance, location comparison, cash/margin risks, approvals and upcoming decisions.
- **Location manager:** today’s forecast, production, stock exceptions, sales status, staff tasks and daily close.
- **Kitchen/production:** ordered plan, recipe version, quantities, available stock, batch completion and waste.
- **FOH:** availability, low stock, incoming/outgoing transfers, quick waste and close tasks.
- **Purchasing:** reorder suggestions, low/expiring stock, supplier price changes, open orders and receipts.
- **Finance:** missing costs, sales/settlement reconciliation, allocations, period status and exports.
- **Kitchen/FOH (HMS):** today's monitoring readings due, checklist runs assigned, open incident tasks.

## 8.3 Required MVP screens

| Screen | Essential content/actions |
| --- | --- |
| Management home | KPI cards with scope/freshness, trends, exceptions, approvals, location comparison |
| Item/supplier item | base unit, supplier packs, conversions, price history, stock and affected recipes |
| Recipe editor | version/state, nested lines, conversions, yield, portion, labor, packaging, allergens, cost preview |
| Product cost card | variable components, direct labor views, overhead pools, historical comparison, source drill-down |
| Price scenario | current/proposed price, tax/fees, margins, volume effect, sensitivity and approval |
| Receiving | mobile-friendly supplier/pack/quantity/price/lot/expiry, variance warnings and evidence |
| Inventory | balance by location/storage/lot, movement drill-down, valuation, low/expiry status |
| Count | scope, blind count, fast numeric entry, recounts, variance review and approval |
| Transfer | request, dispatch and receive with discrepancy handling |
| Production board | suggestions, planned/released/in-progress batches, stock availability and yield alerts |
| Batch entry | recipe version, planned/actual inputs/output, waste, lot, expiry and completion |
| Waste entry | fast item/batch search, quantity, stage, reason, photo/note and calculated value |
| Sales import | upload/history, mappings, errors, totals, preview and post |
| Reconciliation | source/posted/settlement totals, tolerance, differences and resolution |
| Daily/month close | checklist, exceptions, snapshots, approval and lock |
| Menu engineering | contribution/popularity matrix with labor/waste annotations and drill-down |
| Planning | forecast/actual, production/reorder suggestions, overrides and accuracy |
| Competitors | dated observations, sources, price/offer history and seasonal comparison |
| Administration | users/scopes, tax/rules, units, imports, integrations, audit and data quality |
| Employee detail | profile, shifts/hours (role-aware) and personnel documents (contracts/certificates; visible only to owner/GM/admin, audited upload/replace) |
| Document library | published all-staff documents by category, current version, publish/version actions for managers, read history and optional acknowledgement |
| HMS monitoring log | monitoring points with target ranges, fast reading entry, in/out-of-range status, reading history and overdue alerts |
| HMS incidents | incident list by status/location, owner, due date, severity and linked evidence |
| Corrective actions | actions by incident/owner/due date, completion and audited closure |
| HMS checklist run | template selection (IK-mat self-check, cleaning/hygiene category), question flow, non-conformities and run history |
| Equipment | equipment list, maintenance log history and log entry with evidence |
| HMS compliance export | scope/period selection, evidence bundle (readings, incidents, corrective actions, checklist runs, maintenance) for Mattilsynet/IK-mat and Arbeidstilsynet |

## 8.4 Dashboard rules

- Every figure shows period, location/channel scope, tax basis where relevant, comparison and freshness.
- Summaries drill to records and the calculation behind them.
- Charts answer a named management question.
- Location comparison shows totals and normalized efficiency measures.
- Warnings state threshold, evidence, owner and next action.
- Forecasts show history, prediction range, override and prior accuracy.
- Empty states explain what source data or setup is missing.

## 8.5 Forms and tables

- Draft autosave is allowed; submit/post/approve is explicit.
- Prevent unit ambiguity by pairing every numeric quantity with a unit.
- Monetary inputs show currency and tax basis.
- Effective-date conflicts are visible before submit.
- Tables support saved filters, column selection and export only within authorized scope.
- Bulk actions preview impact and require confirmation.
- Errors preserve user input and focus the first invalid field.

## 8.6 Mobile operational behavior

Receiving, count, transfer, batch and waste workflows must work on a phone/tablet. Use large targets, numeric keyboards, recent/default location/storage, rapid repeat entry and offline-tolerant drafts where feasible. Do not promise offline posting in MVP; posting requires confirmation from the server.

## 8.7 Visual direction

The interface should be recognizably Aquarela without turning operational screens into posters:

- cream background and generous whitespace;
- dark navy navigation and high-contrast text;
- berry for commercial/important data;
- green for healthy operational state;
- muted gold for review/attention;
- expressive serif for page titles, readable sans-serif for controls/tables;
- watercolor accents limited to sign-in, empty states and occasional section cues;
- product photography in recipe/product records, not dense operational tables.

Define tokens for color, spacing, typography, radius, elevation and data visualization. Status colors must remain accessible and consistent.

## 8.8 Prototype gate

Before build commitment, test clickable prototypes for management home, product cost card, receiving, production batch, count, waste entry, sales import and daily close with the actual users who perform each workflow. Record task completion time, mistakes, unclear terminology and required defaults.

## 8.9 Layout and interaction references

Structural references for screen composition and interaction density. They are subordinate to
the Aquarela visual direction in §8.7 (cream/navy/berry/green/gold palette, serif titles,
limited watercolor accents) and to the dashboard, form/table, mobile and accessibility rules
above (and file 07): take layout, information hierarchy, density, navigation patterns and
analytics composition from them, and do not copy their branding, copy, illustrations or
assets. Where a reference conflicts with §8.7 or an accessibility rule, this document wins.

| Reference | What to take from it |
| --- | --- |
| [Modern CRM & Analytics Platform — SaaS UX/UI Design](https://www.behance.net/gallery/236915009/Modern-CRM-Analytics-Platform-SaaS-UX-UI-Design) (Gulshan Ali / Ibdai Studio, published 2025-10-20) | Dense but calm admin/dashboard composition: KPI header, scope/filter bar, card-and-table balance, drill-down analytics, sidebar plus top-bar navigation and restrained status colour. Applied to Management home (§8.3), Insights and Administration — always wrapped in the Aquarela palette rather than the reference's own. |

