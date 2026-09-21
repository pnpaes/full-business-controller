# 11. Requirements Catalog

Priority: **Must** = required for first operational MVP; **Should** = valuable in MVP if capacity allows; **Later** = planned after data/workflows stabilize.

## Phase 0 deliverables

| ID | Priority | Requirement |
| --- | --- | --- |
| P0-001 | Must | Produce current-state workflow maps for purchase-to-production and sale-to-close. |
| P0-002 | Must | Produce a source-system/integration inventory with representative files and feasibility notes. |
| P0-003 | Must | Produce an approved data dictionary, controlled vocabularies and data ownership. |
| P0-004 | Must | Resolve the blocking open decisions with named owners and phases. |
| P0-005 | Must | Produce six reconciled, signed golden product fixtures. |
| P0-006 | Must | Produce a clickable prototype and usability findings. |
| P0-007 | Must | Produce a threat/privacy review, access matrix and the required ADRs. |
| P0-008 | Must | Produce a migration approach and a validated Phase 1–3 estimate. |

## Foundation

| ID | Priority | Requirement |
| --- | --- | --- |
| FND-001 | Must | Represent one organization with multiple locations, storage areas and sales channels. |
| FND-002 | Must | Enforce role and location scope on every query, mutation and export. |
| FND-003 | Must | Store quantities with explicit units and validate conversions/dimensions. |
| FND-004 | Must | Support effective-dated versions without overlap in the same scope. |
| FND-005 | Must | Audit sensitive and posting/approval actions with actor, time, reason and entity version. |
| FND-006 | Must | Display scope, period and freshness for calculated/reporting data. |
| FND-007 | Must | Support assignable ownership roles (product, technical, operational data) and per-data-area business owners, grantable to and revocable from users with audit. |
| FND-008 | Must | Maintain a stable SKU per item/product variant as the business-controller-owned key; publish it to external systems and use it as the primary reconciliation key for imports. |
| FND-009 | Must | Classify every sellable SKU as base, variant or add-on/modifier, record which add-ons apply to which base products, and publish the taxonomy with the SKU catalogue. |

## Procurement and catalog

| ID | Priority | Requirement |
| --- | --- | --- |
| PROC-001 | Must | Maintain items, suppliers, supplier SKUs, pack sizes and pack-to-base-unit conversion. |
| PROC-002 | Must | Record receipts with accepted/rejected quantity, price, tax basis, lot, expiry and evidence. |
| PROC-003 | Must | Calculate landed base-unit cost and retain component provenance. |
| PROC-004 | Must | Maintain effective supplier-price history and preferred supplier. |
| PROC-005 | Must | Alert on configurable supplier price variance and list affected products. |
| PROC-006 | Should | Support purchase orders and receipt matching. |
| PROC-007 | Must | Record foreign-currency amounts with a resolved exchange rate and rate date; reject mixed-currency calculations without one. |
| PROC-008 | Must | Record ad-hoc purchases from unspecified stores as receipts/price observations (date, store, item, pack, price) and import existing price Excel files where no supplier price list exists. |

## Recipes, costs and pricing

