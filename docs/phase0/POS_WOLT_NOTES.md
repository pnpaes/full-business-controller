# POS and delivery-platform notes (Frontline POS, Wolt, Foodora)

Status: **research notes — everything here is to verify with vendor.** Findings collected from public
vendor sites on **2026-09-18**; nothing below is a confirmed contract or interface until the vendor
answers the questions in the last section.

## 1. Current state

- Aquarela is **replacing its POS**. **Frontline POS will be the new POS.**
- There is **no real POS data yet** — Frontline is newly adopted and has not gone live, so no historic
  sales, item or stock data exists in it.
- Consequence for Phase 0: the POS sample requested in `SOURCE_DATA_REQUEST.md` (I1) and referenced in
  `PHASE0_CLOSEOUT_PLAN.md §4` cannot be a real production export. Until go-live it must be
  **demo/test data** produced from a Frontline demo/backoffice or sandbox (see §3).

### Confirmed by the real exports (2026-09-18)

The first Frontline exports received (profiled in `SAMPLE_ANALYSIS.md`) confirm the concrete formats:

- The **item list (vareliste)** is **semicolon-delimited, UTF-8 with BOM, comma decimals**, and carries
  an **`mva_kode`** column (`3` → 25 %, `31` → 15 %, `5` → 0 %), with **tax per item** (mixed within a
  group) rather than per category. `varenummer` is the stable external identity.
- The **daily and monthly reports arrived as PDF-only, 0-page documents** with no data rows — **not
  importable**. Daily/monthly sales must therefore come from **Excel/CSV exports or the Frontline API
  (`Butikkdata`)**; ask Frontline for those (see §3, §6).

## 2. Frontline POS capabilities relevant to this system

Vendor: **Frontline Systems by OfficeLink** (frontlinepos.no); HQ Bodø/Trondheim, Norway.

- **Public API page ("API Butikkdata")** — <https://frontlinepos.no/api-butikkdata/>. States the API is
  well documented and gives access to several types of data; **access is granted on request**. This is
  the starting point for a data integration.
- **Reports exportable to Excel or PDF**, and the system can integrate with external tools for further
  analysis — <https://frontlinepos.no/statistikk-og-rapporter/>.
- **Built-in accounting integrations**: PowerOffice Go, Unimicro, Tripletex, Fiken, Visma
  (Business/Net/Global/Contracting), 24SevenOffice, XLedger — <https://frontlinepos.no/integrasjoner/>
  (plus the accounting-integration request form).
- **Wolt and Foodora integration capability in the POS** — Frontline offers a Wolt/Foodora integration
  capability (see the Frontline blog post "Wolt og Foodora direkte i kassen"), but **Aquarela does not
  use it; Wolt/Foodora order data is not stored in the POS**. Delivery-platform sales facts come from
  **Wolt/Foodora reports supplied directly** (see §4 and §5).
- **Backoffice and module system**: items, stock, pricing, and recipes/kalkyler (per the restaurant
  page).
- Dealer/support knowledge base: <https://support.handelsdata.no/frontline/> (Handelsdata is a
  reseller).

### CAUTION — redocly false positive

`frontline-public-api.redocly.app` is a **different company** (a CRM product also named "Frontline"),
**not** this POS. Do not treat it as Frontline POS API documentation. Chase only
<https://frontlinepos.no/api-butikkdata/> and the vendor contact for the real docs.

## 3. How to obtain sample/demo data before go-live

Concrete steps to produce representative sample data without waiting for production:

1. **Ask Frontline for API access and documentation**, and whether a **sandbox/test environment** exists
   for the backoffice and API.
2. **Request representative Excel exports of the standard reports** from a demo/backoffice: daily sales,
   product/item sales, VAT, payments, stock.
3. **Create a small demo product set in the backoffice** (enough items/categories/channels to exercise
   the import profile) so it produces realistic exports.
4. **Confirm the item/product export and external identifiers** — which field is the stable product ID,
   whether the POS supports an external/SKU identifier we can map to, the exact **Excel import/export
   template** (columns, delimiter, encoding, decimals, tax columns), and how variants/add-ons appear
   (as distinct SKUs, standalone lines or attached options) and whether the POS supports native
   options/variants (`DEC-044`, `DEC-046`).
5. **Confirm Frontline's Wolt/Foodora integration capability** and whether it would ever store those
   orders, but **do not rely on it now** — Aquarela does not use the integration and Wolt/Foodora order
   data is not stored in the POS (`DEC-040`).
6. **Ask about the API auth model, base URL, rate limits, and any per-deployment tenant identifier.**

### Questions to send to Frontline

1. Can we get access to the "API Butikkdata" API? What is the onboarding/approval process?
2. Where is the API documentation, and what is the **base URL**?
3. Is there a **sandbox/test environment** (API and backoffice) we can use before go-live?
4. What **authentication model** is used (API key, OAuth, etc.), and who owns/rotates the credentials?
5. What are the **rate limits**, quotas and fair-use terms?
6. Is there a **per-deployment tenant/account identifier** we must send on each call?
7. Which **standard reports can be exported to Excel**, and what columns do they contain: daily sales,
   product/item sales, VAT, payments, stock?
