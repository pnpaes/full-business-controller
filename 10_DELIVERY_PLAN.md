# 10. Delivery Plan and Backlog

## 10.1 Team assumptions

Indicative durations assume a small focused team with product/operations availability: product owner, technical lead/full-stack engineering, UX support, QA/data work and part-time finance/operations subject-matter owners. Estimate only after Phase 0 source profiling.

## 10.2 Phases

| Phase | Indicative duration | Scope | Exit result |
| --- | --- | --- | --- |
| 0 Discovery & foundation | 2–3 weeks | workflows, source files, decisions, terminology, prototype, architecture validation | signed scope, resolved MVP decisions, data plan, estimates |
| 1 Cost & product foundation | 4–6 weeks | org, users, suppliers/items, purchases, costs, recipes, products, cost cards, pricing | reliable approved costing/pricing workspace |
| 2 Inventory & production | 4–6 weeks | ledger, receipts, counts, transfers, batches, yield, waste, reorder | daily stock/production control |
| 3 Sales, reporting & workforce | 4–6 weeks | imports, mappings, fees, reconciliation, dashboards, menu engineering, close, workforce scheduling, worked hours, monthly payroll-input report, per-source approved publishing (write connectors) | end-to-end purchase-to-sale view with planned/captured staff hours, a monthly payroll-input report and approved per-source publishing |
| 4 Planning & intelligence | 3–5 weeks | forecasts, budgets, production suggestions, seasonal/competitor workflow, experiments, AI-assisted advisory analysis and suggestions | planning decision support with advisory AI analysis (human-approved) |
| 5 Optimization & integrations | Continuous | APIs, extraction, scanning, automation, performance, advanced forecasts | reduced manual work and measured accuracy |
| 6 HMS, food safety & workforce documents | 4–6 weeks | employee personnel documents (contracts, owner/GM/admin only), staff document library (publish/version/acknowledge), HMS monitoring points/readings, incidents, corrective actions, checklists (IK-mat self-checks, cleaning/hygiene), equipment/maintenance, compliance evidence export (Mattilsynet/IK-mat, Arbeidstilsynet) — prerequisite: task/approval/job workflow platform (ADR-0004) | compliant food-safety/personnel documentation with evidence trail for regulators |

> Note: Phase 0 is dependency-driven, not calendar-driven. Its duration is revised to an indicative
> **4–6 weeks** per `docs/phase0/PHASE0_CLOSEOUT_PLAN.md`, because it is gated on external inputs
> (sample files and accountant rulings), not engineering capacity.

Phases 0–3 are the recommended first operational MVP. A Phase 1 release may be used internally for approved costing while later phases continue. Phase 6 (HMS, food safety and workforce documents) is approved but follows the MVP; its workflow-platform prerequisite (Epic 20) is sequenced immediately before it.

> Note: the Phase 3 estimate must be revisited because the MVP scope grew by owner decision (DEC-037)
> to include workforce scheduling, worked hours and the monthly payroll-input report. This affects
> P0-008 (the Phase 1–3 estimate).

> Note: the Phase 4 estimate must also be revisited because DEC-039 adds AI-assisted advisory
> analysis and suggestions (scheduled LLM jobs, provider abstraction, review queue) to the Phase 4
> scope.

> Note: the Phase 3 estimate must be revisited because DEC-015 adds per-source approved external
> publishing (write connectors) to the Phase 3 scope. Publishing is gated per source on API
> availability, terms and a named credentials owner, and each connector (publish jobs, confirmation
> read-back, rollback, audit) is separately estimated. This affects P0-008 (the Phase 1–3 estimate).

> Note: the owner approved (2026-09-21, DEC-086…DEC-094) a programme adding an HMS & food-safety
> (IK-mat) module, employee personnel documents and a staff document library as a new Phase 6 /
> Epic 21, gated on the task/approval/job workflow platform (ADR-0004, DEC-094). Its estimate is
> indicative and not yet profiled against sources.

## 10.3 Phase 0 deliverables

- current-state workflow maps for purchase-to-production and sale-to-close;
- source-system/integration inventory and representative files;
- approved data dictionary, controlled values and ownership;
- resolved blocking decisions from `12_OPEN_DECISIONS.md`;
- six reconciled golden product fixtures;
- clickable prototype and usability findings;
- threat/privacy review and access matrix;
- architecture ADRs, migration approach and operational estimate;
- prioritized requirement set and acceptance plan.

## 10.4 Epic sequence and dependencies

