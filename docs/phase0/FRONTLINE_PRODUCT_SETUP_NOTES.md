# Frontline POS product-setup notes (2026-09-18)

Status: **research notes from the Frontline backoffice — to verify with vendor.** Everything below
comes from screenshots of the Frontline POS product-setup form (`schemas/Product Setup/01.png`–
`06.png`) using the açaí sample product **"Strawberry Delight", `varenummer` 100000002**. This is the
product master data behind the item list profiled in `SAMPLE_ANALYSIS.md`, and it sharpens the POS
questions in `POS_WOLT_NOTES.md` and the decisions `DEC-042`/`DEC-043`/`DEC-044`/`DEC-045`/`DEC-046`.
Nothing here is a confirmed interface until Frontline answers the open questions (§5).

## 1. Product-setup tabs

The product form has six tabs: **Generell, Detaljer, Lager, Restaurant, Farge og størrelse, Tags**.
Labels are Norwegian; English gloss in parentheses.

### 1.1 Generell (General)

| Field | Notes |
| --- | --- |
| Varenummer (item number) | e.g. `100000002`; the stable POS identity (matches the export's `varenummer`, DEC-041). |
| Strekkode (barcode) | Empty for the sample; there is an add (`+`) button. |
| Navn (name) | Required (`*`); e.g. "Strawberry Delight". |
| Varegruppe (item group) | Dropdown, e.g. `Açaí`; the export's `varegruppe`. |
| Innkjøpspris (purchase/cost price) | `0` in the sample — cost is not the POS's job. |
| Kalkyle (recipe/calculation) | Empty; Frontline's own recipe/costing field. |
| Pris eks. MVA (price excl. VAT) | `103.2`. |
| MVA-kode (VAT code) | Named code dropdown, shown as **"Utgående mva, høy sats (25 %)"** — not the numeric code seen in the export (`mva_kode` 3/31/5). |
| Pris inkl. MVA (price incl. VAT) | `129`. |
| Leverandør (supplier) | `Ingen` (none). |
| Tilgjengelig i ekstern webshop (available in external webshop) | Checkbox. |
| Actions | `Lagre endringer` (save), `Deaktiver` (deactivate). |

### 1.2 Detaljer (Details)

| Field | Notes |
| --- | --- |
| Artikkel/modell/katalog-nummer (article/model/catalogue number) | Empty. |
| **Alternativ pris tilgjengelig** (alternative price available) | Checkbox; **checked** in the sample. |
| **Alternativ MVA** (alternative VAT) | Named code **"Utgående mva, middels sats (15 %)"**. |
| **Alternativ pris inkl. MVA** (alternative price incl. VAT) | `129`. |
| Ekskluder fra rabatter (exclude from discounts) | Checkbox. |
| Åpen pris (open price) | Checkbox. |
| Antall/Volum/vekt (quantity/volume/weight) | Unit shown as `L/Kg`. |
| **Svinnverdi** (waste value) | In `Kr`; Frontline's own waste/shrinkage value field. |
| Emballasjevekt i gram (packaging weight in grams) | Empty. |
| Rabatt (%) (discount) | Empty. |
| Veil. pris (recommended/retail price) | Empty. |
| Tjeneste (service) + Varighet tjeneste (service duration) | Duration `5`. |
| Tilgjengelig i avdeling (available in department) | `Department 1` and `Department 2` checkboxes. |
| Beskrivelse (description) | Empty. |
| Menyoppsett (menu setup) | `Velg vare` (choose item). |
| **Følgevarer** (follow/combo items) | Checkbox + `Legg til ny følgevare` (add new follow item). |

### 1.3 Lager (Stock)

| Field | Notes |
| --- | --- |
| Benevnelse (unit designation) | `Stk` (each). |
| Forpakning (packaging) | Empty. |
| Ekskluder fra lagerfunksjoner (exclude from stock functions) | Checkbox. |

### 1.4 Restaurant

| Field | Notes |
| --- | --- |
| Kjøkkenskriver (kitchen printer) | Dropdown, `Kjøkkenskriver`. |
| Små navn (vis i kjøkkenskriveren) (short name, shown on kitchen printer) | Empty. |
| Vare med separat kjøkkenprint (item with separate kitchen print) | Checkbox. |
| **Automatisk ekstravalg pop-up** (automatic extras pop-up) | Checkbox; **checked** in the sample. |
| **Ekstravalg** (extras/add-ons) | Attached via `Velg vare` (choose item) or free text + `Legg til` (add). Each entry is an existing product with its own price and can be removed (`×`). For the açaí sample the list is toppings at **10–15 Kr** plus the size upgrades **"Medium Bowl (20 Kr)"** and **"Large Bowl (40 Kr)"**. |
| Actions | `Lagre endringer` (save), `Deaktiver` (deactivate). |

### 1.5 Farge og størrelse (Colour and size)

Instruction text (Norwegian), paraphrased:

- If an item is registered with `53` in stock, the registered stock is shown as `"Ant…"`.
- To increase stock by 10, write `"10"` in the stock field.
- If quantity in stock, colour and size are set but the item number is empty, an item is created.
- **Both colour and size must be set to save an item.**
- **To turn a single item into a colour/size item, the original item's item number must also be added
  as one of the item numbers in the colour/size form.**

Controls: `Aktiver alle` / `Deaktiver alle` (activate/deactivate all), a table with columns
**Farge/Størrelse | Størrelse**, and per-row fields **Varenummer, Strekkode, Antall, Deaktiver**.
Buttons `Ny Størrelse` (new size) and `Ny Farge` (new colour). Instructions state that **prices for
colour/size are set with the item number (`varenummer`)**.

### 1.6 Tags

Only the save (`Lagre endringer`) and deactivate (`Deaktiver`) actions are visible; no tag fields in
the screenshot.

## 2. Interpretations

1. **Same-product dine-in / takeaway.** The Detaljer tab's **"Alternativ pris tilgjengelig" +
   "Alternativ MVA" (15 %) + "Alternativ pris inkl. MVA"** mechanism confirms one product can carry a
   default 25 % price/VAT and an alternative 15 % price/VAT. This is how eat-in vs takeaway is
   handled (DEC-042, DEC-045), replacing the legacy Zettle `" T"` suffix. **To confirm:** that the
   export shows the **applied** rate/price (default vs alternative), not just the default
   (`POS_WOLT_NOTES.md` §3, question 9).
2. **Ekstravalg = attached add-ons.** Add-ons (toppings, syrup, extra shot, and currently the
   bowl-size upgrades) are attached to a base product via the **Restaurant** tab, with an automatic
   pop-up. Each add-on is its own product with its own price. So add-ons can be **attached in the POS
   while still being separate products** — this refines DEC-043 (import must support both standalone
   add-on lines and attached parent/child lines).
3. **Farge og størrelse = variants by linked item numbers.** Sizes/variants are **separate item
   numbers grouped under a parent**, and **their prices are set on the item number itself**, so
   variants can effectively have their own prices even though the grid does not edit price. Caveats:
   the original item number must be included as one of the variant item numbers; both colour and size
   may be required to save; and stock behaviour needs testing. This is the native-variant mechanism
   behind DEC-046's preference.
4. **Frontline has its own Kalkyle (recipe) and Svinnverdi (waste value).** The business controller
   platform is the costing source of truth (DEC-002/DEC-021), so we will decide whether to populate
   Frontline's kalkyle. **Recommended: no** — keep costing central and treat Frontline's kalkyle and
   svinnverdi as POS-local fields we do not rely on.

## 3. Recommended pattern — 2D variant matrix (flavour × size)

Agreed pattern (2026-09-18): use Frontline's **"Farge og størrelse"** as a **2D variant matrix** for açaí.

- Dimension **Farge** (colour) = **flavour** — Classic, Strawberry Delight, Brazilian Crunch, … .
- Dimension **Størrelse** (size) = **size** — Small / Medium / Large.
- **Each combination is its own item number** with its own **Navn/description, price, MVA** (including
  the takeaway **"Alternativ pris / Alternativ MVA"**), **Varegruppe `Açaí`**, and **platform-owned SKU**.
- The colour/size entries reference each combination's **`varenummer`**, and the price/description live
  on that item number — so the owner's plan (an Açaí base product, staff pick the size, and each
  size-per-flavour product references its `varenummer`) is **correct**.
