# Screen inventory (71 routes)

Every `page.tsx` under `apps/web/app/(app)`. Reviews are written per area to
`docs/ux/reviews/<area>.md`; the contract is `docs/ux/README.md`.

| Area | Screens |
| --- | --- |
| `home` | 1 |
| `account` | 1 |
| `administration` | 1 |
| `ai` | 1 |
| `close` | 1 |
| `costs` | 11 |
| `documents` | 3 |
| `hms` | 8 |
| `insights` | 9 |
| `inventory` | 7 |
| `jobs` | 1 |
| `production` | 3 |
| `products` | 4 |
| `purchasing` | 3 |
| `recipes` | 2 |
| `sales` | 6 |
| `styleguide` | 1 |
| `tasks` | 1 |
| `workforce` | 7 |

## Routes

| Route | File (under `apps/web/app/(app)/`) | Purpose |
| --- | --- | --- |
| `/` | `page.tsx` | Management home — the landing dashboard |
| `/account/security` | `account/security/page.tsx` | Own account security (password, MFA) |
| `/administration` | `administration/page.tsx` | Users, roles, integrations, config registers |
| `/ai` | `ai/page.tsx` | AI advisory review queue (approve/reject) |
| `/close` | `close/page.tsx` | Period-close register (begin/lock/reopen) |
| `/costs` | `costs/page.tsx` | Costing overview |
| `/costs/allocation-rules` | `costs/allocation-rules/page.tsx` | Overhead allocation rules |
| `/costs/channel-fee-rules` | `costs/channel-fee-rules/page.tsx` | Channel fee rules |
| `/costs/cost-cards` | `costs/cost-cards/page.tsx` | Cost cards register |
| `/costs/cost-cards/[id]` | `costs/cost-cards/[id]/page.tsx` | Cost card detail |
| `/costs/cost-pools` | `costs/cost-pools/page.tsx` | Cost pools |
| `/costs/labor-rates` | `costs/labor-rates/page.tsx` | Labour rates |
| `/costs/operating-costs` | `costs/operating-costs/page.tsx` | Operating costs |
| `/costs/price-scenarios` | `costs/price-scenarios/page.tsx` | Price scenario register |
| `/costs/price-scenarios/[id]` | `costs/price-scenarios/[id]/page.tsx` | Price scenario detail (approve) |
| `/costs/price-versions` | `costs/price-versions/page.tsx` | Effective price versions |
| `/documents` | `documents/page.tsx` | Document library (published, all-staff) |
| `/documents/[id]` | `documents/[id]/page.tsx` | Document detail + versions |
| `/documents/new` | `documents/new/page.tsx` | Publish a document |
| `/hms` | `hms/page.tsx` | HMS overview |
| `/hms/checklists` | `hms/checklists/page.tsx` | Compliance checklists |
| `/hms/compliance-export` | `hms/compliance-export/page.tsx` | Compliance export |
| `/hms/corrective-actions` | `hms/corrective-actions/page.tsx` | Corrective actions register |
| `/hms/equipment` | `hms/equipment/page.tsx` | Equipment register |
| `/hms/equipment/[id]` | `hms/equipment/[id]/page.tsx` | Equipment detail (checks, maintenance) |
| `/hms/incidents` | `hms/incidents/page.tsx` | Incident register |
| `/hms/incidents/[id]` | `hms/incidents/[id]/page.tsx` | Incident detail + evidence |
| `/insights` | `insights/page.tsx` | Insights overview |
| `/insights/benchmarks` | `insights/benchmarks/page.tsx` | Benchmarks |
| `/insights/competitors` | `insights/competitors/page.tsx` | Competitors, observations, sources, comparison |
| `/insights/forecast` | `insights/forecast/page.tsx` | Forecast tracking (accuracy, overrides) |
| `/insights/menu-engineering` | `insights/menu-engineering/page.tsx` | Menu engineering |
| `/insights/operations` | `insights/operations/page.tsx` | Operations reports |
| `/insights/reports` | `insights/reports/page.tsx` | Reports hub |
| `/insights/simulation` | `insights/simulation/page.tsx` | Simulation |
| `/insights/trends` | `insights/trends/page.tsx` | Trends |
| `/inventory` | `inventory/page.tsx` | Stock balances |
| `/inventory/[itemId]` | `inventory/[itemId]/page.tsx` | Item stock detail (movements) |
| `/inventory/counts` | `inventory/counts/page.tsx` | Stock counts register |
| `/inventory/counts/[countId]` | `inventory/counts/[countId]/page.tsx` | Count detail (approve) |
| `/inventory/transfers` | `inventory/transfers/page.tsx` | Transfers register |
| `/inventory/transfers/[id]` | `inventory/transfers/[id]/page.tsx` | Transfer detail (receive) |
| `/inventory/waste` | `inventory/waste/page.tsx` | Waste register |
| `/jobs` | `jobs/page.tsx` | Jobs + dead-letter review queue |
| `/production` | `production/page.tsx` | Production overview |
| `/production/batches/[batchId]` | `production/batches/[batchId]/page.tsx` | Batch detail (complete) |
| `/production/plans` | `production/plans/page.tsx` | Production plans |
| `/products` | `products/page.tsx` | **Items** register — the things we stock and cost (inventory identity) |
| `/products/[itemId]` | `products/[itemId]/page.tsx` | Item detail (recipes, variants) |
| `/products/sellables` | `products/sellables/page.tsx` | **Sellable products** list, each with its variants count |
| `/products/sellables/[productId]` | `products/sellables/[productId]/page.tsx` | Product view — its data + its variants + "New variant" |
| `/products/sellables/[productId]/variants/[variantId]` | `…/variants/[variantId]/page.tsx` | Variant edit surface (identity, recipe assignment, add-on applicability) |

