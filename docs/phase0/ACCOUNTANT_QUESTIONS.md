# Accountant Questions — Aquarela Kafé

Status: **Draft for accountant review.** Each question states the context and our **proposed default**
(`[PROPOSED]`) so you can confirm or correct it. Where a default is confirmed, the corresponding
decision moves from accepted-with-caveat to fully accepted; where a default is corrected, the
calculation contract and tax configuration change before production use.

Scope: the finance and tax items still open in Phase 0. These answers gate `DEC-003` (final VAT
ruling), `DEC-016` (accounting/reconciliation export shape) and the monthly payroll-input report
(`DEC-037`). They do not cover statutory payroll processing or tax filing, which are explicitly out
of scope (`01:79-80`).

No personal data is required to answer these questions. If an example would contain employee
identity, redact it to role and rate only.

---

## Q1. Output VAT rates and classification

**Context.** We must store the output VAT rate per product/service type × channel × location, and
reject any amount that lacks a tax basis (`CALCULATION_CONTRACT.md §2`). Today the configuration
carries two rates but the boundary cases are unconfirmed.

**Proposed default (`[PROPOSED]`).**

- **25%** for dine-in / restaurant service.
- **15%** for takeaway, catering and pre-orders.
- Prepared hot drinks: rate follows **how the drink is served** — consumed on the premises is
  dine-in (25%), taken away is takeaway (15%).
- Alcohol and soft drinks: confirm whether these follow the same dine-in/takeaway split or carry a
  separate rate.
- Confirm any exceptions (for example items sold as groceries, whole cakes, or catering with
  delivery) that would change the rate.

**Confirm or correct:** rate per group above, the served-vs-taken-away rule for drinks, the alcohol
and soft-drink treatment, and any exception list.

## Q2. Input VAT recoverability

**Context.** Input VAT is recoverable where the purchase carries VAT (accepted `DEC-003`). We convert
costs to net of recoverable tax before costing (`CALCULATION_CONTRACT.md §2`, §5). The restricted
cases are still unconfirmed.

**Proposed default (`[PROPOSED]`).**

- Recover input VAT on all normal business purchases that carry VAT.
- **Restrict or deny** recoverability on staff meals, own consumption, representation and samples.
- Confirm whether any **partial exemption** (deler av virksomheten) applies, and if so on which
  cost categories and by what method.

**Confirm or correct:** the deny/restrict list, the exact categories, and whether partial exemption
applies.

## Q3. Rounding

**Context.** The contract pins `HALF_UP` and a single rounding at each named boundary, with amounts
carried at 4 dp internally and presented at 2 dp (`CALCULATION_CONTRACT.md §1`). `DEC-024` is
proposed and needs confirmation.

**Proposed default (`[PROPOSED]`).**

- Arithmetic rounding **half-up (HALF_UP)** to the nearest øre.
- VAT rounded at the **invoice/transaction level**, not per line.
- **Cash payments** rounded to whole kroner **without changing the VAT base** (the rounded amount is
  a payment convenience only; the tax base is the unrounded transaction amount).

**Confirm or correct:** the rounding method (or whether HALF_EVEN is required), the level at which
VAT is rounded, and the cash-rounding rule and its effect on the VAT base.

## Q4. Inventory valuation

**Context.** Operational valuation is moving weighted average per item/location with lot
traceability (`DEC-008`); the accountant must confirm statutory export handling (`DEC-008`,
`PHASE0_CLOSEOUT_PLAN.md §4` I9).

**Proposed default (`[PROPOSED]`).**

- **Moving weighted average** is acceptable as the operational valuation method.
- Confirm what **statutory/export handling** is required (including any SAF-T-shaped export; see Q6).
- **Year-end valuation principle:** acquisition cost (anskaffelseskost, `regnskapsloven §5-3`), with
  an explicit write-down rule for spoilage and obsolescence.

**Confirm or correct:** acceptance of moving weighted average, the required statutory/export
treatment, the year-end principle and any write-down rule.

## Q5. Payroll-input report