- **Product count = flavours × sizes** (e.g. 6 flavours × 3 sizes = **18 variant items**) **plus the
  grouping product**. The platform generates and publishes the SKU/`varenummer` catalogue (DEC-044,
  DEC-041); Frontline does not invent the SKUs.

Caveats / to confirm with Frontline (see `POS_WOLT_NOTES.md`):

1. Must the **original/grouping item number** also be listed as one of the **variant item numbers**, and
   can it be **deactivated** so it is not sold?
2. Must **"Alternativ pris / Alternativ MVA"** be set **per variant item**, or does it inherit from the
   parent? (Relevant to dine-in 25 % vs takeaway 15 %; DEC-042/DEC-045.)
3. Does a **variant sale export the variant's `varenummer`** (rather than the parent's)?
4. What is the **stock behaviour** across variant items? For made-to-order bowls consider
   **"Ekskluder fra lagerfunksjoner"** unless finished-goods tracking is actually wanted.

Trade-off: modelling the size as an **`Ekstravalg` size upgrade** (Medium Bowl +20, Large Bowl +40) would
cut the product count but breaks true per-size price/margin and size-mix reporting, so the **matrix (or
plain separate SKUs) is preferred**; `Ekstravalg` stays for genuinely additive items (toppings, syrup,
extra shot). See DEC-044/DEC-046.

### Base/group product — is a separate row needed?

