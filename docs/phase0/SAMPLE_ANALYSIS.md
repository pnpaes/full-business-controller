# Sample analysis — Frontline POS exports (2026-09-18)

Status: **analysis of the first real samples received** for input I1 (`SOURCE_DATA_REQUEST.md`).
Files profiled on **2026-09-18** from `samples/`. Findings here are facts about the files, not a
confirmed vendor contract; anything marked *to confirm* still needs Frontline.

## 1. Files received

| File | Type | Contains data? |
| --- | --- | --- |
| `vareliste_AQUARELAASNy (2).csv` | Frontline POS **item list** (vareliste) | **Yes** — header + 73 data rows |
| `dagsrapport_1789713863_28682.pdf` | Daily report (dagsrapport) | **No** — empty PDF, no data rows |
| `manedsrapport_1789713844_28682.pdf` | Monthly report (månedsrapport) | **No** — empty PDF, no data rows |

So I1 is **partially received (2026-09-18)**: the item list arrived with usable data; the two
reports arrived but carry no data.

## 2. Product list (vareliste) format

- **Encoding:** UTF-8 **with BOM**.
- **Delimiter:** semicolon `;`.
- **Decimal separator:** comma (Norwegian/NB locale); thousands as needed.
- **Quoting:** fields quoted with `"` only when they contain spaces or punctuation (e.g.
  `"Oat Milk"`, `"Açaí Toppings"`); unquoted otherwise.
- **Header columns (13):**
  `varenummer;navn;text1;text2;innkjoepspris;lagerbeholdning;deaktivert;mva_kode;varegruppe;leverandoer;mva_prosent;pris_eks_mva;pris_inkl_mva`
  (item number; name; text fields; purchase cost; stock on hand; deactivated; VAT code; item group;
  supplier; VAT percent; price excl. VAT; price incl. VAT).
- **73 data rows.** Item numbers use category prefixes: `1000…` Açaí, `1100…` Beverages,
  `1200…` Books, `1300…` Cakes, `1400…` Coffee AddOns, `1500…` Coffees, `1600…` Meals,
  `1700…` Packaged Foods, `1800…` Savoury Snacks, `1900…` Sweets.
- The file is a **sellable product/add-on catalogue**, not ingredients or stock items — consistent
  with the **Item-vs-Product split (DEC-030)**: these rows are `ProductVariant`s, and the file carries
  **no** `Item` cost or stock.

### Column → target-model mapping

| CSV column | Meaning | Target |
| --- | --- | --- |
| `varenummer` | Item number — the **only stable external identity** | `ExternalMapping.external_id` (source = Frontline POS, entity = product); copied to `ProductVariant.code` for traceability |
| `navn` | Display name | `ProductVariant.name` (never an identity — names collide) |
| `text1` / `text2` | Free-text fields (empty in this export) | `ProductVariant` description/notes, if populated |
| `deaktivert` | `0` active / `1` deactivated | `ProductVariant` active status (`active_from`/`active_to` or status) |
| `mva_kode` | POS VAT code | Resolves to a `TaxRule` per item via the mapping in §3; stored on the mapped `ProductVariant`/sales line as `tax_code_id` |
| `varegruppe` | POS item group | Commercial grouping → `Product` category (Açaí, Coffee AddOns, …); `"Açaí Toppings"` is a group, so keep the raw group for fidelity |
| `pris_eks_mva` | Price excl. VAT | Derived net price; **not authoritative** (carries float artefacts) |
| `pris_inkl_mva` | Price incl. VAT | **Authoritative gross price** → initial `PriceVersion` gross price, parsed and rounded to øre |

Columns **not** mapped: `innkjoepspris` (purchase cost) and `lagerbeholdning` (stock) are **empty
(`0`) for every row**, and `leverandoer` (supplier) is empty; `mva_prosent` is redundant with
`mva_kode`. This export therefore carries **no cost and no stock data** — those must come from other
sources (supplier invoices/price lists, stock counts).

## 3. VOCABULARY / VAT mapping

