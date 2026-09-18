# 6. API and Integration Contracts

## 6.1 API style

Expose versioned JSON APIs under `/api/v1`. REST is the default for commands and resource queries. Use job resources for long-running imports/exports. Internal server actions may call the same application services but cannot bypass authorization, validation or audit.

### Conventions

- IDs are opaque strings.
- Dates use ISO `YYYY-MM-DD`; timestamps use UTC ISO 8601 and render in Europe/Oslo.
- Money is `{ "amount": "123.45", "currency": "NOK", "taxBasis": "inclusive" }`; `taxBasis` is required on every monetary field so the UI can satisfy `08_UI_UX.md:55,67`.
- Quantity is `{ "value": "1.250000", "unitId": "..." }`.
- Pagination is cursor-based for large collections.
- List filters include location/scope, state, effective date and updated-since where relevant.
- Mutating requests carry `Idempotency-Key` for imports, receipts, batches, transfers and postings.
- Optimistic concurrency uses a version/ETag and returns conflict rather than losing updates.
- Errors use stable codes, human message, field details, correlation ID and retryability.
- Every response containing calculated metrics includes `asOf`, scope and calculation/snapshot ID.

## 6.2 Endpoint groups

| Group | Representative endpoints |
| --- | --- |
| Organization | `/locations`, `/storage-areas`, `/channels`, `/users`, `/roles` |
| Catalog | `/items`, `/units`, `/unit-conversions`, `/products`, `/product-variants`, `/allergens` |
| Procurement | `/suppliers`, `/supplier-items`, `/purchase-orders`, `/goods-receipts`, `/supplier-prices` |
| Recipes | `/recipes`, `/recipes/{id}/versions`, `/recipe-versions/{id}/preview-cost`, `/approvals` |
| Costs | `/operating-costs`, `/labor-rates`, `/assets`, `/cost-pools`, `/allocation-rules` |
| Costing/Pricing | `/cost-cards`, `/cost-cards/{id}/recalculate`, `/price-scenarios`, `/price-versions` |
| Inventory | `/stock-balances`, `/stock-movements`, `/stock-counts`, `/transfers`, `/reorder-policies` |
| Production | `/production-plans`, `/production-batches`, `/production-suggestions` |
| Waste | `/waste-events`, `/waste-analysis` |
| Sales | `/sales-transactions`, `/sales-lines`, `/external-mappings` |
| Imports | `/import-runs`, `/import-runs/{id}/validate`, `/import-runs/{id}/post`, `/import-runs/{id}/errors` |
| Reconciliation | `/settlements`, `/reconciliations`, `/daily-closes`, `/period-closes` |
| Insights | `/metrics`, `/menu-engineering`, `/forecasts`, `/budget-scenarios` |
| Planning | `/competitor-observations`, `/seasonal-plans`, `/experiments` |
| Workflow | `/tasks`, `/alerts`, `/approvals`, `/comments` |
| Governance | `/audit-events`, `/data-quality`, `/exports`, `/integration-status` |

## 6.3 Command response

A successful posting/approval command returns the canonical resource, its new state/version, audit reference and any created movement/snapshot/job IDs. Asynchronous commands return `202` with a job URL. Validation failures return all safe-to-display field issues in one response.

## 6.4 Domain events and outbox

Record events transactionally in an outbox. Representative events:

- `goods_receipt.accepted`
- `supplier_price.changed`
- `recipe_version.approved`
- `cost_card.approved`
- `price_version.approved`
- `production_batch.completed`
- `stock_count.approved`
- `stock_threshold.crossed`
- `waste_threshold.crossed`
- `sales_import.posted`
- `reconciliation.failed`
- `period.closed`

Consumers use event ID for deduplication. Event schemas are versioned and contain references, not uncontrolled full-record dumps.

## 6.5 Import framework

Each connector/CSV profile implements:

1. source acquisition and immutable file/reference capture;
2. parser with source schema version;
3. normalization into staging records;
4. mapping to locations, channels, products, taxes and units;
5. validation and source-total checks;
6. preview and exception reporting;
7. idempotent posting;
8. reconciliation and provenance.