| `/purchasing` | `purchasing/page.tsx` | Purchase orders / receiving overview |
| `/purchasing/new` | `purchasing/new/page.tsx` | New purchase order |
| `/purchasing/receipts/[id]` | `purchasing/receipts/[id]/page.tsx` | Goods receipt detail |
| `/recipes` | `recipes/page.tsx` | Recipe register |
| `/recipes/[recipeId]` | `recipes/[recipeId]/page.tsx` | Recipe detail (lines, versions) |
| `/sales` | `sales/page.tsx` | Sales overview |
| `/sales/import` | `sales/import/page.tsx` | Sales import runs |
| `/sales/import/[runId]` | `sales/import/[runId]/page.tsx` | Import run detail (dispositions) |
| `/sales/reconciliation` | `sales/reconciliation/page.tsx` | Sales reconciliation |
| `/sales/transactions` | `sales/transactions/page.tsx` | Sales transactions register |
| `/sales/transactions/[id]` | `sales/transactions/[id]/page.tsx` | Transaction detail |
| `/styleguide` | `styleguide/page.tsx` | Living design-system reference |
| `/tasks` | `tasks/page.tsx` | Task register |
| `/workforce` | `workforce/page.tsx` | Workforce overview |
| `/workforce/employees/[id]` | `workforce/employees/[id]/page.tsx` | Employee detail + documents |
| `/workforce/my-shifts` | `workforce/my-shifts/page.tsx` | Employee self-service shifts (self-assign) |
| `/workforce/payroll-reports` | `workforce/payroll-reports/page.tsx` | Payroll report register |
| `/workforce/payroll-reports/[id]` | `workforce/payroll-reports/[id]/page.tsx` | Payroll report detail (export) |
| `/workforce/shifts` | `workforce/shifts/page.tsx` | Shift roster + assignments + pending approvals |
| `/workforce/worked-hours` | `workforce/worked-hours/page.tsx` | Worked hours + adjustments |
