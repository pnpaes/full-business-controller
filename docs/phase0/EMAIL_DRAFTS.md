# Phase 0 e-mail drafts

Ready-to-send drafts for every blocked external input. Replace `[brackets]` before sending.
Keep the thread labelled with the input `Ref` (I1, I4, I9, …) so replies can be logged against
`SOURCE_DATA_REQUEST.md`.

---

## 1. To the accountant (I9, I10)

**Emne:** Aquarela Kafé – avklaringer regnskap, mva og Fiken

Hei [Regnskapsfører],

Vi bygger et økonomistyringssystem for Aquarela Kafé og trenger skriftlige avklaringer før vi låser
beregnings- og bokføringslogikken. Spørsmålene ligger i `ACCOUNTANT_QUESTIONS.md` med forslag til
standardvalg (`[PROPOSED]`). Vi ber om bekreftelse eller korreksjon på:

1. **Inngående mva:** fradragsrett på personalmåltider, eget forbruk og representasjon – hva kan
   føres, hva må reduseres/nektes? Gjelder delvis fradragsrett (deler av virksomheten)?
2. **Utgående mva:** 25 % servering / 15 % takeaway, catering og forhåndsbestilling – og bekreft
   behandlingen av drikke, alkohol og varer solgt som dagligvare.
3. **Fiken:** ønsker dere én månedlig samledokumentasjon eller bokføring per dag/lokasjon? Hvilken
   **kontoplan- og mva-kodemapping** skal vi bruke? (Fiken API v2 er aktivert hos oss.)
4. **Rapportering og SAF-T:** kreves SAF-T-eksport, og i hvilket format? Avrunding: HALF_UP, mva
   avrundes på transaksjonsnivå, kontant avrundes til hele kroner uten å endre mva-grunnlaget.
5. **Lønn:** innhold, format og tidspunkt for månedlig lønnsinnspill-rapport (ca. 3 dager før
   månedsslutt), samt oppbevaringstider for regnskaps- og personalopplysninger.

Kan vi ta et kort møte [dato/tid]? På forhånd takk.

Med vennlig hilsen
[Navn], Aquarela Kafé – [telefon/e-post]

### English version

**Subject:** Aquarela Kafé – accounting, VAT and Fiken clarifications

Hi [Accountant],

We are building a financial-control system for Aquarela Kafé and need written answers before we lock
the calculation and bookkeeping logic (questions in `ACCOUNTANT_QUESTIONS.md`, with proposed
defaults):

1. **Input VAT:** recoverability on staff meals, own consumption and representation — what is
   deductible, restricted or denied? Does any partial exemption apply?
2. **Output VAT:** 25 % dine-in / 15 % takeaway, catering and pre-orders — and the treatment of
   drinks, alcohol and goods sold as groceries.
3. **Fiken:** one monthly summary document or per day/location? Which **chart-of-accounts and
   VAT-code mapping** should we use? (Fiken API v2 is enabled for us.)
4. **Reporting and SAF-T:** is a SAF-T export required, and in what format? Rounding: HALF_UP, VAT at
   transaction level, cash rounded to whole kroner without changing the VAT base.
5. **Payroll input:** content, format and timing of the monthly payroll-input report (~3 days before
   month-end) and retention periods.

Could we take a short call on [date/time]? Thank you.

Best regards,
[Name], Aquarela Kafé – [phone/e-mail]

---

## 2. To Frontline POS (I1, I15, I18)

**Emne:** Aquarela Kafé – API Butikkdata, eksport og varemal

Hei,

Vi tar i bruk Frontline POS i Aquarela Kafé og trenger følgende for å kunne importere salgs- og
varedata:

1. **API Butikkdata:** tilgang, onboarding, dokumentasjon, **base-URL**, autentisering (API-nøkkel/
   OAuth), rate limits, eventuell **tenant-id** og **sandbox/testmiljø**.
2. **Vareeksport/-import (Excel):** hvilke kolonner, skilletegn, tegnsett og desimaler? Aksepterer
   `Artikel nr.`/`varenummer` **alfanumeriske SKU-er**, og kreves det en **base-/grupperingslinje**
   for farge- og størrelsesvarianter?
3. **Salg på varelinjenivå:** finnes en rapport per `varenummer` (mengde, netto/mva/brutto), eller
   eksponerer **API-et salgslinjer**? Standardrapportene ser ut til å være aggregert.
4. **Anvendt pris/mva per linje:** eksporterer rapporten/API-et den **anvendte** prisen/mvaen
   (standard vs **"Alternativ pris / Alternativ MVA"**), **variantens `varenummer`** ved variantsalg,
   og **inkluderte ekstravalg** med pris 0?
