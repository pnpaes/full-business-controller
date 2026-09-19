# Phase 0 Close-out Plan

Status: **Draft for owner review** — every proposed position marked `[PROPOSED]` needs sign-off.
Source of truth: this plan and the build-readiness assessment that produced it
(`~/.local/share/kilo/plans/1789317082459-build-readiness-assessment.md`). Where this plan and
the assessment differ, this plan wins; where this plan is silent, files 00–13 win.

## 1. Where we are

The package is a high-quality **PRD + architecture direction**, not an implementation spec. It is
build-ready for Phase 0 (discovery/foundation) and for a throwaway spike, but **not** for Phase 1+
business logic. The root cause is not missing effort — it is that the open decisions are deliberate
gates, and they have not been closed.

The single structural defect (now corrected): `00_README.md:4` and `MANIFEST.json:4` previously
declared "build-ready scope" while `00_README.md:65-67` defines build-ready as *after* Phase 0. The
status is corrected to **"Phase 0 input — build-ready for discovery"** as part of this close-out.

## 2. Definition of Phase 0 complete (from `00_README.md:65-67` and `10_DELIVERY_PLAN.md:20-30`)

Phase 0 is complete when:

1. open decisions affecting the MVP are resolved with named owners;
2. representative source files are profiled;
3. integration feasibility is verified;
4. controlled vocabularies are approved;
5. six representative products reconcile manually and are signed;
6. the product owner signs the prioritized acceptance criteria.

These map to five artifacts (§3). Until all five exist and are signed, **no Phase 1 business logic
is built**. Scaffolding (CI, repo layout, lint/type/test harness, structured logging) may proceed
immediately; **auth waits on ADR-0003** and **persistence waits on ADR-0002**.

## 3. The five close-out artifacts

| # | Artifact | File | Owner | Acceptance | Unblocks |
| --- | --- | --- | --- | --- | --- |
| A1 | Decision log: owners, phase, status, + missing decisions | `12_OPEN_DECISIONS.md` | Product owner (business) + Finance + Tech lead | Every DEC has owner, phase, status; all Phase-1 blockers `accepted` | Everything downstream |
| A2 | Phase 1 calculation contract | `docs/phase0/CALCULATION_CONTRACT.md` | Finance/controller + product owner | Cost selection, valuation, tax, rounding, fee basis pinned and reproducible | COST-005/006/007, PRICE-001 |
| A3 | Field-level data dictionary / DDL draft | `docs/phase0/DATA_DICTIONARY.md`, `schemas/phase1_2_draft.sql` | Tech lead + data owner | Data dictionary covers every Phase 1–2 entity; the DDL draft covers the ledger/effective-dating/money/quantity core and is completed per slice | Persistence + migrations |
| A4 | Architecture decision records 1–8 | `docs/adr/0001…0008-*.md` | Tech lead | Each ADR accepted with pinned versions | Scaffolding, auth, jobs, storage |
| A5 | Six numeric, signed golden fixtures | `docs/phase0/GOLDEN_FIXTURES.md` | Finance + product owner sign expected values | Components (not only totals) reconcile with manual results | Release gate `09:75`, Phase 1 acceptance |

Supporting change: requirement IDs and a requirement→phase map added to
`11_REQUIREMENTS_CATALOG.md` so the gate "all Must requirements for that phase" is mechanically
checkable; controlled vocabularies completed in `schemas/domain-enums.yaml`.

Artifact traceability (P0-001…P0-008 in `11_REQUIREMENTS_CATALOG.md`): A1↔P0-004, A3↔P0-003,
A4↔P0-007, A5↔P0-005; P0-001 (workflow maps), P0-002 (source inventory, I1–I15), P0-006 (prototype)
and P0-008 (estimate) are tracked in §4, §9 and §10 of this plan.

## 4. Information only people/systems can supply (not derivable from the docs)

This is the true critical path. Docs cannot invent these.

