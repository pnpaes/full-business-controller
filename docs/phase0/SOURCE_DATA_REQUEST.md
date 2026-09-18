# Source Data Request — Phase 0 External Inputs

Status: **Request issued by the owner; partially received.** This is the checklist of external
inputs (I1–I19 in `PHASE0_CLOSEOUT_PLAN.md §4`) needed to close Phase 0. Each row has a proposed
owner; the owner confirms and returns the item. **I1 is partially received (2026-09-18)**: the
Frontline item list CSV arrived with data, the daily/monthly reports arrived as empty PDFs, and the
**monthly report layout has since been received as screenshots** — see `SAMPLE_ANALYSIS.md` and the
note below the checklist.

## How to send it

- **Send to:** Paulo Paes (product, technical and operational-data owner, `DEC-014`), or to the
  proposed owner named on each row, who then forwards it.
- **Preferred formats:** raw exports over screenshots — CSV/XLSX for tabular data, the source's own
  export file where it exists, PDF only for invoices/price lists, and a short README (`schema
  notes`) describing columns, date range, location/channel and units for any export.
- **One item per delivery** where possible, labelled with its `Ref` (for example `I1`), so it can be
  profiled and logged against this request.
- **Privacy note:** samples are for **profiling only** — size, shape, columns, coverage — not for
  production loading. **Redact or omit personal data** wherever possible (employee names, contact
  details, customer data). Where a field is needed for profiling, replace it with a token or an
  aggregate; never send more personal data than the sample requires (`07_SECURITY_AND_NFR.md §7.4`).

## Checklist

