# Aquarela Business Control System — Technical Scope

**Document version:** 1.0  
**Status:** Phase 0 input — build-ready for discovery; implementation not started. Phase 0 close-out is tracked in `docs/phase0/PHASE0_CLOSEOUT_PLAN.md`.  
**Business:** Aquarela Kafé, Oslo  
**Locations in initial scope:** Kongens gate and Tullinløkka  
**Primary currency:** NOK  
**Primary timezone:** Europe/Oslo

## Purpose

This package translates the approved product concept into a technical handoff that a software team or coding agent can use to plan, estimate, implement, test and release the system. It defines expected behavior and boundaries. It does not contain production code and does not silently decide accounting, tax or integration questions that require confirmation.

The system is an internal operating and management platform connecting:

- suppliers, purchases and landed ingredient costs;
- recipes, sub-recipes, yield, portions and packaging;
- product cost cards, price scenarios and contribution;
- operating costs, labor, assets and overhead allocation;
- stock, receipts, transfers, counts, production and waste;
- sales, channels, fees, settlements and reconciliation;
- reporting, menu engineering, forecasts and seasonal planning.

## Implementation recommendation

Start as a responsive TypeScript modular monolith with PostgreSQL. Keep domain modules separate inside one repository (modular monolith) deployed as separate application runtimes (`web`, `api`, `worker`, `scheduler`) and one transactional database. Use an append-only stock ledger, effective-dated master data, reproducible calculation snapshots, explicit approval states, idempotent imports and immutable audit entries.

The first operational release is Phases 0–3: foundation, costing/pricing, inventory/production, and sales/reporting. Planning intelligence and advanced automation follow only after data quality is proven.

## Document map

| File | Use |
| --- | --- |
| `01_PRODUCT_SCOPE.md` | Goals, users, boundaries and module scope |
| `02_ARCHITECTURE.md` | System architecture, module boundaries and deployment |
| `03_DOMAIN_MODEL.md` | Entities, relationships, invariants and lifecycle |
| `04_CALCULATIONS.md` | Cost, pricing, stock and management calculation rules |
| `05_WORKFLOWS.md` | Operational workflows, states, approvals and exception paths |
| `06_API_INTEGRATIONS.md` | API conventions, endpoint surface, imports and external systems |
| `07_SECURITY_AND_NFR.md` | RBAC, privacy, audit, reliability and performance requirements |
| `08_UI_UX.md` | Information architecture, screens, responsive behavior and brand direction |
| `09_TESTING_AND_ACCEPTANCE.md` | Test strategy, fixtures, release gates and acceptance scenarios |
| `10_DELIVERY_PLAN.md` | Phases, dependencies, workstreams and definition of done |
| `11_REQUIREMENTS_CATALOG.md` | Numbered, testable requirements for traceability |
| `12_OPEN_DECISIONS.md` | Decisions that must be confirmed rather than assumed |
| `13_AGENT_BUILD_BRIEF.md` | Direct instructions for a future coding agent |
| `schemas/openapi-outline.yaml` | Non-executable outline of API groups and conventions |
| `schemas/domain-enums.yaml` | Proposed controlled values requiring confirmation during Phase 0 |
| `schemas/phase1_2_draft.sql` | Draft Phase 1–2 DDL (ledger, effective-dating, money/quantity invariants) |
| `docs/phase0/PHASE0_CLOSEOUT_PLAN.md` | The five Phase 0 close-out artifacts, owners, info-needed checklist and gate |
| `docs/phase0/CALCULATION_CONTRACT.md` | Pinned Phase 1 calculation rules (tax, cost selection, rounding, fees) |
| `docs/phase0/DATA_DICTIONARY.md` | Field-level data dictionary for Phase 1–2 entities |
| `docs/phase0/GOLDEN_FIXTURES.md` | Six-product fixture schema, worked examples and sign-off |
| `docs/adr/` | Required architecture decision records 0001–0008 |
| `references/Aquarela_Business_Control_System_Specification.docx` | Original business/product specification for human context |

## Authority and change control

1. Confirmed decisions in `12_OPEN_DECISIONS.md` override recommendations elsewhere.
2. Approved business calculation rules override interface convenience.
3. Requirement IDs in `11_REQUIREMENTS_CATALOG.md` must be referenced by stories, pull requests and acceptance tests.
4. If an implementation requires behavior not specified here, record an ADR or decision request before coding it.
5. Historical approved values must never be rewritten merely because current prices, recipes or rules changed.

## Definition of build-ready

Phase 0 is complete when the open decisions affecting the MVP are resolved, representative source files have been profiled, integration feasibility is verified, controlled vocabularies are approved, six representative products reconcile manually, and the product owner signs the prioritized acceptance criteria.