Store file checksum, source period, original row number/external IDs, parser/mapping version and posting status. Never discard invalid rows silently.

## 6.6 Integration sequence

| Priority | System | MVP contract | Later |
| --- | --- | --- | --- |
| 1 | Frontline POS | **Excel template import/export** and daily CSV/import profile plus total reconciliation; public API available on request | API sync (base URL/auth/rate-limit/tenant to confirm) |
| 1 | Wolt | **Wolt reports (direct)**: payout/line report import and product mapping for channel-level sales; Wolt data is not taken from the POS | Automated API sync via Wolt partner onboarding (direct Order/Menu API) |
| 1 | Foodora | **Foodora reports (direct)** if used: report import for channel-level sales; Foodora data is not taken from the POS | Direct API integration if available |
| 1 | Suppliers/invoices | Manual/CSV receipt and attachments | Invoice extraction and supplier adapters |
| 1 | Fiken/accounting | Monthly summarized export with references; Fiken API v2 available (OpenAPI, OAuth2/personal token, API add-on already enabled — see `docs/phase0/ACCOUNTING_FIKEN_NOTES.md`) | Validated monthly package and/or API posting of approved summarized documents |
| 2 | Vipps/Stripe | Settlement import and reconciliation | Automated settlement sync |
| 2 | Medusa/direct online | Order/product mapping | Near-real-time orders, inventory and approved price publishing |
| 2 | Workforce/payroll source | Approved role/hour/cost import | Scheduled integration |
| 3 | Weather/events/calendar | Manual factors | Automated forecast features |
| 3 | Competitor sources | Reviewed manual observations | Approved monitoring only |

The **Frontline POS** API is available on request (see `docs/phase0/POS_WOLT_NOTES.md`). Frontline
offers a Wolt/Foodora integration capability, but **Aquarela does not use it and Wolt/Foodora order
data is not stored in the POS** (`DEC-040`); Wolt/Foodora sales facts come from **Wolt/Foodora reports
supplied directly** and imported by the system for channel-level sales and reconciliation. A direct
Wolt Order/Menu API connector is a future step subject to partner onboarding. The **Fiken API v2** is
available and already enabled (OpenAPI-published, OAuth2/personal token); accounting integration may
therefore post approved monthly summaries directly in addition to the file package, subject to
`DEC-015` per-operation approval and the accountant's posting structure.

**Frontline POS export conventions (confirmed from the real item-list export, 2026-09-18; see
`docs/phase0/SAMPLE_ANALYSIS.md`).** The item list (vareliste) is **semicolon-delimited, UTF-8 with
BOM, comma-decimal** with quoted fields where needed, and carries an **`mva_kode`** column mapping
**`3` → 25 %, `31` → 15 %, `5` → 0 %**; VAT is **per item** (mixed within a `varegruppe`) and must
resolve to `TaxRule` rows (DEC-003/DEC-022), not be inferred from the category. `varenummer` is the
stable external identifier → `ExternalMapping`/`ProductVariant`; the file carries **no `Item` cost or
stock**. The **daily (dagsrapport) and monthly (månedsrapport) reports are PDF-only human documents**
in this sample (0-page, no data rows) and are **not an import format** — sales imports use
**Excel/CSV or the Frontline `API Butikkdata`**, not the PDFs.

**Monthly/daily report fields (layout received as screenshots, 2026-09-18; see
`docs/phase0/SAMPLE_ANALYSIS.md §6`).** The monthly report (`Manedsrapport`) is **aggregate** and
prints: **payment types** (Kontant, Bankkort, Gavekort, Tilgodelapp, Faktura, Kundekort), **VAT turnover**
(type, turnover, `Herav MVA` and line counts), **item-group sales** (name/turnover), **hourly sales**
(hour, customers, item lines, turnover), **diverse** (returned goods, discount, average turnover per
active hour, open drawer, **Øreavrunding**), **turnover per cashier**, and **cash withdrawal/deposit**
movements. The sales import should map these aggregate figures — payment totals to settlement
reconciliation, VAT-type turnover and line counts to `sales_line.tax_code`/`tax_amount` — but
**item-level sales detail (per `varenummer`, quantity and net/tax/gross) is still required** for
theoretical consumption (SALE-008).