- `mva_kode` observed: **`3` → 25 %, `31` → 15 %, `5` → 0 %** (e.g. the book `Lysløypa` at 0 %).
- **Named vs numeric VAT codes.** The Frontline Product Setup **UI shows names** — e.g. **"Utgående
  mva, høy sats (25 %)"** and **"Utgående mva, middels sats (15 %)"** — while the **CSV export uses
  numeric `mva_kode`** (`3`/`31`/`5`). The mapping **3↔25 %, 31↔15 %, 5↔0 %** is **inferred** and must
  be **confirmed with Frontline** before it is treated as a vendor contract (see §10 and
  `FRONTLINE_PRODUCT_SETUP_NOTES.md`).
- **Tax is per item, not per category.** VAT is mixed *within* a `varegruppe` — Meals contain both
  15 % (`Minas`, `Naples`) and 25 % (`Quiche`, `Side Salad`, `Chicken pie`); Beverages contain both
  15 % (`Heave water`) and 25 % (the rest). Any category-level tax assumption would be wrong.
- Codes should map to effective-dated `TaxRule`s (DEC-003/DEC-022), not be hard-coded per import.
- **`varegruppe` is a controlled vocabulary we do not yet have explicitly**: the values observed are
  Açaí, Açaí Toppings, Beverages, Books, Cakes, Coffee AddOns, Coffees, Meals, Packaged Foods, Savoury
  Snacks, Sweets, Fallback. Treat as the POS commercial-group vocabulary to approve/import as `Product`
  categories.

## 4. Data-quality observations

- **Fallback row — row 1:** `varenummer=1`, name `"Wolt item"`, `deaktivert=1`, `varegruppe=Fallback`,
  cost/stock `0`, price `0`. Evidently a real fallback product used for **unmapped Wolt/Delivery lines**
  (relates to DEC-033 unmapped-line handling and DEC-040 Wolt-as-report). Importer should map unmapped
  external lines to this fallback and flag them for review, never drop them silently.
- **Decimal artefacts:** 15 % items are exported with float noise —
  `Minas`: `pris_eks_mva=129,5652173913`, `pris_inkl_mva=148,99999999999`. Parse Norwegian decimals,
  **round to øre**, and treat the **incl-VAT price as authoritative**; derive excl-VAT from it with the
  item's VAT rate rather than trusting the exported excl-VAT string.
- **Duplicates / near-duplicates by name** (why external identity must be `varenummer`):
  - `"Oat Milk"` exists twice — `140000004` (Coffee AddOns) and `150000005` (Coffees).
  - `"Cheesecake"` (`130000005`) and `"Cheese Cake"` (`130000001`) are different items.
  - `"Decaff"` (`140000005`) is an add-on with price `0` — a zero-price sellable, not necessarily an error.
- **Mis-categorised item:** `"Pastel de Nata"` (`150000009`) sits in the **Coffees** group, not Cakes.
  Category is a POS-maintained value; do not infer it from the name.
- **Add-ons priced as products:** many `Coffee AddOns` have their own prices (`Cream`, syrups) while
  `Decaff` is `0` — model as `ProductVariant`s; whether they are modifiers vs standalone is a menu-design
  question for the owner, not something the export tells us.
- **No supplier/cost/stock data** in this export (see §2), so it cannot seed `Item` costs or
  opening stock.

## 5. Daily/monthly reports (the PDFs)

- Both `dagsrapport_*.pdf` and `manedsrapport_*.pdf` open as **0-page documents** and contain only
  embedded **font programs** and font-licence boilerplate — **no report labels, columns or data rows**.
- **Layout now known (2026-09-18):** although these PDFs carry no data, the **monthly report's**
  sections and columns have since been received as **screenshots** — documented in **§6** below. The
  **daily report's** exact columns are still to confirm.
- They confirm the reports are, at least in this instance, **PDF-only human documents**.
- **Consequence: PDFs are not an import format.** Daily/monthly sales must come from **Excel/CSV
  exports or the Frontline API** (`Butikkdata`). Do not build a PDF parser; ask for the data-bearing
  format instead (see §8).

## 6. Monthly report layout (from screenshots, 2026-09-18)

The **layout of the monthly report is now known** from two screenshots of a real report —
`schemas/mnd-report-pg1.png` and `schemas/mnd-report-pg2.png` — titled **"Manedsrapport 08/2026"**,
chain **"AQUARELA AS (Ny)"**. The screenshots show a populated layout (all amounts `0,00` in this
instance), so they confirm the fixed sections and columns the report prints even though the received
`manedsrapport_*.pdf` was still an empty 0-page file (§5). Numbers use **Norwegian formatting**
(space thousands separator, comma decimal, 2 decimals).