| # | Needed | Source | Owner (proposed) | Needed for | Status |
| --- | --- | --- | --- | --- | --- |
| I1 | Sample POS export per location **and** channel (CSV + schema notes). **The POS is being replaced by Frontline POS**; until go-live the samples are **demo/test data** from a Frontline demo/backoffice or sandbox (see `POS_WOLT_NOTES.md`). **Partially received 2026-09-18:** the Frontline **item-list CSV** arrived with data (73 rows, semicolon/UTF-8-BOM/comma-decimal, per-item `mva_kode`); the **daily and monthly reports arrived as empty 0-page PDFs** with no data rows and are therefore not importable. Still needed: Excel/CSV daily/monthly sales reports **with data**, a data-bearing daily report to confirm columns, and the Frontline `API Butikkdata`. **Item-level gap (confirmed 2026-09-18):** the standard monthly/daily reports carry **no item-level (product-line) sales detail** — they are aggregate only; a **per-item report** or **API sales lines** must exist for theoretical consumption, otherwise consumption degrades to **item-group/category granularity** (see **R-01** below). A **reference-only** legacy **Zettle/PayPal item-level export** has been offered as a design aid (**I19**). **New item-level fields to confirm (DEC-041/042/043):** the Frontline item-level export/API must expose **channel and/or applied tax rate per line** (dine-in 25% vs takeaway/catering 15% on the same product, with no " T" suffix — DEC-042) and the **SKU** (the platform-owned reconciliation key, published to Frontline per DEC-015 — DEC-041), and must show **how variants/add-ons appear** (standalone lines vs attached to a parent product — DEC-043). **Taxonomy/SKU/tax per line (DEC-044/045):** SKUs can be set **per item** in Frontline and the product **taxonomy (base / variant / add-on) is platform-owned** (DEC-044); the item-level export/API must carry the **SKU** and the **applied tax per line**, resolved from per-item rules — fixed rate where defined, otherwise item default with a channel override (DEC-045). Profile: `docs/phase0/SAMPLE_ANALYSIS.md`. | Current POS → Frontline POS | Operations | DEC-001, SALE-001..005, fixtures | 🟡 partially received (2026-09-18) |
| I2 | Wolt (and Foodora if used) payout/line **reports supplied directly by the owner** (today the accountant handles them); the system imports the reports directly for channel-level sales. Wolt/Foodora are **separate from the POS** — Frontline's integration capability is not used and those orders are not stored in the POS. A direct Order/Menu API connector is a future step requiring partner onboarding (see `POS_WOLT_NOTES.md`, `DEC-040`). | Wolt/Foodora partner portal (reports) | Owner (via Operations) | DEC-015, SALE-005, REC-002 | ⬜ |
| I3 | Vipps/Stripe settlement exports | Payment providers | Finance | REC-002 | ⬜ |
| I4 | Supplier invoices / price lists (≥2 suppliers) | Suppliers | Purchasing | PROC-002..005, fixtures | ⬜ |
| I5 | Current recipes (cheese bun, açaí, coffee, cake, quiche, chicken pie) + yields | Kitchen | Product owner | A5 fixtures | ⬜ |
| I6 | Current cost spreadsheets | Management | Product owner | A5, reconciliation baseline | ⬜ |
| I7 | Opening stock counts + count cadence | Location managers | Operations | DEC-004, DEC-017 | ⬜ |
| I8 | Labor rates, productive hours, employer charges | Payroll/owner | Finance | DEC-006, COST-004, fixtures | ⬜ |
| I9 | Accountant ruling: VAT rates by product/service/channel, input-VAT recoverability, reporting basis | Accountant | Finance | **DEC-003**, DEC-022, A2 | ⬜ blocking |
| I10 | Fiken/accounting monthly export format + reconciliation package | Accountant/Fiken | Finance | DEC-016, REC-002 | ⬜ |
| I11 | 12 months sales history (if reliable). **Partially available (legacy, 2026-09-18):** the reference Zettle/PayPal item-level export (I19) covers **August 2026 only** (one month, two locations) — see `docs/phase0/SAMPLE_ANALYSIS.md §9`; request additional months if available, **marked legacy**. | POS/Medusa/Wolt | Operations | DEC-011, migrations | 🟡 partial (2026-08 legacy) |
| I12 | Named product owner, technical owner, operational-data owner; RPO/RTO and support hours | Management | Owner (Paulo) | DEC-014, NFR §7.6 | ✅ recorded (2026-09-14): **Paulo Paes** — product, technical and operational-data owner; RPO ≤ 1 hour, RTO ≤ 4 hours (DigitalOcean AMS3, Managed PostgreSQL PITR, Spaces) |
| I13 | Hosting/runtime constraint (EU/Norway data residency, budget, who operates it) | Management | Owner + Tech lead | ADR-0001/0006 | ⬜ |
| I14 | Medusa/direct-online order + product mapping sample | Medusa admin | Tech lead | DEC-002, SALE-002 | ⬜ |
| I15 | POS/Wolt/Medusa API availability + terms. **Frontline POS** exposes a public API (access on request); **Wolt** has developer APIs (partner onboarding); capture base URL/auth/rate-limit/tenant details (see `POS_WOLT_NOTES.md`). | Vendors | Tech lead | DEC-001, DEC-015 | ⬜ |
| I16 | LLM provider data-processing/privacy (DPA) terms | LLM provider (OpenCode Go/Zen) | Tech lead + Finance | DEC-039, provider privacy review | ⬜ |
| I17 | Per-source competitor terms/legal review: which public sources are approved, Wolt menu terms, Instagram treated as manual | Competitor websites / Wolt terms | Product owner (business) | DEC-020, COMP-001…COMP-004 (Phase 4) | ⬜ |
| I18 | Per-source **write** API availability, terms and named credentials owners (POS, Medusa, Sanity first; Wolt, Fiken later) | Vendors (POS/Medusa/Sanity/Wolt/Fiken) | Tech lead + Operations | DEC-015, INTG-001..INTG-003 | ⬜ |
| I19 | **Legacy (Zettle/PayPal) item-level sales export — reference only**: a sample to show the shape of an item-level sales export (product/variant, quantity, net/tax/gross, payment types, column headers). Explicitly **not authoritative** for this project. **Received 2026-09-18 (reference only)** and profiled in `docs/phase0/SAMPLE_ANALYSIS.md §9` — Zettle/PayPal "Detaljert salgsrapport" XLSX, 2026-08-01 → 2026-08-31, 3,861 line rows / 1,734 receipts / 27 trading days, 16 columns; takeaway encoded as a `" T"` name suffix, no payment/channel/category column. | CSV/XLSX (as-is) + column note | Owner (Operations) | importer/report design reference | ✅ received 2026-09-18 (reference only) |