**Item-level sales gap (confirmed by the owner, 2026-09-18).** The standard Frontline monthly/daily
reports carry **no item-level (product-line) sales detail** — they are aggregate only (payment type,
item group, hour, VAT type, cashier, cash movements). Item-level detail must therefore come from a
**dedicated per-item sales report** or from the **`API Butikkdata`**; the API must be **explicitly
checked for sales-line access** (whether a transactions/lines endpoint exposes per-`varenummer`
quantity and net/tax/gross), alongside the other `API Butikkdata` details already to confirm
(endpoints, base URL, auth, rate limits, tenant ID, sandbox). **If neither the API nor a dedicated
report exposes sales lines, theoretical consumption (DEC-009) runs at item-group/category
granularity only** — a known limitation, with precision then carried by stock counts and production
data. The owner has offered a **reference-only legacy (Zettle/PayPal) item-level sales export** as a
design aid for the shape and columns of the item-level importer/report; it is **not authoritative**
data (`I19` in `docs/phase0/SOURCE_DATA_REQUEST.md`). See `docs/phase0/SAMPLE_ANALYSIS.md` ("Known
gap") and risk **R-01** in `docs/phase0/PHASE0_CLOSEOUT_PLAN.md`.

**Item-level reference schema (legacy Zettle/PayPal, profiled 2026-08-18; see
`docs/phase0/SAMPLE_ANALYSIS.md §9`).** A real item-level reference export is now available for the
**sales import shape** — a legacy Zettle/PayPal "Detaljert salgsrapport" (XLSX, one month, 3,861 line
rows over 1,734 receipts, two locations, 16 columns). The target import must support the
**equivalent fields**: **timestamp** (date + time), **receipt number**, **staff**, **product**,
**variant/modifiers**, **quantity**, **unit price**, **discount**, **line total**, **location** and a
**derived channel** (the legacy export encodes takeaway as a `" T"` suffix on the product name;
Frontline's encoding is still to confirm). It also confirms the item-level export carries **no
payment method** (settlement comes from the settlement reports, REC-001/REC-002) and **no category**
(map via Frontline `varegruppe`). This export is **reference-only and not authoritative**; Frontline's
authoritative **item-level export/API access remains outstanding** (`I1`, risk `R-01`).

**SKUs, channel VAT and options/add-ons — questions to confirm with Frontline (DEC-041/042/043,
2026-09-18).**

- `DEC-041` — **SKUs are supplied by this platform.** The business controller owns stable, internally
  assigned SKUs (item/product codes) and they must be **publishable to Frontline POS** (under DEC-015)
  and readable back on Frontline exports/API, so SKU is the **primary reconciliation key**; imports
  match on SKU first and fall back to `ExternalMapping` by POS item number/name only when no SKU is
  present. **Confirm:** can Frontline store/return an externally supplied SKU per `varenummer`, and
  through which field/endpoint?
- `DEC-042` — **dine-in and takeaway tax on one product.** Frontline applies 25 % dine-in and 15 %
  takeaway/catering **on the same product without separate " T" products**, so imports need the
  **channel and/or the applied tax rate per line**. **Confirm:** is that exposed as a column in the
  item-level export and/or an `API Butikkdata` field (per line or per transaction)? If it is not
  exposed, per-line channel VAT cannot be reconstructed — **blocking for channel profitability**
  (SALE-009).
- `DEC-043` — **options/add-ons.** Options/add-ons may arrive as **standalone product lines**,
  **attached to a parent product**, or both; the importer must support both shapes and normalize them
  into one sales-line model (parent product, option/add-on, channel, quantity, price, tax). **Confirm:**
  how Frontline records modifiers/add-ons on an item-level export/API (separate `varenummer` lines vs a
  modifier field on the parent line), to be finalized against a real Frontline export.

**Frontline product model, publishing format and VAT resolution (DEC-044/045, 2026-09-18).** Frontline
holds every sellable item — base product, variant and add-on — as a **discrete product with its own
SKU**, and sales lines reference SKUs, so the **platform owns the product taxonomy** (base / variant /
add-on, and which add-ons apply to which base product) and the SKU catalogue, publishing it to
Frontline. Frontline supports **Excel template import/export today** (SKUs can be set **per item**) and
the API likely does too, so catalogue publishing may start via the **Excel template** and move to the
**API** when available (DEC-015, DEC-041). VAT is **per line, from a per-item rule**, and can differ by
**channel on the same item** (eat-in 25 % vs takeaway/catering 15 %), with some items at **fixed
rates** (a book at 0 %; future retail packs such as flour mixes and coffee-bean bags at 15 %). The
importer must resolve and store the **effective rate per line** — fixed item rate where defined,
otherwise item default with a channel override — and carry the **SKU** and **applied tax per line**
(DEC-045).

**Frontline product setup — dual price/VAT, extras and variants (screenshots, 2026-09-18; see
`docs/phase0/SAMPLE_ANALYSIS.md §10` and `FRONTLINE_PRODUCT_SETUP_NOTES.md`).** The Frontline **Product
Setup** screen shows how the POS models one product, and confirms the DEC-042/043/044 mechanisms:

- **Detaljer** carries a **default** (25 %) and an **alternative** (15 %) price/VAT on the **same item**
  (`Alternativ pris tilgjengelig`, `Alternativ MVA` = "Utgående mva, middels sats (15 %)",
  `Alternativ pris inkl. MVA`) — i.e. eat-in vs takeaway is handled on one product, not with separate
  `" T"` products, matching DEC-042. The export must be **confirmed to show the applied price/VAT per
  line**, or channel profitability cannot be reconstructed.
- **Restaurant** carries **`Ekstravalg`** (attached extras) with an **`Automatisk ekstravalg pop-up`**;
  each extra is an **existing product with its own price** (the açaí extras include toppings and the
  `Medium Bowl 20` / `Large Bowl 40` size upgrades), so add-ons are attachable **while still being
  separate products** (DEC-044).
- **Farge og størrelse** groups **separate item numbers** as colour/size **variants**, with prices set on
  the item number, so variants carry **their own prices**; the original item is also listed as a variant.
  The export must be **confirmed to carry the variant/extra item numbers** (each resolvable as an
  `ExternalMapping`), not only a parent item.

## 6.7 Integration ownership

For each integration, Phase 0 records source owner, data owner, credentials owner, allowed operations, rate limits, source IDs, timezone/currency/tax meaning, retry policy, reconciliation method, retention and failure contact.

Read-only ingestion is the default. No MVP connector may update an external menu, price, stock or accounting record without a separate approved publishing design and rollback procedure.

## 6.8 Webhooks and scheduled jobs

Webhook handlers verify signatures, retain event identity, acknowledge quickly and enqueue processing. Scheduled imports use per-source cursors and overlapping lookback windows with deduplication. Jobs use exponential retry with maximum attempts, dead-letter status and visible recovery controls.

## 6.9 Exports

Authorized users can export filtered master data and transactions in documented CSV/JSON formats. Closed-period exports include snapshot ID, generated time, user, scope and checksums. Data portability must not depend on a proprietary vendor format.

The accepted DEC-016 export model is a monthly reconciliation package for the accountant: structured CSV/JSON exports carrying snapshot ID, generated time, scope and checksums, plus reference links to the underlying source records. Validate the exact shape against Fiken's import and the accountant's process before build. Where accounting-relevant data is exported, provide a SAF-T-shaped variant as Norwegian bookkeeping expects.

The **Fiken API v2** is an available integration (OpenAPI-published spec, OAuth2/personal token, API add-on already enabled for Aquarela — see `docs/phase0/ACCOUNTING_FIKEN_NOTES.md`), so monthly summaries may be **posted via the API for approved operations or exported as a validated package file**; the statutory SAF-T shape remains a file export. Fiken is a write target under `DEC-015` and requires per-operation approval plus the accountant's posting structure.