**No.** The generated import (`frontline_item_import_acai_template_2026-09-18.xlsx`) contains **only
the 21 variant rows** (7 flavours × 3 sizes), all with `Varenavn = Açaí`; there is **no separate
base/group row**.

- Frontline's own instruction says that to convert a single item into a colour/size item, the
  **original item number must also be listed as one of the item numbers in the colour/size form**
  (§1.5) — so the base/original *is* one of the variant entries, not a distinct SKU. One of the 21
  (e.g. `Açaí Classic – Small`) serves as the original; the other 20 are added to it in the
  **Farge og størrelse** grid.
- Adding a separate base row (blank Farge/Størrelse, price 0) risks a **zero-price sellable item or a
  duplicate**, and is not required.
- Two paths: (a) **test-import 2–3 rows** to see whether Frontline auto-groups by `Varenavn` or
  requires manual grouping via one item's **Farge og størrelse** tab; (b) if a dedicated group row is
  required, **add one** (non-sellable/zero-price) or switch to **per-flavour parents**.

### Included toppings vs paid extras (owner pattern, 2026-09-18)

- For each açaí flavour the base product **pre-selects the 3 toppings used in that flavour as
  pre-selected extras** (so consumption/stock can be related later), but they carry **0 kr**: the base
  flavour price is **base-only**. Paid extras are **additional** toppings with prices. This replaces the
  earlier setup where the topping prices were added to the base product price.
- **Catch to test with Frontline:** if the same topping is both an **included default (0 kr)** and a
  **paid extra (priced)**, one item/SKU cannot hold both prices. Either create **distinct items/SKUs**
  (e.g. `"Granola"` 0 kr included vs `"Extra Granola"` priced), or confirm Frontline can **pre-select an
  extra without adding its price**.
- The included zero-price lines must still be **captured in sales exports** so theoretical consumption
  includes them; they carry **no revenue/VAT**.
- The **per-flavour included-topping mapping is operational data still to be supplied** by the owner.

## 4. Implications for our model

- **Product taxonomy (DEC-044).** The form confirms Frontline treats base products, colour/size
  variants and ekstravalg add-ons as products with their own `varenummer`, consistent with
  `product_kind` ∈ {`base`, `variant`, `add_on`} in `DATA_DICTIONARY.md` (`product` table).
- **Native variants (DEC-046).** Because "Farge og størrelse" groups separate item numbers under a
  parent and prices live on the item number, sizes (and colours) can be native variants with their own
  prices. Use that path if the mandatory-dimension and stock caveats are acceptable; otherwise model
  sizes as separate base SKUs.
- **Add-on applicability (DEC-043).** `addon_applicability` in the data dictionary (link add-on
  product → base products) is populated from the base product's Ekstravalg list; the platform can
  still own the catalogue and publish it to Frontline (Excel template now, API later; DEC-015).
- **Channel price/VAT (DEC-042/DEC-045).** The Detaljer tab is the per-item carrier of the alternative
  15 % price/VAT. Our per-line model already stores `applied_tax_rate` and channel
  (`sales_line.applied_tax_rate`, `channel_id`); the requirement on Frontline is that the export/API
  exposes the **applied** values.
- **Bowl-size upgrades.** The açaí sample currently models Medium/Large Bowl as ekstravalg. Per
  DEC-046 those should move to native variants (preferred) or separate base SKUs, leaving Ekstravalg
  for genuinely additive items.

## 5. Open questions

1. Does the Frontline export/API carry the **applied** VAT rate and price per line for the
   default-vs-alternative (dine-in vs takeaway) case, and in which column/field?
2. Do **attached ekstravalg** appear as their own export/API line, is the **parentage** visible
   (parent line id / option flag), and is the add-on price carried on its own line?
3. Does a **colour/size variant** sale emit the **variant's `varenummer`** (rather than the parent's)?
4. What is the mapping between the numeric **`mva_kode` (3 = 25 %, 31 = 15 %, 5 = 0 %)** in the item
   export and the **named VAT codes** shown in the form ("Utgående mva, høy/middels sats")? Is the
   mapping stable and can Frontline document the full VAT-code list?
5. What is the **stock behaviour for size variants** — is stock held on the parent or per variant item
   number, and how does Farge og størrelse affect stock movements and reporting?
6. Does the **Excel import/export template** round-trip colour/size variants and ekstravalg links
   (parent/child item numbers), so the platform-owned catalogue can be published (DEC-041/DEC-044)?

## 6. Cross-references

- `POS_WOLT_NOTES.md` — the Frontline questions to send (including the ones this note raises).
- `SOURCE_DATA_REQUEST.md` — the sample export requested to answer §5.
- `SAMPLE_ANALYSIS.md` — the received item export and the `mva_kode` observation.
- `12_OPEN_DECISIONS.md` — DEC-042/043/044/045/046, and the refinement notes appended to
  DEC-042/DEC-046 on 2026-09-18.