### Risks

- **R-01 — Frontline may not expose item-level sales detail.** The standard monthly/daily reports are
  **aggregate only** (confirmed 2026-09-18), so if the **`API Butikkdata` does not expose sales
  lines** and no dedicated per-item report exists, **theoretical consumption would degrade to
  category (item-group) granularity**, reducing DEC-009 precision (per-product variance invisible).
  **Mitigation:** confirm whether the API exposes sales lines, and request a per-item report if one
  exists (**I1**); if not, run consumption at **category level** and rely on **stock counts and
  production data** for per-product precision. **Owner:** Tech lead + Operations. A **reference-only**
  legacy **Zettle/PayPal export** (**I19**) is used to shape the importer/report design. **A reference
  schema now exists (2026-09-18):** the legacy export has been **profiled** (`docs/phase0/SAMPLE_ANALYSIS.md §9`)
  and defines the item-level field set (timestamp, receipt, staff, product, variant/modifiers,
  quantity, gross unit price, discount, line total, location, derived channel); the **Frontline
  equivalent is still required**.

  **Added channel-tax dependency (2026-09-18):** DEC-042 requires the Frontline item-level data to
  carry the **channel and/or applied tax rate per line** (dine-in 25% vs takeaway/catering 15% on one
  product). If the API/report exposes neither, per-line channel VAT cannot be reconstructed, which is
  a blocking gap for **channel profitability** and for SALE-009 — not only for theoretical
  consumption. Likewise the export must carry the **SKU** for reconciliation (DEC-041) and expose
  **how options/add-ons appear** (standalone vs parent-attached, DEC-043).

  **Tax-resolution design requirement (DEC-045):** once the item-level data exists, the effective rate
  per line is resolved as a **fixed item rate where the item has one** (e.g. book 0 %, retail packs
  such as flour mixes and coffee-bean bags 15 %), otherwise the **item default with a channel
  override** (eat-in 25 % / takeaway/catering 15 %), effective-dated. The importer and the `TaxRule`
  model must resolve and **store** the applied rate per line, applying the channel override only where
  no fixed item rate exists; the accountant confirms each category's classification (DEC-003/DEC-045).