1. Identity, organization, locations, scopes and audit.
2. Units, catalog, suppliers and supplier packs.
3. Receipts, price history and landed cost.
4. Recipes/sub-recipes, versions, yield and allergens.
5. Operating costs, labor, cost pools and rules.
6. Cost cards, snapshots, price scenarios and approvals.
7. Stock ledger, balances, lots and storage.
8. Counts, transfers and waste.
9. Production planning and batches.
10. Import framework and external mappings.
11. Sales, settlements and reconciliation.
12. Daily/month close, dashboards and menu engineering.
13. Employee records.
14. Shift planning, rota and staff self-assignment.
15. Worked hours and the monthly payroll-input report.
16. Forecast/budget/seasonal/competitor planning.
17. Publishing integrations (allowed-operations registry and credentials owners, publish jobs from approved internal changes, confirmation read-back, rollback and failure alerts, audit).
18. AI-assisted advisory analysis (scheduled analysis jobs, provider abstraction, human review queue, run provenance and cost records).
19. Automated connectors and optimization.
20. Workflow platform prerequisite: task/approval/job platform tables with ADR-0004 acceptance (DEC-094).
21. HMS & food-safety (IK-mat) + workforce documents: monitoring points/readings, incidents, corrective actions, checklists (IK-mat self-checks, cleaning/hygiene), equipment/maintenance, compliance evidence export (Mattilsynet/IK-mat, Arbeidstilsynet), employee personnel documents (owner/GM/admin only) and the staff document library (publish/version/acknowledge) — approved 2026-09-21 (DEC-086…DEC-094).

Do not implement dashboards before canonical posting/reconciliation behavior exists. Do not implement advanced forecasts before history, grain and quality are measured. Do not implement AI-assisted analysis before the provider privacy/DPA review is complete and history/grain quality is measured.

## 10.5 Delivery slices

Each slice should include schema/migration, domain behavior, authorization, audit, API, minimum UI, tests, telemetry and documentation. Prefer a complete thin operating flow over horizontal technical layers left unusable.

Suggested first slices:

- create item + supplier pack + conversion + price;
- receive item + stock movement + balance drill-down;
- recipe draft + approve + reproducible cost preview;
- cost card + price scenario + approval;
- mobile waste event + inventory/value impact;
- production batch + input/output/yield;
- sales CSV + mapping + idempotent posting + totals;
- daily close + exception review;
- location/product contribution report with drill-down.

## 10.6 Definition of ready

A story is ready when it has requirement IDs, user/outcome, scope, acceptance examples, states/error paths, authorization, audit expectation, data fields, dependencies, design/prototype and required fixture/source file. Unknown business rules are linked to a decision, not hidden in implementation notes.

## 10.7 Definition of done

- acceptance tests pass and requirement traceability is updated;
- domain invariants and authorization are tested;
- migration is reversible or has an approved recovery plan;
- telemetry and actionable errors exist;
- audit/provenance is correct;
- responsive/accessibility review passes for affected screens;
- documentation/API contract is updated;
- staging validation uses representative data;
- product/data owner accepts the slice;
- no unresolved critical/high defect.

## 10.8 Pilot and rollout

1. Seed master data and six representative products.
2. Run costing alongside current spreadsheets for a complete review cycle.
3. Pilot receiving, production, waste and counts at one location with daily feedback.
4. Stabilize units and workflows; add second location and compare results.
5. Import sales and complete parallel daily/monthly reconciliation.
6. Make the system the primary operational report only after acceptance gates pass.
7. Freeze old process for reference; schedule improvements from measured friction/errors.

## 10.9 Migration datasets

- locations/storage/channels;
- users and scopes;
- products/variants/external IDs/prices/tax configuration;
- items, supplier packs, units and opening stock;
- recipes/sub-recipes/yields/labor/packaging/allergens;
- supplier and purchase-price history;
- recurring/fixed/variable costs and allocation policy;
- sales history, preferably at least 12 months when reliable;
- historical production/waste/counts only if definitions and units are trustworthy;
- employees, roles and hourly rates;
- existing shift/rota data, if any;
- role/cost-center labor assumptions.

No data migration is needed for external writes. Publishing requires configuration records instead:
per-source allowed-operations approvals and a named credentials owner for each write operation. These
are seeded/configured (not migrated) before the first write connector is enabled (DEC-015).

Every migration records source, mapping version, validation totals and rejected rows. Historical uncertainty is labeled rather than normalized into false precision.

## 10.10 Project controls

- Weekly demo against working acceptance scenarios.
- Decision log reviewed twice weekly during discovery and when blocked.
- Risk/data-quality review at each phase gate.
- Budget tracked by completed operating slices, not only technical activity.
- Scope changes identify affected requirements, data model, integrations, tests and phase estimate.