**Page 1**

| Section | Columns | Notes |
| --- | --- | --- |
| **BETALINGSTYPER** (payment types) | `Type \| Registrert` | rows Kontant, Bankkort, Gavekort, Tilgodelapp, Faktura, Kundekort + `Totalt` |
| **VAREGRUPPESALG** (item-group sales) | `Navn \| Omsetning` | one row per item group + `Totalt` |
| **TIMESALG** (hourly sales) | `Time \| Kunder \| Varelinjer \| Omsetning` | hour, customers, item lines, turnover + `Totalt` |

**Page 2**

| Section | Columns | Notes |
| --- | --- | --- |
| **MVA OMSETNING** (VAT turnover) | `Type \| Omsetning \| Herav MVA \| Varelinjer` | VAT type, turnover, of which VAT, item lines |
| **DIVERSE** (miscellaneous) | `Type \| Antall \| Beløp` | Returnerte varer (returned goods), Rabatt (discount), Snitt oms pr aktive time (average turnover per active hour), Åpne skuff (open drawer), **Øreavrunding** (øre rounding) |
| **OMSETNING PR KASSERER** (turnover per cashier) | `Navn \| Kunder \| Omsetning \| Snittsal` | name, customers, turnover, average sale |
| **KONTANTUTTAK** (cash withdrawal) | `Ansatt \| Sum \| Tidspunkt \| Årsak` | prints "Ingen kontantuttak" when empty |
| **KONTANTINNSKUDD** (cash deposit) | `Ansatt \| Sum \| Tidspunkt \| Årsak` | prints "Ingen kontantinnskudd" when empty |

### Key observations

- The report is **aggregate**: payment type, item group, hour, VAT type, cashier and cash movements.
  It is **not item-level**, so **theoretical consumption cannot be built from it** — an **item-level
  (per `varenummer`) sales detail export** is still required.
- **MVA OMSETNING** confirms sales are grouped by VAT type with the VAT portion (`Herav MVA`) and line
  counts; this maps directly to `sales_line.tax_code`/`tax_amount` and the DEC-003 rate split.
- **Øreavrunding** in DIVERSE confirms cash **øre rounding** is tracked by the POS (relevant to DEC-024).
- Payment types (Kontant/Bankkort/Gavekort/Tilgodelapp/Faktura/Kundekort) map to settlement/reconciliation
  methods for REC-001/REC-002.
- The report was delivered as a **PDF in this instance**; a **machine-readable (Excel/CSV/API)** version
  is required for imports.

### Implications for the importer

The sales import must be able to carry, at minimum:

- **payment-type totals** (for settlement reconciliation, REC-002);
- **VAT-type turnover with the VAT portion (`Herav MVA`) and line counts** (DEC-003 mapping);
- **item-group revenue**;
- an **hourly breakdown** (hour, customers, item lines, turnover);
- **returns and discounts** (DIVERSE `Returnerte varer`, `Rabatt`);
- **`Øreavrunding`** (cash øre rounding, DEC-024);
- **cashier turnover** and **cash-movement** information (KONTANTUTTAK/KONTANTINNSKUDD).

An **item-level sales export** (per `varenummer`, with quantity and net/tax/gross amounts) is still
**required** for theoretical consumption; the aggregate monthly/daily reports alone cannot satisfy it.
This is recorded as **SALE-008**.

### Known gap — no item-level sales in the standard Frontline report

**Confirmed by the owner (2026-09-18):** the standard Frontline **monthly and daily reports do not
contain item-level (product-line) sales detail.** They are **aggregate only** — payment type,
item group (`VAREGRUPPESALG`), hour, VAT type, cashier and cash movements (§6). No per-`varenummer`
turnover or quantity is printed.

Consequences:

- Item-level detail must come from a **dedicated per-item sales report** or from the **Frontline
  `API Butikkdata`** (sales lines), neither of which is confirmed present yet.
- If neither exists, **theoretical consumption can only be computed at item-group / category
  granularity** — a known limitation, not a temporary gap.
- This directly limits the **precision of theoretical-vs-actual consumption (DEC-009)**: at category
  granularity, per-product variance is invisible, so count- and production-based figures carry the
  precision instead.
- Tracked as **I1** (request for a per-item report or API sales-line confirmation) and **R-01**
  (`PHASE0_CLOSEOUT_PLAN.md §8`) — see also **SALE-008**.