## 5. Decision status

**All 48 decisions (DEC-001…DEC-048) are now accepted; no decision remains `open`** (DEC-001…DEC-039 as of 2026-09-14, DEC-040…DEC-048 as of 2026-09-18). The last decisions closed before this batch were `DEC-001` (the POS/source sample-collection plan is accepted — the actual sample files remain an outstanding external input; the POS is changing to **Frontline POS** and until go-live the samples are **demo/test data** from a Frontline demo/sandbox — see `docs/phase0/POS_WOLT_NOTES.md`) and `DEC-014` (hosting on DigitalOcean in Amsterdam/AMS3, EU/EEA, with Managed PostgreSQL PITR and Spaces; RPO ≤ 1 hour and RTO ≤ 4 hours confirmed; named owners: **Paulo Paes** as product, technical and operational-data owner), and `DEC-040` (Wolt/Foodora sales facts come from payout/line reports supplied directly, not the POS; the accountant continues to handle Wolt/Foodora accounting until a direct API connector is approved). Outstanding Phase 0 items are the external sample/terms inputs (I1–I18), not decisions.

Full register: `12_OPEN_DECISIONS.md`. Twenty decisions existed; **twenty-eight** are added
(DEC-021…DEC-048) to cover tax shape, FX, rounding, cost selection, partial posting, tolerance
defaults, period lock/reopen, reversal/revaluation, in-transit/consolidation, Item-vs-Product,
weekly grain, finished-goods/batch-line modeling, external-mapping conflict resolution (DEC-033),
cost-posting concurrency (DEC-034), the partial-posting ↔ tolerance link (DEC-035), batch-made
intermediate portions (DEC-036), workforce scheduling and worked-hours capture (DEC-037, DEC-038),
AI-assisted advisory analysis and suggestions (DEC-039), the Wolt/Foodora sales source and
integration timing (DEC-040), SKU ownership and the reconciliation key (DEC-041), channel/VAT
representation in the new POS (DEC-042), sales options/add-ons modeling (DEC-043), the Frontline
product model and taxonomy ownership (DEC-044), VAT resolution per line (DEC-045), the menu
structure for sizes and modifiers (DEC-046), the grocery cost sources (DEC-047) and owner-labour
imputation (DEC-048).

Accepted SKU/tax-encoding/sales-options decisions (2026-09-18): `DEC-041` (the business controller
platform is the source of truth for stable, internally assigned SKUs, published to Frontline POS and
channels per DEC-015 and used as the primary reconciliation key, matching on SKU first with external
mapping by POS item number/name only as a fallback), `DEC-042` (Frontline differentiates dine-in 25%
vs takeaway/catering 15% on the same product with no separate " T" products, so sales imports must
carry the channel and/or applied tax rate per line; exposure must be confirmed with Frontline and is
blocking for channel profitability if absent) and `DEC-043` (options/add-ons may arrive as standalone
lines and/or attached to a parent product and must be normalized into a consistent sales-line model).
**New scope:** FND-008/FND-009 (Phase 1) and SALE-009/SALE-010/PRICE-006 (Phase 3).

Accepted product-model/tax/menu decisions (2026-09-18): `DEC-044` (in Frontline every sellable item —
base product, variant and add-on — is a **discrete product with its own SKU**, and sales lines
reference SKUs; the business controller platform owns the product taxonomy and SKU catalogue,
classifying each SKU as **base / variant / add-on**, recording which add-ons apply to which base
products, and publishing the catalogue to Frontline — Excel template now, API when available, per
DEC-015/DEC-041), `DEC-045` (the effective tax rate per sales line is a **fixed item rate** where the
item has one — e.g. book 0 %, retail packs such as flour mixes/coffee bean bags 15 % — otherwise the
**item default with a channel override**, eat-in 25 % / takeaway/catering 15 %; rates follow DEC-003
and the accountant confirms each category's classification) and `DEC-046` (prefer Frontline's
**native variants/options**; otherwise model **sizes as separate base SKUs** — Açaí Small / Medium /
Large, each with its own price and SKU — rather than a "bowl-size upgrade" add-on, keeping add-ons
only for genuinely additive items such as toppings, syrup or an extra shot). **New scope:**
FND-009 (Phase 1) and PRICE-006 (Phase 3), complementing FND-008, SALE-009 and SALE-010.