| ID | Priority | Requirement |
| --- | --- | --- |
| COST-001 | Must | Version recipes/sub-recipes with lines, units, yield, portion, labor, packaging and allergens. |
| COST-002 | Must | Prohibit sub-recipe cycles and draft dependencies in approved recipes. |
| COST-003 | Must | Maintain fixed, variable and mixed operating costs by period/location/cost center. |
| COST-004 | Must | Maintain effective role/cost-center loaded labor rates without requiring named employee records. |
| COST-005 | Must | Produce a cost card separating ingredients, packaging, direct labor, channel costs and overhead. |
| COST-006 | Must | Show contribution before and after standard direct labor when configured. |
| COST-007 | Must | Allocate approved cost pools with visible drivers and denominators. |
| COST-008 | Must | Snapshot approved calculations so historical results remain reproducible. |
| COST-009 | Must | Apply a defined rounding method and boundaries; store the method and scales in every calculation snapshot. |
| COST-010 | Must | Select the base-unit cost for recipes/cost cards by an approved cost-selection policy and snapshot the selection; resolve by source precedence — approved supplier price, else latest recorded cost observation (receipt/Excel), else manually maintained current cost. |
| COST-011 | Must | Define an explicit allocation driver and denominator source for every allocation rule; stop or fall back when the denominator is missing/zero. |
| COST-012 | Must | Resolve selected base-unit cost by source precedence — approved supplier price, else latest recorded cost observation, else manually maintained current cost — and snapshot the source and date. |
| COST-013 | Must | Cost working-owner production time at the applicable role rate (imputed) and present both an economic labour-cost view (imputed owner included) and a cash view (excluded). |
| PRICE-001 | Must | Model gross/net price, tax, channel fees, contribution, full cost and expected volume effect. |
| PRICE-002 | Must | Approve price versions by product/location/channel/effective date. |
| PRICE-003 | Must | Prevent unapproved scenarios from becoming effective prices. |
| PRICE-004 | Must | Solve for a configured target contribution and show sensitivity. |
| PRICE-005 | Must | Model effective-dated tax rules by product/service type and channel, including tax basis and input-tax recoverability. |
| PRICE-006 | Must | Resolve the effective tax rate per sales line: fixed item rate where defined (e.g. 0% books, 15% retail packs), otherwise item default with a channel override (eat-in 25% / takeaway 15%), effective-dated. |

## Inventory, production and waste

| ID | Priority | Requirement |
| --- | --- | --- |
| INV-001 | Must | Record all inventory changes as append-only movements with source and value. |
| INV-002 | Must | Derive balances by item/location/storage/lot and support as-of queries. |
| INV-003 | Must | Use approved operational valuation and preserve outbound posting value. |
| INV-004 | Must | Support blind/sighted counts, recount thresholds and approved variance posting. |
| INV-005 | Must | Support two-sided transfers with dispatched/received discrepancy. |
| INV-006 | Must | Track lot/expiry and alert on expiry/low-stock policy. |
| INV-007 | Must | Prevent or explicitly approve/flag negative inventory. |
| INV-008 | Must | Reverse posted movements at their original value and post an explicit revaluation correction for any moving-average gap. |
| INV-009 | Must | Model in-transit stock and eliminate cross-location transfer pairs in consolidation without double counting. |
| PROD-001 | Must | Plan and complete batches against an approved recipe version. |
| PROD-002 | Must | Atomically post actual inputs, outputs, waste and yield. |
| PROD-003 | Must | Compare planned/actual yield and create exceptions outside tolerance. |
| PROD-004 | Must | Store planned vs actual quantity per production batch input and output line with variance and reason. |
| PROD-005 | Must | Support fixed-size portioned intermediate outputs and consumption of whole or partial portions; track intermediates in base units with a standard portion size, and record only actually-discarded remainder as waste. |
| WASTE-001 | Must | Record waste by item/product/batch, quantity, stage, reason, location and value. |
| WASTE-002 | Must | Prevent double-counting recipe yield loss and operational waste. |
| PLAN-001 | Must | Suggest reorder/production from stock, commitments, forecast, lead time and safety stock. |

## Sales and reconciliation

| ID | Priority | Requirement |
| --- | --- | --- |
| SALE-001 | Must | Import sales into staging with source/file/row provenance. |
| SALE-002 | Must | Map external locations/channels/products/taxes to internal records. |
| SALE-003 | Must | Prevent duplicate transactions/lines on file or record replay. |
| SALE-004 | Must | Preserve invalid/unmapped rows in a recoverable review queue. |
| SALE-005 | Must | Post discounts, refunds, gross/net/tax and channel attribution. |
| SALE-006 | Must | Correct posted sales through explicit linked reversal/adjustment. |
| SALE-007 | Must | Apply a configured import partial-posting policy; retain unmapped/invalid rows in the review queue; require an approved disposition for every non-posted row before the import reconciles. |
| SALE-008 | Must | Import item-level sales detail (product/variant, quantity, net/tax/gross, channel, payment type) from source exports or APIs; aggregate reports alone are insufficient for theoretical consumption. |
| SALE-009 | Must | Capture channel and the applied tax rate per sales line; the POS differentiates dine-in and takeaway tax on the same product without separate products. |
| SALE-010 | Must | Import option/add-on sales whether recorded as standalone lines or attached to a parent product, and normalize them consistently. |
| SALE-011 | Must | Retain zero-price included option lines from sales imports for consumption and costing, while excluding them from revenue and margin reporting. |
| REC-001 | Must | Reconcile source totals to posted totals within configured tolerance. |
| REC-002 | Must | Reconcile payment/channel settlements when source data is available. |
| REC-003 | Must | Support daily and monthly close with prerequisites, exceptions, approval and lock. |
| REC-004 | Must | Prevent unauthorized changes affecting a locked period. |
| REC-005 | Must | Reconcile source totals to posted totals using effective-dated tolerances with a named owner; reconcile a partial post net of approved dispositions, not the raw posted total. |
| REC-006 | Must | Lock periods at location/day and company/month granularity; post corrections through a linked reversal in an open adjustment period or an audited reopen; keep locked snapshots immutable. |