**Context.** A monthly payroll-input report is produced about 3 days before month-end from registered
shifts, assuming the remaining planned shifts run as scheduled (`DEC-037`). It is an **input** report;
payroll processing, payslips and tax withholding stay out of scope.

**Proposed default (`[PROPOSED]`).**

- **Content:** employee, hours, hourly rate, expected gross pay.
- **Format:** CSV or XLSX, consistent per month; confirm what you prefer to receive.
- **Basis:** registered shifts plus the assumption that remaining planned shifts run as scheduled.
- **Late changes:** reconciliation — how should late shift changes or corrections be surfaced after
  the report is issued (a supplement, a correction line, or an updated file)?
- Confirm the **working-time record** requirements under `arbeidsmiljøloven` and the applicable
  **retention periods**.

**Confirm or correct:** content, format, the planned-shift assumption, the late-change reconciliation
method, and the working-time record/retention requirements.

## Q6. Export and reconciliation package

**Context.** `DEC-016` accepts a monthly reconciliation package: structured CSV/JSON with snapshot ID,
generated time, scope and checksums, plus reference links to source records, validated against
Fiken's import before build, with a SAF-T-shaped version where Norwegian bookkeeping expects it.
Fiken's **API v2 is available and already enabled** for Aquarela (OpenAPI-published, OAuth2/personal
token; see `ACCOUNTING_FIKEN_NOTES.md`), so the package can be delivered as a file and/or pushed via
the API for approved operations.

**Proposed default (`[PROPOSED]`).**

- Confirm the **Fiken import format** required.
- Confirm whether a **SAF-T (SAF-T Financial)** shaped export is needed.
- **Monthly package contents:** CSV/JSON carrying snapshot ID, generated time, scope, checksums and
  reference links to source records.
- **Delivery channel:** do you prefer (a) the CSV/JSON package, (b) API posting of summarized documents,
  or (c) both?
- **Mapping:** what **account/cost-centre mapping** (kontoplan) and **VAT-code mapping** is required?

**Confirm or correct:** Fiken format, SAF-T requirement, package contents, preferred delivery channel
(a/b/c) and the account/VAT-code mapping.

## Q7. Retention

**Context.** Retention and deletion must follow Norwegian rules without corrupting financial/audit
obligations (`07_SECURITY_AND_NFR.md §7.4`), with exact periods to be confirmed by the accountant
(`07:61-62`).

**Proposed default (`[PROPOSED]`).**

- **Accounting material:** per `bokføringsforskriften` (confirm the period).
- **Payroll records and personnel data:** per `Personopplysningsloven`/GDPR, with working-time
  records retained per the working-environment rules (see Q5).
- Confirm that deletion of personal data when no longer required is acceptable where financial/audit
  obligations are preserved.

**Confirm or correct:** the retention period for each category and the deletion rule.

## Q8. Anything else

**Context.** This is the last open finance/tax input before Phase 1 business logic.

- Confirm anything else needed for a compliant bookkeeping handoff.
- Confirm the **monthly/quarterly cadence** you want (report dates, delivery channel, who receives it).

**Confirm or correct:** any additional requirement and the preferred cadence.

---

## Decisions that depend on these answers

| Decision | Depends on | Effect |
| --- | --- | --- |
| `DEC-003` | Q1, Q2 | Final VAT ruling; closes the staff-meal/own-consumption caveat in `CALCULATION_CONTRACT.md §15`. |
| `DEC-022` | Q1, Q3 | Effective-dated tax rules, rounding level and basis confirmed. |
| `DEC-024` | Q3 | Rounding method and boundary confirmed. |
| `DEC-008` | Q4 | Valuation and statutory export handling confirmed. |
| `DEC-016` | Q6, Q7 | Fiken/SAF-T shape and retention confirmed before Phase 3 close. |
| Payroll-input report (`DEC-037`) | Q5, Q7 | Content, format and retention confirmed. |
| Calculation contract (A2) | Q1–Q4 | Signed once the above defaults are confirmed or corrected. |
