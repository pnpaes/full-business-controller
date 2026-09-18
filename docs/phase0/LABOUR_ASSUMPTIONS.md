# Labour Rate Assumptions — Phase 0 (I8, partial)

Status: **partially received 2026-09-18.** Owner-provided labour data for the Phase 1 loaded
hourly rates. The rates below are the basis for the `labor` block in the golden fixtures
(`GOLDEN_FIXTURES.md`) and for `direct_labor_cost` in `CALCULATION_CONTRACT.md §7`. See **DEC-006**
(direct-labour treatment in contribution), **DEC-048** (owner production labour imputation) and
**COST-004**/*COST-006*/*COST-013* (loaded role/cost-centre rates; contribution before/after labour;
owner imputation). Costing stores role rates only, never named employees (`DEC-012`).

## 1. Roles and base rates (owner, 2026-09-18)

| Role | Base hourly rate (NOK) | Note |
| --- | --- | --- |
| Front of house (and most employees) | 210.00 | most employees |
| Kitchen | 240.00 | one kitchen employee |
| Owner (Paulo) | 240.00 (imputed) | works unpaid; production hours imputed at the kitchen rate — loaded 306.57 |

The owner works unpaid in production, but those hours are **costed at the same rate as the other
kitchen employee** (kitchen loaded rate; NOK 240 base → **NOK 306.57 loaded**) so product costs are
realistic from the start. This is a deliberate forward-looking cost: when a paid replacement is
hired, the imputation becomes an actual cost with **no model change**. Reports present **both
views** — an **economic view** including imputed owner labour and a **cash view** excluding it; the
statutory/cash P&L shows no salary. See **DEC-048** and **COST-013** (§5).

## 2. Statutory employer costs

| Component | Norwegian rate | Basis / caveat |
| --- | --- | --- |
| Feriepenger (holiday pay) | **10.2 %** | statutory, 25 working days; **12.0 % for employees aged 60+** — *not currently in use: all current employees are under 60 (owner, 2026-09-18), so 10.2 % applies; keep the 12.0 % note for future hires* |
| Arbeidsgiveravgift (employer social contribution) | **14.1 %** | Oslo = **Sone 1**; **confirm with the accountant** — the zone rules changed from 2025 |
| Pensjon (OTP) | **2 %** | statutory minimum, on salary between **1G and 12G**; the 1G floor means very low annual wages may attract less |

**Feriepenger basis (owner, 2026-09-18):** all current employees are **under 60**, so the **10.2 %**
rate applies and the 12.0 % (60+) case **does not currently apply**; it is retained only as a note
for future hires. All loaded rates below therefore use 10.2 %.

Not yet included: employer injury insurance (`yrkesskadeforsikring`) and any other payroll costs.
These must be added as an insurance/`other_cost_nok` component if they exist.

## 3. Loaded-rate calculation

Two methods are computed; the **compounded** method is recommended and used.

**Additive approximation:**
`loaded = base × (1 + 0.102 + 0.141 + 0.02) = base × 1.263`

**Compounded (recommended, accurate):**

```text
feriepenger        = 0.102 × base
arbeidsgiveravgift = 0.141 × (base + feriepenger)
pensjon            = 0.02  × base
loaded             = base + feriepenger + arbeidsgiveravgift + pensjon
```

| Base (NOK/h) | Feriepenger 10.2 % | AG A on base+ferie 14.1 % | Pensjon 2 % | **Loaded (compounded)** | Additive approx. |
| --- | --- | --- | --- | --- | --- |
| 210.00 | 21.42 | 32.63 | 4.20 | **268.25** | 265.23 |
| 240.00 | 24.48 | 37.29 | 4.80 | **306.57** | 303.12 |

Worked example (210): `0.102 × 210 = 21.42`; `0.141 × (210 + 21.42) = 0.141 × 231.42 = 32.63022 →
32.63`; `0.02 × 210 = 4.20`; `210 + 21.42 + 32.63 + 4.20 = 268.25`. All values rounded to 2 dp.

Caveats to confirm with the accountant: the arbeidsgiveravgift rate/zone (Sone 1 for Oslo, rules
changed from 2025) and whether feriepenger belongs in the arbeidsgiveravgift base — this document
follows the owner's compounded method, which includes it.

## 4. Productive hours

`CALCULATION_CONTRACT.md §7` defines
`loaded_hourly_rate = (wage + employer_charges + holiday_pay + pension + approved payroll cost) /
productive_paid_hours` (COST-004). The rates above are **per paid hour**; the **productive-hours %**
(paid vs productive time) is still missing (I8) and must be applied before costing if it differs
from 100 %.

## 5. Owner production labour imputation (DEC-048, COST-013)

The owner's production hours are **imputed at the kitchen loaded rate** — NOK 240/h base →
**NOK 306.57/h loaded** (§3) — even though they are unpaid. The rule is deliberately forward-looking:
costing is realistic from the start, and hiring a paid replacement later converts the imputation
into an actual cost with **no model change**.

Both views are reported and always labelled:

- **Economic view** — includes imputed owner labour (the owner's production time at 306.57/h).
- **Cash view** — excludes owner labour; the statutory/cash P&L shows no salary.

The imputed amount is **non-cash**: it belongs to the economic/costing view and must never be
presented as a cash salary or enter the statutory P&L.

## 6. Still-missing inputs (I8)

- **Productive-hours %** — productive share of paid hours (business assumption, e.g. 85 %).
- **Employer injury insurance / other payroll costs** — an insurance/`other_cost_nok` component to
  add to the loaded rate if they exist.
- **Role → location mapping** — which roles are paid at which location (current rows use `all`).
- **Payslip reconciliation** — validate the computed loaded rate against one real payslip.

## 7. How this feeds the build

- `CALCULATION_CONTRACT.md §7` — `direct_labor_cost = round(productive_minutes / 60 ×
  loaded_hourly_rate, 4 dp)`; the rates here are the `loaded_hourly_rate` inputs (COST-004).
- `GOLDEN_FIXTURES.md` — the `labor.loaded_hourly_rate` input and `direct_labor_cost` expectations
  use the loaded rates: front of house **268.25**, kitchen **306.57**; the owner's production time is
  included at the kitchen rate and the fixture notes the economic-vs-cash view (`DEC-048`, `COST-013`).
- `samples/generated/labour_rates_2026-09-18.csv` — the machine-readable rate rows.
- `DEC-006` / `COST-006` — contribution is shown before and after standard direct labour, always
  labelled; loaded labour includes Norwegian employer costs (`12_OPEN_DECISIONS.md`).