## Integrations and publishing

| ID | Priority | Requirement |
| --- | --- | --- |
| INTG-001 | Must | Maintain a per-integration registry of allowed operations, credentials owner, rate limits and terms; no write is permitted until explicitly approved per operation. |
| INTG-002 | Must | Publish approved internal changes to approved external systems as idempotent jobs with confirmation read-back, audit, rollback and failure alerts. |
| INTG-003 | Should | Publish first to POS and Medusa/Sanity, and to Wolt and Fiken only when their APIs and terms permit. |

## Reporting and planning

| ID | Priority | Requirement |
| --- | --- | --- |
| RPT-001 | Must | Report sales, variable cost, contribution and full cost by location/channel/category/product/period. |
| RPT-002 | Must | Drill every summary to records and calculation snapshots. |
| RPT-003 | Must | Compare locations using totals and normalized measures. |
| RPT-004 | Must | Report stock value/variance, production yield and waste value/reasons. |
| RPT-005 | Must | Provide menu engineering using popularity/contribution with labor/waste context. |
| FCST-001 | Should | Generate transparent baseline forecasts with manager override/reason. |
| FCST-002 | Should | Store and report forecast accuracy against actuals. |
| FCST-003 | Must | Automatically promote forecast grain from location/category to product level once a clean-history threshold is met, and always display the active grain. |
| FCST-004 | Should | Run scheduled AI-assisted advisory analysis and suggestions (forecast commentary, menu engineering, seasonal/upcoming-period suggestions) that require human approval, store provider, model, prompt version, inputs, output and cost, and never send personal data. |
| COMP-001 | Must | Record reviewed competitor offers/prices with source and observation date. |
| COMP-002 | Must | Combine internal trends, competitor observations and calendar in seasonal planning. |
| COMP-003 | Must | Automate collection for approved, permitted sources with per-source terms/legal approval, robots/rate-limit respect, and no personal data; store provenance. |
| COMP-004 | Must | Support multiple sources per competitor, including fast manual capture (URL/screenshot) for restricted sources such as Instagram, and require human review before observations influence any decision. |
| PLAN-002 | Should | Provide budget scenarios and variance analysis that never overwrite actuals. |
| PLAN-003 | Must | Capture per-item consumption, lead-time and reorder-outcome history from day one, and progressively provide advisory reorder suggestions from history, trend and seasonality that show their basis and confidence. |

## Workforce

| ID | Priority | Requirement |
| --- | --- | --- |
| WF-001 | Must | Maintain employee records (name, role, employment type, hourly rate, location, cost centre, active dates) with restricted, audited access; an employee may exist without a login account. |
| WF-002 | Must | Plan and publish shifts by location, date, role and time window. |
| WF-003 | Must | Let employees view open shifts and self-assign within their role/location, subject to manager approval and limits. |
| WF-004 | Must | Derive worked hours from registered shifts with manager manual correction; no clock-in required in the MVP. |
| WF-005 | Must | Produce a reproducible monthly payroll-input report for the accountant (employee, hours, hourly rate, expected pay, period) around 3 days before month-end, using registered shifts plus an assumption for remaining planned shifts. |
| WF-006 | Must | Enforce access control, audit and retention for employee personal data. |
| WF-007 | Must | Maintain employee personnel documents (contracts, certificates) as `file_object`-backed attachments on the employee record, visible only to owner, general_manager and admin, with audited upload/replace and retention (DEC-087). |