**Reference input (offered 2026-09-18):** the owner can supply an export from the **existing/legacy
system (Zettle / PayPal)** purely as a **reference** for **what an item-level sales export looks
like** — its product/variant, quantity, net/tax/gross and payment-type columns, and its column
headers. This is **reference-only and not authoritative data** for this project (recorded as **I19**
in `SOURCE_DATA_REQUEST.md`); it is used to shape the importer/report design and to sanity-check the
columns we expect from Frontline.

## 7. Implications for the importer (all sources)

- Build a **Frontline item-list (vareliste) CSV profile**: semicolon delimiter, UTF-8 **BOM**
  handling, quoted-field support, **comma decimals**, per-item `mva_kode` → `TaxRule` resolution.
- Land rows as **`ProductVariant`s** with an **`ExternalMapping`** keyed on `varenummer`; set the
  commercial group as `Product` category. **`Item` cost/stock is not in this file** and must not be
  inferred from it.
- **Parse → normalize → round to øre**, incl-VAT price authoritative; source-total checks per §6.5 of
  `06_API_INTEGRATIONS.md`. Preserve raw `varenummer`/`varegruppe` and row numbers for provenance.
- Handle the **`Fallback`/"Wolt item"** row explicitly: unmapped external lines map to it with a
  `mapping_state` that forces **review** (DEC-033), and are never silently dropped or remapped once
  posted.
- **Separate import profiles**: item/product list (this file) vs daily/monthly sales (not yet
  received in a usable format) vs Wolt payout/line reports (DEC-040).
- **Idempotency**: dedupe on `(source, varenummer)`; conflict → flag per DEC-033.
- Do **not** treat `varegruppe` or `navn` as identity — only `varenummer`.

## 8. Open questions for Frontline

1. Can the **daily (dagsrapport)** and **monthly (månedsrapport)** reports be exported as **Excel/CSV
   with data** (not a 0-page PDF)? Which button/endpoint produces it?
2. Can we get a **data-bearing daily report sample** so we can confirm the real columns (date,
   location, channel, product, quantity, gross/net/VAT, payment method)?
3. Which **standard reports export to Excel/CSV**, and is there a **column/schema reference**?
4. **`API Butikkdata`**: what are the **endpoints**, the **base URL**, the **auth model**, the
   **rate limits**, any **per-deployment tenant identifier**, and is there a **sandbox/test
   environment** we can use before go-live?
5. Does the **`vareliste` export always carry the same 13 columns**, and can **cost (`innkjoepspris`)
   and stock (`lagerbeholdning`)** be included in some other export or the API?
6. Is `varaenummer` the **stable, immutable** external product identifier across catalogue changes
   (renames, re-groups, deactivation)?
7. What is the authoritative definition of the **`varegruppe` list** and the **`mva_kode` codes**
   (`3`/`31`/`5` → 25/15/0 %), and are there other codes we should expect?
8. How are **unmapped delivery-platform (Wolt) lines** represented — is `"Wolt item"`
   (`varenummer=1`, `Fallback`) always the target?
9. Does the API/export expose **sales by channel** (in-store vs Wolt/Foodora) and **payments**, for
   daily/monthly close and reconciliation?

## 9. Legacy Zettle/PayPal item-level sales export (reference only, received 2026-09-18)

**Purpose.** The owner supplied a legacy item-level sales export from the **previous Zettle/PayPal
POS** as a **reference only** (recorded as **I19** in `SOURCE_DATA_REQUEST.md`). It is used for two
things: (a) to define the **shape of the item-level sales importer** (SALE-008) — the fields a real
item-level export carries and how they map to `sales_transaction`/`sales_line`; and (b) as an
**optional seasonality baseline** for forecasting (I11). It is **explicitly not authoritative** for
this project and must not be loaded as production data; the Frontline equivalent is still required
(**I1**).

