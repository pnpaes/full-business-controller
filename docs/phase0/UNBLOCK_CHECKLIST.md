# Phase 0 unblocking checklist

Status: **action plan** — one page to get every external input (I1–I19 in
`PHASE0_CLOSEOUT_PLAN.md §4`) moving. Sources of truth: `PHASE0_CLOSEOUT_PLAN.md §4`,
`SOURCE_DATA_REQUEST.md`, `POS_WOLT_NOTES.md`, `ACCOUNTING_FIKEN_NOTES.md`,
`ACCOUNTANT_QUESTIONS.md`. Drafts live in `EMAIL_DRAFTS.md`; capture templates live in
`samples/templates/`.

## What is blocked, and how to unblock it

| Input | Why blocked | Exact action to unblock | Who | Done when | Template/draft to use |
| --- | --- | --- | --- | --- | --- |
| **I1** Frontline POS exports/API | Daily/monthly reports arrived as **empty 0-page PDFs** (not importable); standard reports carry **no item-level detail** (aggregate only); `API Butikkdata` access not yet granted | Send the Frontline e-mail asking for API docs/sandbox + a **data-bearing Excel/CSV daily & monthly report** + an **item-level (`varenummer`) sales export** | Tech lead | API base URL/auth/rate-limits/tenant/sandbox received **and** a machine-readable item-level sales export (or documented API sales-lines fields) exists | `EMAIL_DRAFTS.md` §Frontline; `SOURCE_DATA_REQUEST.md` "Still requested from Frontline" |
| **I2** Wolt reports | No payout/line reports supplied yet (accountant holds them today) | Send the Wolt merchant-support e-mail; export payout reports **now** from the merchant portal | Owner (via Operations) | One payout report profiled + API/partner onboarding answer received | `EMAIL_DRAFTS.md` §Wolt |
| **I3** Vipps/Stripe settlements | Settlement exports not exported from the portals | Finance exports one month of settlement CSV/XLSX per provider and logs it against `I3` | Finance | One settlement export per provider profiled (columns, fees, payout dates) | Provider portal export (no template) |
| **I4** Item costs (ad-hoc grocery purchases) | No price lists/invoices received, and most items are bought ad hoc from regular grocery stores with no defined supplier | Collect the owner's existing price Excel files and recent grocery receipts into the cost-observation template; send the supplier e-mail only to genuine suppliers (coffee roaster, packaging, etc.) where a real supplier relationship exists | Purchasing / Owner | Price Excel files plus a few recent grocery receipts captured, covering fixture ingredients/packaging (supplier price lists only where a real supplier exists) | `samples/templates/cost_observations_template.csv`; `EMAIL_DRAFTS.md` §Suppliers |
| **I5** Recipes + yields | Recipes not documented in the required component/yield shape | Kitchen captures the six fixture recipes with components, loss/trim, prep minutes and portion size | Product owner / Kitchen | Six recipes captured and signed by kitchen + product owner | `samples/templates/recipe_capture_template.csv` |
| **I6** Cost spreadsheets | Current as-is costing sheets not shared | Management shares the current cost spreadsheets **as-is** (reconciliation baseline only, not an implementation input) | Product owner / Management | As-is spreadsheets received and reconciled against the six fixtures | As-is XLSX (no template) |
| **I7** Opening counts | No opening counts or count cadence recorded | Run one opening count per location/storage area into the template and agree the cadence | Operations / Location managers | One signed opening count per location + a written cadence note | `samples/templates/opening_counts_template.csv` |
| **I8** Labour rates | **Partially received 2026-09-18:** rates NOK 210/h (front of house) and 240/h (kitchen), feriepenger 10.2 %, arbeidsgiveravgift 14.1 % (Oslo/Sone 1), OTP 2 % → loaded 268.25/306.57; still missing **productive-hours %**, **insurance/other payroll costs** and the **role → location mapping** | Confirm productive-hours %, insurance/other payroll costs and role→location mapping; validate against a real payslip | Finance / Payroll | Loaded rate per role confirmed (productive-hours adjusted, all employer costs) and reconciled to one payslip | `docs/phase0/LABOUR_ASSUMPTIONS.md`; `samples/generated/labour_rates_2026-09-18.csv`; `samples/templates/labour_rates_template.csv` |
| **I9** Accountant ruling | Written confirmation outstanding; **gates DEC-003/DEC-022 and contract A2** | Send the accountant e-mail; book the session; confirm or correct each `[PROPOSED]` default | Finance / Accountant | Written answers to Q1–Q8 recorded; staff-meal/own-consumption caveat (`CALCULATION_CONTRACT.md §15`) closed | `EMAIL_DRAFTS.md` §Accountant; `ACCOUNTANT_QUESTIONS.md` |
| **I10** Fiken | Kontoplan/VAT-code list, posting structure and API token not provided | Request kontoplan + VAT-code list; confirm one monthly document vs per day/location; provision the API token in the secret manager | Finance / Accountant | Kontoplan/VAT-code mapping + posting structure confirmed; token stored in the secret manager; `swagger.yaml` saved | `EMAIL_DRAFTS.md` §Accountant (Fiken items); `ACCOUNTING_FIKEN_NOTES.md §5` |
| **I11** Sales history | Only **August 2026 legacy** reference exists (I19); 12 months not available | Request additional months if available, **marked legacy** and kept separate from Frontline history | Operations | Additional legacy months received, or "not available" recorded; DEC-011 forecast grain documented | Export by day/location/channel (no template) |
| **I14** Medusa/online mapping | No order + product-mapping sample | Tech lead captures a Medusa order sample and the product-mapping notes | Tech lead | One order sample + mapping notes profiled | Vendor/admin export (no template) |
| **I15** POS/API availability + terms | Vendor API terms/limits unconfirmed | Same Frontline e-mail: request base URL, auth, rate limits, tenant id, sandbox and **write-API** availability | Tech lead | Terms + API details captured and mapped to DEC-001/DEC-015 | `EMAIL_DRAFTS.md` §Frontline |
| **I16** LLM DPA | No data-processing terms on file | Send the LLM-provider e-mail requesting the DPA, no-training/no-retention options, data residency and rate limits | Tech lead + Finance | DPA + retention/residency terms filed (required before AI enablement, DEC-039) | `EMAIL_DRAFTS.md` §LLM provider |
| **I17** Competitor approvals | Per-source terms/legal review not done | Product owner records approved public sources, Wolt menu terms and the manual Instagram fallback | Product owner (business) | Approved-source list + terms links recorded for DEC-020 (before Phase 4) | Decision-log entry (no template) |
| **I18** Write APIs + credential owners | Per-source write-API availability and named credentials owners not set | Confirm write-API availability/terms and name a credentials owner per source (POS, Medusa/Sanity first) | Tech lead + Operations | Allowed-operations registry + named credentials owners recorded (DEC-015, before Phase 3) | `EMAIL_DRAFTS.md` §Frontline (write-API question) |
| **I19** Legacy export | — received, **reference only** | No action; use it to shape the importer/report design only | Owner (Operations) | Profiled 2026-09-18 (`SAMPLE_ANALYSIS.md §9`) | `SAMPLE_ANALYSIS.md §9` |