8. What is the **item/product export**, and does it include a stable **external identifier/SKU** we can
   map to?
9. Does Frontline offer a **Wolt/Foodora integration**, and would it ever store those orders in the
   POS? This is context only — Aquarela does not use it now and does not rely on Wolt/Foodora data
   being in the POS (`DEC-040`).
10. Does the system support any **outbound/write API** (prices, products, stock), or is the API
    read-only?
11. What is the **data retention** in the backoffice/API, and how far back can we export?
12. Can a **representative demo dataset** be provided, or can we build one in a demo backoffice?

### Questions for Frontline — new POS data shape (DEC-041, DEC-042, DEC-043, DEC-044, DEC-045, DEC-046)

1. Does the sales **export/API expose the channel** (dine-in / takeaway / catering) and/or the **applied
   VAT rate or type per line**, and how — which column or field?
2. Are **variants and add-ons exported as standalone lines or attached options** — and what does that look
   like in the export/API (parent/child link, option flag, included vs charged)?
3. Does Frontline store a **per-item SKU**, can it be set/imported, does it appear on sales lines, and can
   it be updated via the API?
4. Can Frontline **differentiate dine-in vs takeaway tax on the same item** in reports/API, and how is that
   represented (separate rate per line, channel field, or elsewhere)?
5. Can you confirm the **Excel import/export template** details for items and sales: the exact columns,
   delimiter, encoding, decimal separator and tax columns, and whether our platform-owned SKU catalogue can
   be round-tripped through it (`DEC-044`)?
6. Can the **API read sales lines with SKU and the applied VAT** per line, and what are the exact field
   names for both?
7. How do **variants and add-ons** appear in Frontline — each a distinct product with its own SKU (as the
   item export suggests), and are they listed as standalone lines or attached options?
8. Does Frontline support **native options/variants** (a parent product with size/option children) rather
   than separate base products per size, and how are they represented in the export/API? This decides
   whether we model sizes as `product_kind = variant` or as separate base SKUs (`DEC-046`).
9. Does the sales export/API show the **applied** VAT rate and price per line when a product has both
   a default and an **alternative** price/VAT (the **"Alternativ pris / Alternativ MVA"** fields on the
   Detaljer tab, e.g. 25 % dine-in vs 15 % takeaway) — i.e. is the default or the applied value
   exported, and in which column/field? (`DEC-042`, `DEC-045`)
10. Do **attached ekstravalg** (Restaurant tab) appear as their own export/API lines, is the
    **parentage** visible (parent line id / option flag), and is the add-on's own price carried on its
    line? (`DEC-043`)
11. Does a **colour/size variant** sale emit the **variant's `varenummer`** (rather than the parent
    item's number)? (`DEC-046`)
12. What is the mapping between the numeric **`mva_kode`** in the item export (`3` → 25 %, `31` → 15 %,
    `5` → 0 %) and the **named VAT codes** shown in the product form ("Utgående mva, høy/middels sats")?
    Can Frontline document the full VAT-code list? (`DEC-003`, `DEC-045`)
13. What is the **stock behaviour for size variants** — is stock held on the parent or per variant item
    number, and how does Farge og størrelse affect stock movements/reporting?

**Additional questions — "Farge og størrelse" variant matrix (2026-09-18).** These reinforce questions
11 and 13 above for the agreed açaí pattern (Farge = flavour, Størrelse = size; `DEC-046`):

a. Must the **original/grouping item number** also be listed as one of the **variant item numbers**, and
   can it be **deactivated** so it is not sold?
b. Must **"Alternativ pris / Alternativ MVA"** be set **per variant item**, or does it inherit from the
   parent (dine-in 25 % vs takeaway 15 %)? (`DEC-042`, `DEC-045`)
c. Does a **variant sale export the variant's `varenummer`** (rather than the parent item's number)?
d. How does **stock behave across variant items** — is it held on the parent or per variant item number,
   and how does Farge og størrelse affect stock movements/reporting?

See `FRONTLINE_PRODUCT_SETUP_NOTES.md` (2026-09-18) for the product-setup screenshots behind
questions 9–13.

## 4. Wolt

**Correction (owner, 2026-09-18): Wolt order data is NOT stored in the POS.** Today the owner sends
**Wolt reports to the accountant**, who handles the accounting. Our system will import Wolt payout/line
reports **directly** to get channel-level sales — not via the POS. See `DEC-040`.

- **Current flow**: Wolt reports → accountant (handled manually). No Wolt data reaches the POS.
- **Target flow (near term)**: Wolt (and Foodora if used) payout/line **reports are supplied directly**
  to the system and imported for channel-level sales and reconciliation, while the accountant continues
  to handle Wolt/Foodora accounting. Wolt/Foodora are **separate from the POS**.