Accepted cost-source/labour decisions (2026-09-18): `DEC-047` (grocery cost sources) and `DEC-048`
(owner labour imputation).

Accepted workforce-related decisions: `DEC-012` (employee data boundary — costing stores productive
hours plus the loaded role/cost-centre hourly rate and does not link to a named employee; named
employee records exist only for workforce, behind a permission), `DEC-037` (workforce scheduling
added to the MVP, including a monthly payroll-input report produced ~3 days before month-end) and
`DEC-038` (worked hours come from scheduled/registered shifts with manager manual correction; no
clock-in/clock-out in the MVP, with schema room for actual time tracking later). **DEC-037 expands
the MVP scope** beyond the phases/estimate originally proposed.

Accepted forecast/reporting/AI decisions: `DEC-011` (forecasting starts at daily location/category
grain and automatically promotes to product-level grain once a clean-history threshold is met — as
early as the second month — with the active grain always shown), `DEC-032` (weekly reporting
aggregates daily location/channel facts using ISO 8601 weeks, Monday–Sunday, with no separate weekly
close or lock) and `DEC-039` (AI-assisted advisory analysis and suggestions are in Phase 4 scope:
scheduled LLM jobs behind a swappable provider abstraction, advisory-only with human approval and no
auto-publishing or menu/order changes, per-run provenance and cost records, no personal data sent, a
Phase 0 provider data-processing/privacy review, and per-run/monthly token/cost limits, rate limiting
and a kill switch). **DEC-039 adds Phase 4 scope**; `DEC-011` and `DEC-032` confirm forecast and
weekly-reporting grain.

Accepted competitor-intelligence decision: `DEC-020` (competitor intelligence is automated because
there is no staff time for manual upkeep; collection only from approved, permitted sources — public
competitor websites, and Wolt menu only if its terms permit — with a per-source terms/legal review
and `robots.txt`/rate-limit respect; restricted sources such as Instagram use fast manual capture in
the app (paste URL/screenshot/note), never scraping; multiple sources per competitor; price,
product/offer and discount observations carry source URL and capture date; every observation passes
human review before it influences any decision, and the data feeds the AI-assisted analysis
(DEC-039); no personal data). **DEC-020 promotes competitor intelligence (COMP-001…COMP-004) to
required Phase 4 scope.**

Accepted integration-publishing decision: `DEC-015` (external writes **are** permitted, governed per
source — each integration declares its allowed operations (read; write price; write menu/product;
write stock; write accounting) with a named credentials owner; any write originates from an approved
internal change and runs as an idempotent publish job with confirmation read-back, audit, rollback and
failure alerts; no source may write until explicitly approved per operation; first priority POS and
Medusa/Sanity, later Wolt and Fiken subject to their APIs and terms; internal remains the system of
record for approved costs/prices per DEC-002). **This reverses the earlier read-only default** and adds
Phase 3 publishing scope (INTG-001..INTG-003, ADR-0011).

**Phase 1 critical path (must be `accepted` before any Phase 1 logic):**
`DEC-003` (tax), `DEC-005` (central vs local production), `DEC-006` (direct labor), `DEC-007`
(overhead pools/drivers), `DEC-008` (valuation), `DEC-021` (cost selection), `DEC-022` (tax model),
`DEC-023` (FX), `DEC-024` (rounding).

## 6. Proposed requirement → phase map

Satisfies the release gate `09:75`. The authoritative full ID-level map now lives in
`11_REQUIREMENTS_CATALOG.md` §Phase map; this table is a summary only.