Already closed (no action): **I12** owners + RPO/RTO (recorded 2026-09-14) and **I13** hosting
(DigitalOcean AMS3, EU/EEA, Managed PostgreSQL PITR + Spaces — recorded 2026-09-14).

## Can start today without any input

Per `PHASE0_CLOSEOUT_PLAN.md §2` and `§8`:

- **Commit the Phase 0 baseline** — docs, decisions and schemas as they stand.
- **Scaffold the repo/CI/test harness** — repo layout, lint/typecheck, structured logging and the
  vitest harness. *Not* auth (waits on ADR-0003) and *not* persistence (waits on ADR-0002).
- **Draft the Phase 1 slice plan** — vertical tracer-bullet slices from `PHASE0_CLOSEOUT_PLAN.md §3`
  and the requirement→phase map in `§6`.

## Can be bypassed or defaulted so nothing hard-blocks

- **Sales importer**: build against the known **legacy Zettle item-level schema** (I19) as a
  reference shape; swap to Frontline when I1 lands. I19 is reference-only, not authoritative.
- **Theoretical consumption**: run at **item-group/category granularity** until Frontline item-level
  detail is confirmed — a known limitation, not a temporary gap (R-01).
- **Tax edge cases**: covered by DEC-003 defaults (25 % dine-in / 15 % takeaway, catering,
  pre-orders); only staff-meal, own-consumption and representation recoverability stay pending (Q2).
  No build waits on it.
- **Fiken**: build the client against the published `swagger.yaml` spec; no need to wait for the
  accountant to start (only posting structure/mapping needs confirmation).
- **FX/rounding**: default to Norges Bank daily reference and HALF_UP (DEC-023, DEC-024) until the
  accountant corrects them.
- **Wolt/Foodora**: report import now (DEC-040); a direct API connector is a future step.
- **True Phase 1 blockers**: item cost data (**I4**), recipes/yields (**I5**) and labour rates
  (**I8**) are the only inputs that cannot be defaulted for Phase 1 costing.

## Definition of unblocked

Phase 0 is "unblocked enough to build Phase 1" when the **three genuine Phase 1 blockers** are in:

1. **Item cost data — I4** (existing price Excel files + recent grocery receipts; supplier price lists only for real suppliers such as coffee/packaging).
2. **Recipes/yields — I5** (six recipes with components, loss and portion size).
3. **Labour rates — I8** (loaded hourly rate per role, reconciled to a payslip).

Everything else can proceed in parallel or be defaulted. **I4, I5 and I8 block the golden-fixture
sign-off and real-costing trust, not the start of development.** The **accountant ruling (I9)** and
the remaining **sample profiling (I1–I8, I10)** are still required for the Phase 0 **exit gate**
(`PHASE0_CLOSEOUT_PLAN.md §9`), but they do not block scaffolding, the slice plan, the importer
design, or the fixture *structure*. Scaffolding and the costing engine proceed in parallel now,
built against the pinned Calculation Contract and tested with **synthetic fixtures** (owner
clarification, 2026-09-18).