| Ref | What we need | Preferred format | Owner (proposed) | Needed by | Status |
| --- | --- | --- | --- | --- | --- |
| I1 | **Frontline POS** (the new POS): API access + docs + sandbox/test environment; sample/**demo** Excel exports of the standard reports (daily sales, item/product sales, VAT, payments, stock); item/product list with identifiers; confirmation of Frontline's Wolt/Foodora integration capability (context only — Wolt/Foodora data is not stored in the POS). Demo data until go-live — see `POS_WOLT_NOTES.md`. **Partially received 2026-09-18:** item list CSV **received with data** (73 rows); daily and monthly reports received but **empty, 0-page PDFs** with no data rows (PDFs are not importable — see `SAMPLE_ANALYSIS.md`); the **monthly report's layout has since been received as screenshots** (`schemas/mnd-report-pg1.png`/`pg2.png`, documented in `SAMPLE_ANALYSIS.md §6`). Still outstanding: a **machine-readable (Excel/CSV) daily and monthly report with data**, **critically an item-level sales export** (per `varenummer`, with quantity and net/tax/gross amounts) **for theoretical consumption**, a **data-bearing daily report** to confirm the real columns, confirmation of the **available export options**, and the **Frontline `API Butikkdata`** (endpoints, base URL, auth, rate limits, tenant ID, sandbox). **Item-level detail — confirmed absent (owner, 2026-09-18):** the standard monthly/daily reports carry **no item-level (product-line) sales detail** — they are aggregate (payment type, item group, hour, VAT type) only. Still requested, in order of preference: **(a)** a dedicated **per-item sales report** (per `varenummer`, quantity + net/tax/gross) if one exists; or **(b)** confirmation that the **`API Butikkdata` exposes sales lines** (line-level transactions). If **neither** exists, **theoretical consumption can only run at item-group/category granularity** — a known limitation, not a temporary gap. This remains the **outstanding authoritative request**; the **legacy Zettle/PayPal reference export (I19)** does **not** satisfy it (reference-only, not authoritative). **New requests (DEC-044/045):** provide the Frontline **Excel import/export template(s)** for items/products — **SKUs can be set per item** in Frontline — and confirm whether the **`API Butikkdata`** exposes the **SKU** and the **applied tax/VAT per line** (per-item rules with channel differences and some fixed rates). **Product-setup samples (2026-09-18):** also request a sample export covering an item with an **attached ekstravalg**, an item sold at the **alternative price/VAT (takeaway)**, and a **colour/size variant** sale — to confirm the export fields — plus confirmation of the **numeric `mva_kode` (3/31/5) ↔ named VAT-code** mapping (see `FRONTLINE_PRODUCT_SETUP_NOTES.md`). | CSV/XLSX + schema notes; API docs link | Operations | S0–S1 | 🟡 partially received (2026-09-18) |
| I2 | Wolt (and Foodora if used) payout/line **reports provided directly by the owner**; today the accountant handles them and the system will import the reports directly for channel-level sales. Payout reports can be sent **now** from the merchant portal. Wolt/Foodora data is **not** taken from the POS. A direct Wolt **Order/Menu API** connector is a future step requiring partner onboarding — docs: integration guide <https://developer.wolt.com/docs/getting-started/restaurant>, auth <https://developer.wolt.com/docs/authentication20> (SSIO <https://developer.wolt.com/docs/authenticationssio> / WIO <https://developer.wolt.com/docs/authenticationwio>), Order API <https://developer.wolt.com/docs/orderrestaurantguide> + API reference <https://developer.wolt.com/docs/api>, Menu API <https://developer.wolt.com/docs/menuguide>, Venue API <https://developer.wolt.com/docs/venueguide>; onboarding path is request → test credentials → sandbox → demo call → single-venue pilot. Postman: <https://postman.com/merchant-integrations/wolt-marketplace-integrations>. See `DEC-040` and `POS_WOLT_NOTES.md`. | CSV/XLSX from Wolt/Foodora partner portal | Owner (via Operations) | S0–S1 | ⬜ |
| I3 | Vipps/Stripe settlement exports | CSV from provider portal | Finance | S0–S1 | ⬜ |
| I4 | Existing item cost data — **price Excel files and recent grocery receipts** (plus supplier price lists only where a real supplier exists, e.g. coffee roaster, packaging) | XLSX/CSV price files + receipt scans/photos (PDF price lists only for genuine suppliers) | Owner / Purchasing | S0–S2 | ⬜ |
| I5 | Six recipes (cheese bun, açaí, coffee, cake, quiche, chicken pie) with yields/loss, portion/prep time and allergens | XLSX or PDF; one sheet per recipe | Product owner / Kitchen | S0–S2 | ⬜ |
| I6 | Current cost spreadsheets — now the primary input to the **cost catalogue** (item, pack size, price) for items with no supplier price list (DEC-047) | XLSX (as-is) | Product owner / Management | S0–S2 | ⬜ |
| I7 | Opening stock counts + count cadence | CSV/XLSX counts + note on cadence | Operations / Location managers | S0–S2 | ⬜ |
| I8 | Labour rates, productive hours and employer-cost components. **Partially received 2026-09-18 (owner):** base rates **NOK 210/h** (front of house / most employees) and **NOK 240/h** (kitchen; owner production hours imputed at the kitchen rate (DEC-048)); employer costs **feriepenger 10.2 %**, **arbeidsgiveravgift 14.1 %** (Oslo/Sone 1 — to confirm with the accountant; zone rules changed from 2025), **OTP 2 %**. Compounded loaded rates ≈ **NOK 268.25/h** (210) and **NOK 306.57/h** (240) — see `docs/phase0/LABOUR_ASSUMPTIONS.md` and `samples/generated/labour_rates_2026-09-18.csv`. **Still requested:** productive-hours %, any employer injury insurance/other payroll costs, and the role → location mapping. | XLSX or CSV, aggregate by role | Finance | S0–S2 | 🟡 partial (2026-09-18) |
| I9 | Accountant ruling: VAT rates by product/service/channel, input-VAT recoverability, reporting basis | Written response (see `ACCOUNTANT_QUESTIONS.md`) | Finance / Accountant | S1 (blocking) | ⬜ blocking |
| I10 | Fiken/accounting monthly export format + reconciliation package. The **Fiken API v2 is enabled** — REST base `https://api.fiken.no/api/v2/`; the interactive docs at `https://api.fiken.no/api/v2/docs/` are a JavaScript SPA, so the artifact to build the client from is the **OpenAPI/Swagger spec `https://api.fiken.no/api/v2/docs/swagger.yaml`** (use it to enumerate endpoints and generate a TypeScript client) (see `ACCOUNTING_FIKEN_NOTES.md`). Also needed: **kontoplan (chart of accounts)** and **VAT-code list**, and confirmation of the **monthly posting structure** (one document vs per day/location); credentials: a **personal API token or OAuth credentials**, stored in the secret manager, plus the named credentials owner | Spec/sample file + note + kontoplan/VAT-code list + token provisioned in secret manager | Finance / Accountant | S1 | ⬜ |
| I11 | 12 months sales history (if reliable). **Partially available (legacy, 2026-09-18):** the reference Zettle/PayPal item-level export (I19) covers **August 2026 only** (one month, item-level, two locations) — see `SAMPLE_ANALYSIS.md §9`. Request **additional months if available**, all **marked legacy** and kept separate from authoritative Frontline history. | CSV export, by day/location/channel | Operations | S0–S2 | 🟡 partial (2026-08 legacy) |
| I12 | Named product owner, technical owner, operational-data owner; RPO/RTO and support hours | Recorded in decision log | Owner (Paulo) | S0 | ✅ recorded (2026-09-14) |
| I13 | Hosting/runtime constraint (EU/Norway data residency, budget, who operates it) | Recorded in decision log | Owner + Tech lead | S0 | ✅ done (2026-09-14) — DigitalOcean AMS3 (EU/EEA), Managed PostgreSQL PITR + Spaces; Paulo Paes operates |
| I14 | Medusa/direct-online order + product mapping sample | CSV/JSON + mapping notes | Tech lead | S0–S2 | ⬜ |
| I15 | POS/Wolt/Medusa API availability and terms. **Frontline POS** has a public API (access on request, <https://frontlinepos.no/api-butikkdata/>); **Wolt** has developer APIs (partner onboarding, <https://developer.wolt.com>). Capture base URL, auth model, rate limits and any per-deployment tenant identifier (see `POS_WOLT_NOTES.md`). Frontline supports **Excel template import/export** today (per-item SKUs can be set from it) and likely the API; request the **template(s)** and confirm the API exposes the **SKU** and the **tax/VAT per line** (DEC-044/045). | Vendor docs / terms links + contact | Tech lead | S0–S2 | ⬜ |
| I16 | LLM provider data-processing/privacy (DPA) terms | Provider DPA / terms document | Tech lead + Finance | before AI enablement (`DEC-039`) | ⬜ |
| I17 | Per-source competitor terms/legal review: approved public sources, Wolt menu terms, Instagram treated as manual | Source list + terms links | Product owner (business) | before Phase 4 (`DEC-020`) | ⬜ |
| I18 | Per-source **write** API availability, terms and named credentials owners (POS, Medusa, Sanity first; Wolt, Fiken later) | Vendor docs + credentials owner per source | Tech lead + Operations | before Phase 3 publishing (`DEC-015`) | ⬜ |
| I19 | **Legacy (Zettle/PayPal) item-level sales export — reference only.** An export from the **existing/legacy system** offered by the owner purely as a **reference for what an item-level sales export looks like**; it is explicitly **not authoritative data for this project**. Useful content: a **product-level sales export** (per product/variant, with **quantity** and **net/tax/gross** amounts); a **transactions/lines export** if available; the **payment types**; and the **column headers** (a raw file with schema notes is ideal). Used to shape the importer/report design and to cross-check our expected columns against a real item-level source. **Received 2026-09-18 (reference only):** Zettle/PayPal "Detaljert salgsrapport" XLSX for 2026-08-01 → 2026-08-31 — 1 sheet, 3,861 line rows over 1,734 receipts and 27 trading days across two locations, 16 semicolon-delimited columns (date/time, receipt, staff, product, variant, quantity, gross price, discount, line total, location), takeaway encoded as a `" T"` name suffix, with no payment, channel or category column. Full profile in `SAMPLE_ANALYSIS.md §9`. | CSV/XLSX (as-is) + short column/schema note | Owner (Operations) | importer/report design reference (not authoritative) | ✅ received 2026-09-18 (reference only) |

## Received so far (2026-09-18)

- **Item list CSV** (`vareliste_AQUARELAASNy (2).csv`) — **received with data**: 73 rows,
  semicolon-delimited, UTF-8 BOM, comma decimals, per-item `mva_kode`. Full profile in
  `SAMPLE_ANALYSIS.md`.
- **Daily and monthly reports** (`dagsrapport_*.pdf`, `manedsrapport_*.pdf`) — **received but empty**:
  0-page PDFs with no data rows, so **not importable**. They do not satisfy I1's report samples.
- **Monthly report layout** — received as **screenshots** (`schemas/mnd-report-pg1.png`,
  `schemas/mnd-report-pg2.png`); sections and columns documented in `SAMPLE_ANALYSIS.md §6`.
- **Legacy (Zettle/PayPal) item-level sales export (I19)** — **received 2026-09-18**, reference-only:
  `schemas/PayPal-POS-Raw-Data-Report-20260801-20260831.xlsx` (one month, 3,861 line rows, two
  locations); profiled in `SAMPLE_ANALYSIS.md §9`. Not authoritative and does not satisfy I1.
- **Still requested from Frontline:**
  1. **Item-level sales export** (per `varenummer`, with quantity and net/tax/gross amounts) — required
     for theoretical consumption; the aggregate reports are insufficient.
  2. **Excel/CSV** versions of the **daily and monthly sales reports with data**.
  3. A **data-bearing daily report** sample to confirm the real columns (date, location, channel,
     product, quantity, gross/net/VAT, payment method).
  4. Confirmation of the **available export options** (which standard reports export to Excel/CSV,
     and any column/schema reference).
  5. **`API Butikkdata`** access and documentation — **endpoints, base URL, auth model, rate limits,
     tenant identifier and sandbox** — since the PDFs are human-only and cannot be parsed for import.
   6. The Frontline **Excel import/export template(s)** for items/products (**SKUs can be set per
      item** in Frontline), and confirmation that the **`API Butikkdata`** exposes the **SKU** and the
      **applied tax/VAT per line** (DEC-044/045). **Reinforced (2026-09-18):** the template must
      round-trip **colour/size variants and ekstravalg links** (parent/child item numbers).
   7. A **product-setup sample export** (`docs/phase0/FRONTLINE_PRODUCT_SETUP_NOTES.md`): an item with
      an **attached ekstravalg**, an item sold at the **alternative price/VAT (takeaway)**, and a
      **variant-matrix sale (flavour × size, e.g. açaí)** — **reinforced (2026-09-18):** the sample must
      include a **2D variant-matrix sale (Farge = flavour × Størrelse = size)** so the exported
      **`varenummer`, price and VAT** fields can be confirmed per variant item.
   8. Confirmation of the **numeric `mva_kode` (3 = 25 %, 31 = 15 %, 5 = 0 %) ↔ named VAT-code**
      mapping (the product form shows named codes such as "Utgående mva, høy/middels sats").

## Status legend

- ⬜ not collected
- 🟡 partially received
- ✅ done / recorded