- **Developer docs**: <https://developer.wolt.com/docs>; **Order API reference**:
  <https://developer.wolt.com/docs/api>; a **Menu API** also exists. A direct Wolt Order/Menu API
  integration is a **possible future connector**, subject to partner onboarding — not part of the MVP.
- **Merchant payout reports** are available in the **Wolt merchant portal** (learning center: "guide to
  merchant payout reports"): payout report, merchant invoice, fee/refund detail.
- **Postman collections** exist for Wolt Marketplace Integrations and the Wolt Drive API.
- **Access model**: API access is via **Wolt partner onboarding** and issuance of credentials; a direct
  API integration requires a partner arrangement.
- **What to request now**:
  - Payout reports for the relevant period(s) (merchant portal export), supplied **directly** by the
    owner.
  - Any **line-item/settlement export** available today (whatever format the portal offers).
  - **API onboarding** via <https://developer.wolt.com> — scope, credentials, sandbox availability.
- **What the API covers** (per public docs): Order API (order details) and Menu API (menu read/write);
  confirm exact scopes and terms with Wolt.
- **What this means for the MVP**: Wolt payout/line reports are the source of channel-level sales facts
  and can be supplied **directly now**; a direct Wolt API connector is a future step depending on the
  partner arrangement. Wolt sales facts do **not** come from the POS.

### Wolt developer documentation (details)

Source of the following: <https://developer.wolt.com/docs/getting-started/restaurant> (fetched 2026-09-18).

- **Target audience**: Restaurant POS and Middleware Providers (MWP). The integration request is made
  via a Wolt form, after which Wolt issues **test credentials**.
- **Onboarding flow**: integration request → **test credentials** issued → **sandbox testing** → a
  demo/fine-tuning call → a **pilot at a single venue** → full rollout. A **pilot venue is required**
  before any production rollout.
- **Authentication** (`/docs/authentication20`): OAuth 2.0. Activation is via **SSIO** (self-service —
  the merchant activates the integration in your UI, `/docs/authenticationssio`) and/or **WIO**
  (Wolt-led, `/docs/authenticationwio`). A **Brand OAuth** flow also exists (`/docs/authentication-brand`).
- **Order API** (`/docs/orderrestaurantguide`; API reference `/docs/api`): webhooks for order status plus
  pull-based retrieval. Required endpoints include **Get order**, **Accept order** (declare prep time),
  **Confirm pre-order**, **Mark order ready**, **Reject order**; optional **Mark order sent to POS** and
  **Mark order delivered** (takeaway). Self-delivery endpoints also exist: Accept self-delivery order,
  Pickup completed, Courier tracking, Courier at customer, Delivery ETA.
- **Menu API** (`/docs/menuguide`): **Create menu**, **Update menu items**, **Update menu options**;
  optional **Get menu**.
- **Venue API** (`/docs/venueguide`): **Get venue status**, **Update venue online status**, **Update
  venue opening times**; optional special opening times and get/change delivery provider.
- **Webhooks** (`/docs/webhook`), **errors** (`/docs/errors`), **test cases** (`/docs/testcases`),
  performance standards, country-specific standards, and a changelog.
- **Public Postman collection**: <https://postman.com/merchant-integrations/wolt-marketplace-integrations>.
- An **integration-partner catalog** exists for merchants who prefer an existing MWP.

**Why report import stays the near-term approach**: integrating Aquarela's system **directly** with Wolt
would require **Wolt partner onboarding** (form → test credentials → sandbox → pilot venue) **and a
merchant (Aquarela) willing to use the integration**. Absent both, `DEC-040` keeps **Wolt report import**
as the near-term approach; a direct Wolt connector remains subject to that partner arrangement.

## 5. Foodora

- Foodora is **not used today**; confirm whether it is used at all. If it is, it follows the same model
  as Wolt — reports handled by the accountant today and supplied **directly** to the system for
  channel-level sales.
- Frontline offers a **Foodora integration capability** (per the Frontline blog post) but Aquarela does
  not use it; Foodora order data is **not stored in the POS**.
- Do not assume a separate Foodora API is available in Phase 0; a direct connector would be a future
  step subject to partner onboarding.

## 6. Open items — to verify with vendor

- Frontline: API access, docs, sandbox, base URL, auth, rate limits, tenant ID, report columns, item
  identifiers, the Excel import/export template, sales lines with SKU and applied VAT, variants/add-ons
  and native options/variants, Wolt/Foodora integration capability (context only — not relied on), data
  retention, write API.
- Wolt: partner onboarding, credential ownership, sandbox, exact Order/Menu API scopes and terms, and
  what the merchant portal exports today (reports supplied directly now).
- Foodora: whether it is used at all, and any direct integration options.

All of the above is **to verify with vendor**; nothing in this note should be treated as a confirmed
interface until the vendor responds.