5. **Lager på tvers av varianter:** holdes lager på hovedvaren eller per variant-`varenummer`, og
   hvordan påvirker Farge og størrelse lagerbevegelser?
6. **Mva-koder:** bekreft mappingen mellom numerisk `mva_kode` (3 = 25 %, 31 = 15 %, 5 = 0 %) og de
   navngitte mva-kodene i produktbildet ("Utgående mva, høy/middels sats").
7. **Skrive-API:** støtter API-et utskriving (pris/produkt/lager), eller er det kun lesing?

På forhånd takk.

Med vennlig hilsen
[Navn], Aquarela Kafé – [telefon/e-post]

### English fallback

**Subject:** Aquarela Kafé – API Butikkdata, exports and item template

Hi,

We are adopting Frontline POS at Aquarela Kafé and need the following to import sales and item data:

1. **API Butikkdata:** access, onboarding, documentation, **base URL**, auth model, rate limits,
   tenant identifier and a **sandbox/test environment**.
2. **Item export/import (Excel):** exact columns, delimiter, encoding and decimals. Does
   `Artikel nr.`/`varenummer` accept **alphanumeric SKUs**, and is a **base/grouping row required**
   for colour/size variants?
3. **Line-level sales:** is there a report per `varenummer` (quantity, net/VAT/gross), or does the
   **API expose sales lines**? The standard reports appear aggregate-only.
4. **Applied price/VAT per line:** does the export/API carry the **applied** price/VAT (default vs
   **"Alternativ pris / Alternativ MVA"**), the **variant `varenummer`** on a variant sale, and
   **zero-price included extras**?
5. **Stock across variants:** is stock held on the parent or per variant item number, and how does
   Farge og størrelse affect stock movements?
6. **VAT codes:** please confirm the mapping between numeric `mva_kode` (3 = 25 %, 31 = 15 %,
   5 = 0 %) and the named VAT codes.
7. **Write API:** can the API write (price/product/stock), or is it read-only?

Thank you.

Best regards,
[Name], Aquarela Kafé – [phone/e-mail]

---

## 3. To suppliers (I4) — genuine suppliers only

Use this draft only for **real supplier relationships** (e.g. coffee roaster, packaging supplier).
Most items are bought ad hoc from regular grocery stores with no supplier and no negotiated price
list; those are captured from the owner's receipts and price Excel files instead (see the internal
note below, and DEC-047).

**Emne:** Aquarela Kafé – forespørsel om prisinformasjon

Hei [Leverandør],

Vi beregner tilbudskalkyler for Aquarela Kafé og trenger oppdatert prisinformasjon for varene vi
kjøper av dere:

- **Gjeldende prisliste** med pakningsstørrelser/-enheter, **pris inkl. mva** og deres
  **artikkelnummer** (gjerne som CSV/Excel).
- **En nylig faktura** for varene vi bruker (bl.a. kaffe og emballasje), slik at vi kan kontrollere
  pris og enhet.

Kan dere sende dette til [e-post]? På forhånd takk.

Med vennlig hilsen
[Navn], Aquarela Kafé – [telefon/e-post]

### Internal note — owner (I4)

Items bought ad hoc from grocery stores have no supplier price list. Capture them from:

1. The existing **price Excel files** (item, pack size, pack price).
2. A few recent **grocery receipts** — a scan or photo is fine (date, store, item, pack size, price).
3. Any **supplier price list** only where a real supplier relationship exists (coffee roaster,
   packaging, etc.).

Record everything in `samples/templates/cost_observations_template.csv`; the selected base-unit cost
then resolves by source precedence (DEC-047).

---

## 4. To Wolt merchant support (I2)

**Subject:** Aquarela Kafé – payout reports and developer API access

Hello,

We are building an internal reporting system for Aquarela Kafé and use Wolt for delivery.

1. Please provide our **payout reports** and any **line-item/settlement export** available in the
   merchant portal, for [period]. CSV/Excel preferred.
2. What is the process to get **developer API** access (Order, Menu, Venue) — partner onboarding, test
   credentials and sandbox?
3. What are the **API terms**, rate limits, credential ownership and data-residency rules?

Thank you.

Best regards,
[Name], Aquarela Kafé – [phone/e-mail]

---

## 5. To the LLM provider (I16)

**Subject:** Data-processing terms / DPA request – [provider] for Aquarela Kafé

Hello,

We plan to use [provider/model] for advisory-only analysis behind a swappable provider abstraction.

1. Please provide your **data-processing terms / DPA** and confirm whether prompts or outputs are
   used for model training.
2. Are there **no-training / zero-retention** options, and where is data processed and stored
   (**data residency**)?
3. What are the **rate limits**, token/cost limits and applicable enterprise terms?

Thank you.

Best regards,
[Name], Aquarela Kafé – [phone/e-mail]
