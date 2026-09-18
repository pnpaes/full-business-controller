# Açaí variant matrix — generated reference files (2026-09-18)

These files implement the agreed açaí restructuring (DEC-044/046): the seven existing
açaí flavour items become the **Small** size of a **2D variant matrix** (Farge = flavour,
Størrelse = size), and every flavour × size combination becomes its **own item number**
with its own price, VAT and SKU.

The owner issued a **new per-flavour price list on 2026-09-18**; all three generated files
carry it (see [Pricing](#pricing-and-alternative-takeaway-vat)). The same pass renamed the
flavour `Dulce Cream` to **`Dulce Dream`**.

Source inputs:
- `samples/vareliste_AQUARELAASNy (2).csv` (semicolon-delimited, UTF-8 with BOM, decimal comma)
- `samples/import.products.example.xlsx` — Frontline's official product-import template
  (single data sheet `Sheet1`, 14 columns, header row 1)

No existing source/sample file was modified.

## Files

| File | Purpose | Status |
| --- | --- | --- |
| `frontline_item_import_acai_template_2026-09-18.xlsx` | **Primary import file.** Built in Frontline's official template format. `Sheet1`, template header, **21 rows** (7 flavours × 3 sizes). | Current |
| `acai_variant_matrix_2026-09-18.csv` | Reference/mapping sheet for all **21** combinations. Comma-delimited, UTF-8. Carries the template columns plus the source Varegruppe/VAT codes. | Current |
| `frontline_item_import_acai_2026-09-18.csv` | Older import draft mirroring the **export schema** (semicolon, BOM, decimal comma, 14 **new** Medium/Large items only). | **Superseded** — superseded by the template-format XLSX above; kept for history only. |
| `README.md` | This guide. | Current |

## Varenavn / Farge / Størrelse convention

The template models a variant product with a base name plus two variant dimensions
(its own example is `Genser` / `Rød` / `M` / `Klær` / `Gensergrossisten`). We mirror that:

- **`Varenavn` (B)** = `Açaí` on **every** row — the base product name, repeated on each variant row.
- **`Farge` (G)** = the flavour name exactly (`Classic`, `Strawberry Delight`, …). The
  template's "Farge" dimension carries our flavour.
- **`Størrelse` (H)** = `Small` / `Medium` / `Large`.
- **`Varegruppenavn` (I)** = `Açaí`; **`Leverandørnavn` (J)** = blank.
- The individual item's distinguishing `varenummer` is in **`Varenummer - EAN` (A)** and the
  SKU is in **`Artikel nr.` (N)**.

Rows are ordered by flavour (1–7, source order) then size Small → Medium → Large.
`Açaí` is written as correct UTF-8.

## Flavour renames

Two flavour renames are reflected in every generated file:

- **`Fruity S` → `Fruity`.** The SKU no longer double-encodes the size:
  `ACAI-FRUITY-S` / `ACAI-FRUITY-M` / `ACAI-FRUITY-L` (previously `ACAI-FRUITY-S-S` / `-M` / `-L`).
  Item numbers are unchanged (small 100000006, medium 100000030, large 100000037).
- **`Dulce Cream` → `Dulce Dream`** (owner, 2026-09-18). Its `Farge`, item names and SKUs all
  read `Dulce Dream`; the SKUs become `ACAI-DULCE-DREAM-S` / `-M` / `-L`. Item numbers are
  unchanged (small 100000005, medium 100000029, large 100000036).

## Numbering (numeric, continuing the 9-digit style)

| Flavour | Small (existing) | Medium | Large |
| --- | --- | --- | --- |
| Classic | 100000001 | 100000025 | 100000032 |
| Strawberry Delight | 100000002 | 100000026 | 100000033 |
| Brazilian Crunch | 100000003 | 100000027 | 100000034 |
| Berry Fresh | 100000004 | 100000028 | 100000035 |
| Dulce Dream | 100000005 | 100000029 | 100000036 |
| Fruity | 100000006 | 100000030 | 100000037 |
| BYO | 100000007 | 100000031 | 100000038 |

Existing non-açaí items run up to 100000024, so the new block starts at 100000025.
`100000008` (Medium Bowl) and `100000009` (Large Bowl) are not part of the matrix.

## Pricing and alternative takeaway VAT

Owner price list **2026-09-18** — prices are now **per flavour × size**. The owner gave the
three values as small / medium / large **incl-VAT** (`E`), and the ex-VAT and alternative
figures are derived:

| Flavour | Size | `D` Utsalgspris eks MVA | `E` Utsalgspris inkl MVA | `K` Alternativ pris eks MVA | `L` Alternativ pris inkl MVA | `F` MVA | `M` Alternativ MVA |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Classic | Small | 127.20 | 159 | 138.26 | 159 | 25 | 15 |
| Classic | Medium | 143.20 | 179 | 155.65 | 179 | 25 | 15 |
| Classic | Large | 159.20 | 199 | 173.04 | 199 | 25 | 15 |
| Strawberry Delight | Small | 131.20 | 164 | 142.61 | 164 | 25 | 15 |
| Strawberry Delight | Medium | 147.20 | 184 | 160.00 | 184 | 25 | 15 |
| Strawberry Delight | Large | 163.20 | 204 | 177.39 | 204 | 25 | 15 |
| Brazilian Crunch | Small | 127.20 | 159 | 138.26 | 159 | 25 | 15 |
| Brazilian Crunch | Medium | 143.20 | 179 | 155.65 | 179 | 25 | 15 |
| Brazilian Crunch | Large | 159.20 | 199 | 173.04 | 199 | 25 | 15 |
| Berry Fresh | Small | 135.20 | 169 | 146.96 | 169 | 25 | 15 |
| Berry Fresh | Medium | 151.20 | 189 | 164.35 | 189 | 25 | 15 |
| Berry Fresh | Large | 167.20 | 209 | 181.74 | 209 | 25 | 15 |
| Dulce Dream | Small | 127.20 | 159 | 138.26 | 159 | 25 | 15 |
| Dulce Dream | Medium | 143.20 | 179 | 155.65 | 179 | 25 | 15 |
| Dulce Dream | Large | 159.20 | 199 | 173.04 | 199 | 25 | 15 |
| Fruity | Small | 135.20 | 169 | 146.96 | 169 | 25 | 15 |
| Fruity | Medium | 151.20 | 189 | 164.35 | 189 | 25 | 15 |
| Fruity | Large | 167.20 | 209 | 181.74 | 209 | 25 | 15 |
| BYO | Small | 103.20 | 129 | 112.17 | 129 | 25 | 15 |
| BYO | Medium | 119.20 | 149 | 129.57 | 149 | 25 | 15 |
| BYO | Large | 135.20 | 169 | 146.96 | 169 | 25 | 15 |

- Main price is **25 % VAT**: `D = round(E / 1.25, 2)`.
- The **takeaway** price uses **15 % alternative VAT**: `K = round(E / 1.15, 2)`.
  The alternative incl. price `L` equals the normal incl. price `E` on every row; only the
  ex-VAT price and the VAT rate differ, because the takeaway rate is lower.
- `Innkjøpspris eks MVA` (C) = `0` on every row.
- BYO is unchanged by the 2026-09-18 revision.

## Delivery / packaging

- The XLSX keeps the template's column order, `Sheet1` and other archive parts (the template
  also ships unused `Sheet2`/`Sheet3`; they are retained untouched).
- Text cells are **inline strings** (`t="inlineStr"`); numeric cells are plain numbers
  (`t="n"`). The template's `sharedStrings.xml` is retained but unused.
- The XLSX was generated with the Python standard library (`zipfile`) because no XLSX
  library is installed. It has **not** been round-tripped through Excel or LibreOffice.

## Base/group product — is a separate row needed?

**No.** The generated import (`frontline_item_import_acai_template_2026-09-18.xlsx`) contains **only
the 21 variant rows** (7 flavours × 3 sizes), all with `Varenavn = Açaí`; there is **no separate
base/group row**.

- Frontline's own instruction says that to convert a single item into a colour/size item, the
  **original item number must also be listed as one of the item numbers in the colour/size form** —
  so the base/original *is* one of the variant entries, not a distinct SKU. One of the 21 (e.g.
  `Açaí Classic – Small`) serves as the original; the other 20 are added to it in the
  **Farge og størrelse** grid.
- Adding a separate base row (blank Farge/Størrelse, price 0) risks a **zero-price sellable item or a
  duplicate**, and is not required.
- Two paths: (a) **test-import 2–3 rows** to see whether Frontline auto-groups by `Varenavn` or
  requires manual grouping via one item's **Farge og størrelse** tab; (b) if a dedicated group row is
  required, **add one** (non-sellable/zero-price) or switch to **per-flavour parents**.

## Pending Frontline confirmations

1. **Does `Artikel nr.` accept alphanumeric SKUs?** The template example uses numeric values
   (`1`, `2`), and the column width is narrow. Our SKUs are alphanumeric
   (e.g. `ACAI-CLASSIC-S`) and are written as text inline strings. Confirm the importer
   accepts them, and whether `Varenavn`/`Varenummer` already act as the identifier instead.
2. **Must the parent/grouping item (`Açaí`) also be a row** in the import, or is it created
   separately before the variants? The import contains variant rows only.
3. **Does Alternative MVA (15 %) inherit** from the parent/group, or must it be set per item
   (as `M` here)? The older draft's `alt_mva` column assumed per item.
4. **Stock behaviour across variants** — shared parent stock or per-variant — is unconfirmed.
5. The template has no `mva_kode` column; the matrix's `mva_kode` mapping
   **3 / 31 / 5 ↔ 25 % / 15 % / 0 %** is **inferred** from the source export
   (`Heave water` = 31/15, `Lysløypa` = 5/0) and is **not** confirmed against Frontline
   documentation.

Until these are confirmed, treat the import as a **ready-to-review draft**, not a certified
production import.

## Step-by-step UI actions

1. **Create the açaí grouping/parent.** The matrix's `parent` column is `Açaí`; set it to
   whatever the live parent/group is actually named.
2. **Import** the 21 rows from `frontline_item_import_acai_template_2026-09-18.xlsx`.
3. **Verify** the 21 item numbers, then add the Farge × Størrelse entries on the parent:
   Farge = the seven flavour names, Størrelse = Small/Medium/Large.
4. **Include the original item as a variant entry.** The existing Small items
   100000001–100000007 are already present as rows; set the standalone item inactive if
   Frontline requires it once they are variants.
5. **Alternative price / alternative VAT.** Set `Alternativ pris` and `Alternativ MVA`
   (15 %) per item if these are not inherited from the parent/group.

## Included toppings (Restaurant-tab extras)

The item import **does not configure the Restaurant-tab `Ekstravalg`** — it only creates the item rows.
The included toppings are set up **in Frontline** as **0-price pre-selected extras** on each flavour's
base product (owner pattern, 2026-09-18), with only added-on extras carrying prices. The **per-flavour
included-topping mapping is still needed**. The **zero-price included lines must be exported** in sales
exports so theoretical consumption includes them.

## Optional cleanup

`100000008 Medium Bowl` and `100000009 Large Bowl` are **redundant** once size is modelled
as a variant (their 20/40 prices do not match the new variant prices). Decide whether to
**deactivate** them. They are deliberately left untouched.