## HMS and food safety

| ID | Priority | Requirement |
| --- | --- | --- |
| HMS-001 | Must | Maintain a per-location HMS and food-safety (IK-mat) programme covering monitoring points/readings, incidents, corrective actions, checklists, equipment/maintenance and a compliance evidence export, built on the spec'd `task`/`approval` workflow platform tables (built now as the workflow host, no ADR dependency), with the `job`/worker/outbox async layer gated on `ADR-0004` acceptance (DEC-094). |
| HMS-002 | Must | Define monitoring points (fridge, freezer and similar) with target range and reading frequency, and record readings with timestamp, value, operator and automatic in/out-of-range status. |
| HMS-003 | Must | Record HMS incidents with owner, severity, due date, closure state and evidence via private file attachments. |
| HMS-004 | Must | Record corrective actions linked to incidents with owner, due date, completion and audited closure. |
| HMS-005 | Must | Version checklist templates (IK-mat self-checks, with cleaning/hygiene as a category) and record checklist runs with answers, non-conformities, actor and time. |
| HMS-006 | Must | Maintain equipment with maintenance logs (date, type, performed by, notes and evidence). |
| HMS-007 | Must | Produce a compliance/evidence export for regulators (Mattilsynet/IK-mat, Arbeidstilsynet) within authorized scope, covering readings, incidents, corrective actions, checklist runs and maintenance. |

## Staff document library

| ID | Priority | Requirement |
| --- | --- | --- |
| DOC-001 | Must | Maintain a staff document library of published documents with an all-staff audience, readable by all active staff at authorized locations. |
| DOC-002 | Must | Let managers publish and version documents; only the currently published version is visible to staff, and superseded versions remain retrievable to managers. |
| DOC-003 | Must | Support optional per-employee/version acknowledgement recording who acknowledged and when. |
| DOC-004 | Must | Enforce read access to published documents for all staff and publish/version rights for managers, with audit of publish and acknowledgement actions. |

## Operations, reliability and governance

| ID | Priority | Requirement |
| --- | --- | --- |
| OPS-001 | Must | Run imports/calculations asynchronously when long-running and expose progress/failure/retry. |
| OPS-002 | Must | Ensure retryable jobs and posting commands are idempotent. |
| OPS-003 | Must | Back up database/files and demonstrate restoration before launch. |
| OPS-004 | Must | Monitor errors, queue age, import freshness, reconciliation and backup state. |
| OPS-005 | Must | Export authorized company data in documented formats. |
| DQ-001 | Must | Detect missing/stale/duplicate/inconsistent records and assign exceptions. |
| SEC-001 | Must | Use secure authentication, least privilege and MFA for sensitive roles where available. |
| SEC-002 | Must | Encrypt traffic/stored data and keep attachments private. |
| SEC-003 | Must | Minimize payroll/personal data and restrict sensitive exports/logs. |
| UX-001 | Must | Support receiving, count, batch, transfer and waste on phone/tablet. |
| UX-002 | Must | Meet agreed WCAG 2.2 AA accessibility checks. |

## Guidance and onboarding

| ID | Priority | Requirement |
| --- | --- | --- |
| UX-003 | Must | Provide in-product guidance so non-technical staff can set up, operate and understand the system: onboarding tutorial, searchable FAQ and contextual help on setup fields, calculations and workflows. |

## Non-functional

| ID | Priority | Requirement |
| --- | --- | --- |
| NFR-001 | Must | Meet operational availability of 99.5% monthly, RPO of 1 hour or better, and RTO of 4 hours during support hours, with tested backup restoration before launch and quarterly. |
| NFR-002 | Must | Meet p95 performance targets: interactive reads under 500 ms server time; transactional commands under 1 s excluding file/external work; primary mobile pages within 2.5 s; search under 300 ms; dashboard freshness within 15 minutes of posting; stock posting visible within 10 s. |

## Phase map

This map makes the release gate in `09_TESTING_AND_ACCEPTANCE.md:75` ("all Must requirements for that phase") mechanically checkable.