**File.** `schemas/PayPal-POS-Raw-Data-Report-20260801-20260831.xlsx` (sheet "Detaljert
salgsrapport"), covering **2026-08-01 → 2026-08-31**.

### 9.1 Shape and volume

- **1 sheet**, **3,864 rows**: row 1 title, row 2 period ("Periode 2026-08-01 - 2026-08-31"),
  row 3 header, then **3,861 line rows**.
- **16 columns** (header): `Dato; Tid; Medarbeidere; Kvitteringsnummer; Navn; Variant; Enhet; Antall;
  Pris (NOK); Rabatt (NOK); Sluttpris (NOK); SKU; Strekkode; Innkjøpspris; Kommentar; Stedsnavn`.
- **1,734 distinct receipts**; **27 trading days**; ~**143 line rows/day**.
- **87 distinct product names**; **73 distinct variants**.
- **Gross August total 356,296.30 NOK** (reference figure, **not authoritative**): Kongens Gate
  296,915.25; Tullinløkka 59,381.05. Locations: **Aquarela Kongens Gate** 3,195 lines, **Aquarela
  Tullinløkka** 666 lines.

### 9.2 Column → target-model mapping

| Legacy column | Meaning | Target |
| --- | --- | --- |
| `Dato` + `Tid` | Excel **serial date + time** | `sales_transaction.occurred_at` (combine, convert UTC) |
| `Medarbeidere` | Staff/operator (only `Paulo Nicioli Paes` appears) | `sales_transaction` staff/operator reference |
| `Kvitteringsnummer` | Receipt number | `sales_transaction.receipt_number`; external identity for idempotency |
| `Navn` | Product name (free text; trailing spaces) | `sales_line` product reference, resolved via mapping — **not** an identity |
| `Variant` | Composite modifier string | `sales_line` modifier/option selection (§9.4) |
| `Enhet` | Unit (**empty**) | unit reference (absent; derive from product) |
| `Antall` | Quantity (negative on refunds) | `sales_line.quantity` |
| `Pris (NOK)` | Gross unit price (VAT-inclusive) | `sales_line.unit_price` (`taxBasis: inclusive`) |
| `Rabatt (NOK)` | Line discount | `sales_line.discount` |
| `Sluttpris (NOK)` | Line total (gross, after discount) | `sales_line.line_total` |
| `SKU` | SKU (**all empty**) | external product identity — **unusable here** |
| `Strekkode` | Barcode (**all empty**) | external product identity — **unusable here** |
| `Innkjøpspris` | Purchase cost (**all `0`**) | item cost — **not usable**; costs come from other sources |
| `Kommentar` | Free-text comment | `sales_line.note` |
| `Stedsnavn` | Location name | `sales_transaction.location` (resolve to `Location`) |

### 9.3 Channel — the " T" takeaway convention

**There is no channel column.** Takeaway is encoded as a **`" T"` suffix on the product name**
(e.g. `"Cheese bun T"`, `"Açaí T"`, `"Cake Slice T"`, `"Ice Latte T"`): **951 line rows (24.6 %)**,
gross **86,607.70 NOK**. **Channel must be derived** from the name suffix (and, for Frontline, from
whatever field the new POS provides — **to ask**).

### 9.4 Variants are composite modifier strings

Variants are **free-text composites**, not structured options: shot strength (`Singel`/`Dobbel`),
`No salad`, `Normal`, sizes (`Classic, Medium`, `Fruity, Small`), flavours (`Pistachio crush`,
`Basque cheese cake`, `Chocolate and Dulce de Leche`) and **combinations**
(`Dulce de Leche, Dobbel`). The target model should represent these as **structured modifier/option
selections** on the line, not as one opaque string.

### 9.5 Discounts and refunds

- **Discounts:** 165 rows, total **−4,384.70 NOK**.
- **Refunds:** 3 **negative-quantity** rows.
- Both must be carried through as line-level discount/return facts, not netted away silently.

### 9.6 Data quality

- **Empty columns:** `SKU` and `Strekkode` (all empty), `Innkjøpspris` (all `0`), `Enhet` (empty).
  **12 rows have a blank product name.**
- Only **one employee** appears (`Paulo Nicioli Paes`).
- **No payment-method column** — payment/settlement facts come from **separate reports**
  (REC-001/REC-002).
- **No category column** — map category via Frontline **`varegruppe`** once the authoritative export
  lands.
- **Dates/times are Excel serial numbers** (e.g. `46235.41822306713`), not strings.
- **Prices are gross (VAT-inclusive).**
- Product names carry **trailing spaces**; modifiers are **free text** rather than structured options.

### 9.7 Implications

- **This defines the item-level import shape (SALE-008).** The target importer must carry every one
  of these fields; it is the concrete reference for the fields demanded of Frontline.
- **Channel is derived, not supplied.** Legacy uses the `" T"` name suffix; Frontline's channel
  encoding is **still to be asked** (I1).
- **No payment method** in the item-level export — settlement/reconciliation (REC-001/REC-002) must
  use the **settlement reports**, not this file.
- **No category** — map category via Frontline **`varegruppe`** (the controlled vocabulary in §3).
- **Variants should become structured modifier/option records**, not free-text composites, so
  per-modifier consumption and pricing are possible.
- **Legacy history is optional for forecasting (I11)** and, if used, must be **labelled legacy**
  (never authoritative, never mixed silently with Frontline facts).

## 10. Frontline product setup (2026-09-18)

Source: screenshots of a real Frontline **Product Setup** screen (`schemas/Product Setup/01.png`–`06.png`),
reviewed **2026-09-18** and recorded in **`FRONTLINE_PRODUCT_SETUP_NOTES.md`**. This is UI/configuration
evidence about *how a product is modelled in Frontline*, not a sales export; it does not change the
file facts in §§1–4.

### 10.1 Product tabs

A Frontline product carries several tabs: **Generell** (general), **Detaljer** (details), **Lager**
(stock), **Restaurant**, **Farge og størrelse** (colour and size) and **Tags**.

### 10.2 Detaljer — default *and* alternative price/VAT on one product

The **Detaljer** tab exposes **two price/VAT sets on the same product**:

- a **default** price/VAT (25 %), and
- an **alternative** price/VAT, gated by **`Alternativ pris tilgjengelig`**, with **`Alternativ MVA`**
  shown as **"Utgående mva, middels sats (15 %)"** and a separate **`Alternativ pris inkl. MVA`**.

This is the POS mechanism behind **eat-in vs takeaway**: the **same product** is charged **25 % dine-in
and 15 % takeaway** with no separate `" T"` product (DEC-042/DEC-045). **Consequence for the export:** the
import cannot assume which price/VAT was used — the export **must be checked for the _applied_ rate and the
_applied_ price per line**, and if it does not carry them they cannot be reconstructed.

### 10.3 Restaurant — attached extras (`Ekstravalg`)

The **Restaurant** tab carries **`Ekstravalg`** (attached extras) with an **`Automatisk ekstravalg pop-up`**
(auto add-on pop-up). Each extra is an **existing product with its own price**, so an add-on is both a
standalone sellable **and** attachable to a parent. The açaí extras list includes the **toppings** plus the
current **`Medium Bowl 20` / `Large Bowl 40`** size upgrades. This is the POS side of DEC-043 and maps to
`addon_applicability`; the export must show whether an extra arrives as a **separate line** or **attached**
(`option_kind` / `parent_line_id`).

### 10.4 Farge og størrelse — variants as separate item numbers

The **Farge og størrelse** tab groups **separate item numbers** as **colour/size variants**. Because
**prices are set on the item number**, variants can carry **their own prices**; the **original item must
also be listed as a variant item number**, and **colour and size may both be required**. The export must
therefore carry the **variant item numbers** (each an `ExternalMapping`), not just a parent item.

### 10.5 Frontline's own `Kalkyle` and `Svinnverdi`

Frontline also has its own **`Kalkyle`** (recipe) and **`Svinnverdi`** (waste value) fields. These are
**not** the business controller's costing model and must not be imported as `recipe`/`waste_event` facts;
treat them as POS-side display values unless a reconciliation need is confirmed.

### 10.6 Implications for the target model

The target model **already covers these mechanisms**, so no new shape is required:

- **Channel-specific price and VAT** — a **`PriceVersion`** (already scoped by `channel_id`) plus a
  **channel-overridable `TaxRule`** (`tax_treatment = channel_overridable`, DEC-045) with the applied rate
  stored on the line as `sales_line.applied_tax_rate`; this is exactly the default (25 %) vs alternative
  (15 %) case.
- **Attached add-ons** — **`addon_applicability`** links an add-on `product` to the base products it may be
  added to; sales lines normalise attached vs standalone via `option_kind`/`parent_line_id`.
- **SKU-per-line imports** — variants and extras are distinct products with their own SKUs (DEC-041/044),
  and import matches on **SKU first** with `ExternalMapping` fallback.

Each of these must still be **confirmed against a real Frontline export** (which price/VAT and which
item numbers the export actually carries) — the screenshots show what the POS *can* store, not what the
export *emits*.