| Phase | Requirement groups | Notes |
| --- | --- | --- |
| 0 | P0-001…P0-008 | deliverables, not product requirements; traceability IDs |
| 1 | FND-001..005, PROC-001..007, COST-001..011, PRICE-001..005 | costing & pricing workspace |
| 2 | INV-001..009, PROD-001..004, WASTE-001..002, PLAN-001 | stock & production control |
| 3 | SALE-001..007, REC-001..006, RPT-001..005, OPS-001..003, OPS-005, DQ-001, WF-001..WF-006 | sales, close, reporting, workforce (MVP) |
| 4 | FCST-001/002, COMP-001..COMP-004, PLAN-002 | planning intelligence; competitor intelligence is required by DEC-020 |
| 5 | — | no remaining requirements; DEC-020 promoted competitor automation (COMP-003/COMP-004) into Phase 4 |
| Cross-cutting (all phases) | OPS-004, NFR-001/002, SEC-001..003, UX-001..002, FND-006 | cross-cutting |

The MVP (Phases 0–3) now includes the workforce group (`WF-001…WF-006`): employees, shift/rota
planning, staff self-assignment, worked-hours capture and the monthly payroll-input report, added by
owner decision (DEC-037).

> Note: the Phase 1–3 estimate requires reassessment because the MVP now includes workforce
> scheduling, worked hours and the monthly payroll-input report (DEC-037).

## 7. Documentation contradictions to fix in this close-out

1. **Status label** — `00_README.md:4`, `MANIFEST.json:4` relabelled "Phase 0 input".
2. **MVP vs priority** — menu engineering (RPT-005) and reorder (PLAN-001): promote to **Must** for
   the MVP, because `01:39,59` and `10:14` already promise them. Target-margin solving: keep
   PRICE-004 Must (it is in the MVP `04.7` workflow) — `[PROPOSED]`.
3. **Cost selection vs valuation** — **proposed resolution pending acceptance** (DEC-021):
   replacement/latest approved landed cost for standard costing; moving weighted average for
   inventory valuation; the two are explicitly different numbers.
4. **Reversal vs moving average** — **accepted (2026-09-14)** (DEC-028): reversal
   restores original value; any average gap posts an explicit revaluation correction, never a silent
   restatement.
5. **Theoretical consumption architecture** — DEC-009 and ADR-0005 must agree; if comparison-only is
   chosen, `02_ARCHITECTURE.md:81` and `05_WORKFLOWS.md:53` are corrected to remove assumed consumption postings.
6. **Tax basis in UI vs API** — `Money` gains a required `taxBasis` field in
   `schemas/openapi-outline.yaml` and `06_API_INTEGRATIONS.md`.
7. **Item vs Product duplication** — **proposed resolution pending acceptance** (DEC-030): a stocked `Item` is the inventory identity;
   a sellable `ProductVariant` references zero or one `Item` (finished good) and a
   `ProductRecipeAssignment`; intermediate sub-recipes are stocked items, not products.
8. **Module ownership drift** — `02:44` Costing vs `03:65-75`: Costing owns cards/pools/rules/
   snapshots; Reconciliation owns source/settlement totals and close. `02:44` corrected.
9. **Unmapped enum vocabulary** — completed in `schemas/domain-enums.yaml` (tax_basis, rounding,
   valuation, cost_selection, fee_basis, waste_value_method, recurrence, scope_type, adjustment
   reason, unit_dimension, import_posting_policy, mapping_state).
10. **Weekly reporting unmodelled** — DEC-032 defines weekly grain as an aggregation of daily
    location/channel facts; no separate weekly close.

## 8. Sequencing and critical path

Phase 0 is **dependency-driven, not calendar-driven**, and is expected to take **4–6 weeks**. This
revised dependency-driven estimate supersedes the indicative 2–3 week figure in
`10_DELIVERY_PLAN.md`. The
external critical path is the accountant ruling (I9) and sample collection (I1–I8, I10, I11, I14,
I15), plus the LLM provider data-processing/privacy terms (I16); engineering steps move as soon as
their inputs land. Slippage therefore comes from I1–I16, not
from engineering.

Illustration-only fixtures (A5) are built and reconciled **in parallel with the accountant session**
so structure and math are exercised early; they are re-based on real, signed data before sign-off.