| Phase | Requirements | Notes |
| --- | --- | --- |
| Phase 0 | P0-001…P0-008 | Also the ADR/DEC gates. |
| Phase 1 | FND-001…FND-005, FND-007…FND-009, PROC-001…PROC-008, COST-001…COST-013, PRICE-001…PRICE-005 | FND-006 is cross-cutting (see below); FND-007 (assignable ownership grants) is required before pilot (DEC-014); FND-008 (SKU ownership and reconciliation key) is required by DEC-041; FND-009 (SKU taxonomy: base/variant/add-on and which add-ons apply to which base) is required by DEC-044/DEC-046. PROC-008 and COST-012 (ad-hoc cost sources and source precedence) are required by DEC-047. COST-013 (imputed working-owner production labour, economic vs cash views) is required by DEC-048. |
| Phase 2 | INV-001…INV-009, PROD-001…PROD-005, WASTE-001…WASTE-002, PLAN-001 | PLAN-001 requires DEC-019 (service levels and safety stock). |
| Phase 3 | SALE-001…SALE-011, PRICE-006, REC-001…REC-006, RPT-001…RPT-005, WF-001…WF-006, OPS-001…OPS-003, OPS-005, DQ-001, INTG-001…INTG-003 | DEC-037 expanded the MVP to add workforce scheduling and the payroll-input report. INTG-001…INTG-003 are governed by DEC-015 and ADR-0011 (external publishing). SALE-009 (channel/applied tax per line) and SALE-010 (option/add-on normalization) are required by DEC-042/DEC-043. SALE-011 (zero-price included option lines retained for consumption but excluded from revenue/margin) is required by DEC-043. PRICE-006 (per-line effective tax resolution — fixed item rate or channel-overridden default) is required by DEC-045 and complements SALE-009. |
| Phase 4 | FCST-001…FCST-004, COMP-001…COMP-004, PLAN-002, PLAN-003 | FCST-004 (scheduled AI-assisted advisories) is governed by DEC-039 and ADR-0009; PLAN-003 (advisory reorder suggestions) requires DEC-019; its history capture begins in Phase 2 but the suggestion layer arrives here. Competitor intelligence (COMP-001…COMP-004) is required by DEC-020 and feeds the AI-assisted analysis (DEC-039). |
| Phase 5 | — | No remaining requirements; DEC-020 promoted competitor automation (COMP-003/COMP-004) into Phase 4. Reserved; Phase 6 (HMS/workforce documents, below) was added by owner approval on 2026-09-21. |
| Cross-cutting (all phases) | OPS-004, NFR-001, NFR-002, SEC-001…SEC-003, UX-001…UX-003, FND-006 | UX-003 arose from DEC-007 (users need help configuring pools/drivers and interpreting figures). |
| Phase 6 | WF-007, DOC-001…DOC-004, HMS-001…HMS-007 | Owner-approved HMS & food-safety (IK-mat) + workforce-documents programme (2026-09-21, DEC-086). WF-007 (employee personnel documents with owner/GM/admin-only visibility) is required by DEC-087. DOC-001…DOC-004 (staff document library) are required by DEC-088. HMS-002…HMS-006 are required by DEC-089…DEC-092, HMS-007 by DEC-093, and HMS-001 requires the spec'd `task`/`approval` workflow platform tables (built now as the workflow host), with the `job`/worker/outbox async layer gated on `ADR-0004` acceptance as a prerequisite (DEC-094). |

Every Must requirement is assigned to exactly one phase (or cross-cutting), and any new requirement ID must be added to this map when created (`00_README.md:61`).

**Phase map note.** The new Phase 6 corresponds to **Epics 20–21** in `10_DELIVERY_PLAN.md`: Epic 20 is the workflow-platform prerequisite (the `task`/`approval` tables built now, with `job`/worker/outbox gated on `ADR-0004`, DEC-094), sequenced immediately before the Phase 6 programme in Epic 21.

**Open point (WF-003).** Whether an employee who self-assigns a shift must hold an `app_user` login is **unresolved** — the spec allows an employee to exist without a login (`03_DOMAIN_MODEL.md:186`). Recorded as an owner input.