| Step | Week (indicative) | Output | Depends on |
| --- | --- | --- | --- |
| S0 | 0 | Name owners (I12); issue sample-collection requests (I1–I8, I10, I11, I14, I15) | Owner decision |
| S1 | 0–1 | Accountant session → DEC-003/DEC-022, DEC-016 | I9, I10 |
| S2 | 1 | Business decision workshop → DEC-005/006/007/008/021/024, DEC-025..DEC-029 | S0, S1 |
| S3 | 1–2 | Calculation contract (A2) v1 | S2 |
| S4 | 1–2 | ADRs 1–8 (A4) | I12, I13, S2 |
| S5 | 2 | Data dictionary + DDL (A3) | A2, S4 |
| S6 | 2–4 | Illustration-only fixtures in parallel with S1; then real-data fixtures built and manually reconciled (A5) | A2, I1–I8 |
| S7 | 3–5 | Prototype usability tests; threat/privacy review; requirement sign-off | S3–S6 |
| S8 | 4–6 | Phase 0 exit review → **go/no-go for Phase 1** | all |

Weeks are indicative and shift with I1–I16; a week is not a commitment. Parallel-safe from day 0:
CI/repo/logger/test-harness scaffolding (not auth, not persistence).

### Development blockers vs data gates

Owner clarification recorded 2026-09-18.

- **No development blocker remains.** The decisions are accepted (48), the ADRs exist, and the
  calculation contract and data dictionary are pinned, so the foundation work and the costing
  implementation can proceed now — built against the pinned Calculation Contract and tested with
  **synthetic fixtures**.
- **Data gates do not block development; they block validation and go-live.** The outstanding inputs
  are: real recipes/yields (**I5**), supplier costs/receipts (**I4**), the labour remainder (**I8**),
  opening counts (**I7**) and the Frontline data-shape confirmations. These gate the **signing of the
  six golden fixtures** and **real cost/margin trust, and go-live**. The golden fixtures must be
  **signed** before Phase 1 costing is declared accepted or used for real decisions. Real data can be
  loaded later.
- **Recommended order:** build the foundation + costing slice with synthetic fixtures → load real
  data → sign the six golden fixtures → enable real costing.

## 9. Phase 0 exit checklist (gate to Phase 1)

- [x] A1 decision log: every Phase-1 decision `accepted`, owners named.
- [ ] A2 calculation contract signed by finance + product owner.
- [x] A3 data dictionary covers every Phase 1–2 entity; the DDL draft covers the ledger/effective-dating/money/quantity core, is completed per slice, and applies cleanly to an empty database. (Phase 1–2 core implemented per slice as of 2026-09-18: 35 tables migrated via `packages/persistence`, applied cleanly to an empty database; deferred slices remain.)
- [ ] A4 ADR-0001…0008 accepted; ORM (0002), job/outbox (0004), identity (0003), hosting (0001) pinned. (2026-09-18: ADR-0002 accepted with drizzle-orm 0.38.4 / drizzle-kit 0.30.6 / PostgreSQL 16 pinned; the remaining ADRs are still pending.)
- [ ] A5 six fixtures reproduce component values and are signed by finance + owner.
- [ ] Source samples I1–I8, I10 profiled; integration feasibility verified for POS + Wolt.
- [ ] Controlled vocabularies approved; requirement→phase map in file 11.
- [ ] Threat/privacy review and access matrix approved.
- [ ] Estimate for Phases 1–3 produced from profiled data.
- [ ] LLM provider data-processing/privacy (DPA) review completed (DEC-039, I16).
- [ ] Approved competitor sources and the manual fallback (restricted sources such as Instagram) recorded for DEC-020 (I17).
- [ ] Allowed-operations registry and named credentials owners defined for the first write sources (POS and Medusa/Sanity) per DEC-015 (I18).

## 10. Immediate next actions

1. Owner names the product/technical/data owners and approves the proposed Phase 1 critical-path
   defaults in §5 of `12_OPEN_DECISIONS.md` (`[PROPOSED]` items).
2. Book the accountant session (I9/I10) — this gates DEC-003/DEC-022 and A2.
3. Issue the sample-collection requests (I1–I8, I11, I14, I15).
4. Tech lead reviews ADR-0001…0008 and promotes each to `Accepted` or amends.
5. Finance builds the six fixtures against A2 once S1/S2 land.
