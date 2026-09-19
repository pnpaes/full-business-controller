# Deployment Cost Estimate — DigitalOcean App Platform

**Purpose:** the owner's outstanding *component cost estimate* input before a real
`terraform apply` (see `docs/runbooks/deployment.md`). Currency **USD**. Estimates are
list prices at **ams3** for one month, before tax and before promotional credit.

- **Source of truth for specs:** `infra/modules/**` and `infra/envs/{staging,production}/**`
  (values below are the literal values in `staging.tfvars` / `production.tfvars`, not placeholders).
- **Companion runbook:** `docs/runbooks/deployment.md`.
- **Nothing has been applied.** This document changes no code or Terraform; it is an estimate only.
- **Estimate date:** 2026-09-19.

## Sources (all fetched 2026-09-19)

| Used for | URL | Fetch |
| --- | --- | --- |
| App Platform instance sizes/prices | https://docs.digitalocean.com/products/app-platform/details/pricing/ | OK |
| App Platform marketing prices | https://www.digitalocean.com/pricing/app-platform | OK |
| Managed PostgreSQL per-node prices | https://www.digitalocean.com/pricing/managed-databases | OK |
| PostgreSQL node/HA billing rules | https://docs.digitalocean.com/products/databases/postgresql/details/pricing/ | OK |
| Spaces subscription ($5/mo, shared buckets) | https://docs.digitalocean.com/products/spaces/details/pricing/ | OK |
| Spaces marketing prices | https://www.digitalocean.com/pricing/spaces-object-storage | OK |

**Fetch failures:** `https://docs.digitalocean.com/products/databases/details/pricing/`
returned **404** (page does not exist at that path); the PostgreSQL pricing page above was
used instead. No affected line was left un-priced. The Managed Databases marketing page is
the authority for the per-node figures below.

## Global assumptions

1. **Region:** `ams3` for every resource (Terraform default `region`; DEC-014). App Platform
   and Managed DB pricing is region-independent in the EU/EEA regions; no EU premium assumed.
2. **Month length / hours:** DO bills a "month" as **672 h (28 days)** — borne out by the
   published hourly rate: `$0.02254/h × 672 = $15.15` and `$0.09063/h × 672 = $60.90`.
   App Platform is billed per second; its monthly figures are used directly.
3. **Staging runs continuously** unless explicitly destroyed between rehearsals (see levers).
4. **Transfer/storage within included allowances.** App Platform legacy `basic-*` plans include
   40 GiB egress per container, pooled team-wide; Spaces includes 250 GiB storage + 1024 GiB
   egress shared across all buckets; Managed DB traffic is not billed against transfer.
   Overages (if any): App Platform `$0.02/GiB`, Spaces storage `$0.02/GiB/mo`, Spaces egress
   `$0.01/GiB`.
5. **One DO team/account** hosts both environments (one project per environment per the runbook),
   so the **single $5/mo Spaces subscription is counted once** and shared by all buckets —
   including the out-of-band Terraform state bucket.
6. **DB storage** is the plan default (Terraform sets no `storage_size`); the plan price includes
   it. Extra storage would be `$0.215/GiB/mo`.
7. **No dedicated egress IPs, no development database, no paid extra buckets.** DNS is free and,
   with `manage_dns = false` and `domain_name = null`, the DNS module creates 0 resources.

## Staging — `infra/envs/staging/staging.tfvars`

App Platform component subtotal **$15.00**.

| Resource (Terraform) | Spec (from tfvars) | Unit price | Qty | Monthly | Confidence |
| --- | --- | --- | --- | --- | --- |
| App Platform `web` service | `basic-xxs` (1 shared vCPU / 512 MiB) | $5.00/mo | 1 | $5.00 | Published (legacy plan) |
| App Platform `worker` | `basic-xxs` | $5.00/mo | 1 | $5.00 | Published (legacy plan) |
| App Platform `scheduler` worker | `basic-xxs` | $5.00/mo | 1 | $5.00 | Published (legacy plan) |
| App Platform `migrate` PRE_DEPLOY job | `basic-xxs`; billed only while running | $5.00/mo if continuous | 1 | $0.00 | Assumption (deploy-time only) |
| Managed DB cluster | `db-s-1vcpu-1gb` = 1 vCPU / 1 GiB, `node_count = 1` | $15.15/node/mo | 1 | $15.15 | Published price; slug↔size mapping assumed |
| Spaces bucket (app files) | `aquarela-staging-files`, private, versioned | $5.00/mo subscription | 1 | $5.00 | Published (shared subscription) |
| VPC | `aquarela-staging-vpc`, `ams3` | $0.00 | 1 | $0.00 | Published (free) |
| DO project | `aquarela-business-control-staging` | $0.00 | 1 | $0.00 | Published (free) |
| Monitoring alerts (4× DB) | CPU / memory / disk / load | $0.00 | 4 | $0.00 | Published (free) |
| DNS | `manage_dns = false` → 0 resources | $0.00 | 0 | $0.00 | Published (free) |
| Spaces key, DB users/pool/DB/firewall | scoped key, `app`/`migrator`, pool size 5, `aquarela-staging-db`, app firewall | $0.00 | — | $0.00 | Published (included) |

**Staging total: ~$35.15/month** (App Platform $15.00 + Managed DB $15.15 + Spaces $5.00).

## Production — `infra/envs/production/production.tfvars`

App Platform component subtotal **$65.00**.

| Resource (Terraform) | Spec (from tfvars) | Unit price | Qty | Monthly | Confidence |
| --- | --- | --- | --- | --- | --- |
| App Platform `web` service | `basic-s` (1 shared vCPU / 2 GiB) | $20.00/mo | 2 | $40.00 | Published (legacy plan); see variance |
| App Platform `worker` | `basic-s` | $20.00/mo | 1 | $20.00 | Published (legacy plan); see variance |
| App Platform `scheduler` worker | `basic-xxs` | $5.00/mo | 1 | $5.00 | Published (legacy plan) |
| App Platform `migrate` PRE_DEPLOY job | `basic-xxs`; billed only while running | $5.00/mo if continuous | 1 | $0.00 | Assumption (deploy-time only) |
| Managed DB cluster | `db-s-2vcpu-4gb` = 2 vCPU / 4 GiB, `node_count = 2` (HA) | $60.90/node/mo | 2 | $121.80 | Published price + published HA node rule; slug mapping assumed |
| Spaces bucket (app files) | `aquarela-production-files`, private, versioned | shared subscription | 0 (already counted) | $0.00 | Assumption (single team subscription) |
| VPC | `aquarela-production-vpc`, `ams3` | $0.00 | 1 | $0.00 | Published (free) |
| DO project | `aquarela-business-control-production` | $0.00 | 1 | $0.00 | Published (free) |
| Monitoring alerts (4× DB) | CPU / memory / disk / load | $0.00 | 4 | $0.00 | Published (free) |
| DNS | `manage_dns = false` → 0 resources | $0.00 | 0 | $0.00 | Published (free) |
| Spaces key, DB users/pool/DB/firewall | scoped key, `app`/`migrator`, pool size 20, `aquarela-production-db`, app firewall | $0.00 | — | $0.00 | Published (included) |

**Production total: ~$186.80/month** (App Platform $65.00 + Managed DB $121.80).

## Combined

| Environment | Monthly |
| --- | --- |
| Staging | $35.15 |
| Production | $186.80 |
| **Both, one Spaces subscription** | **$221.95** |
| Both, if Spaces billed separately per environment | $226.95 |

## Cost drivers

- **Production DB HA is the largest line — $121.80/mo, ~65% of production.** It is
  `node_count = 2` (primary + matching standby); the failure domain is the platform's, not a
  Terraform extra.
- **Production App Platform instances — $65.00/mo, ~35% of production.** The two `basic-s`
  web instances plus one `basic-s` worker dominate; `basic-s` is 4× `basic-xxs`.
- **Staging is almost entirely the DB + Spaces floor**, not compute (3 × `basic-xxs` = $15).
- **Scheduler as a long-lived worker** costs a full `basic-xxs` ($5) in each env purely because
  the Terraform provider has no `SCHEDULED` job kind (`infra/modules/app-platform/main.tf`).

## Cheapest levers

1. **Turn staging off between rehearsals** — destroy the staging app + DB and re-create on
   demand: saves **~$35.15/mo** (staging total). Highest-value, zero production impact.
2. **Drop production DB to `node_count = 1`** — saves **$60.90/mo**, but removes HA/PITR
   failover; not recommended for the system of record.
3. **Reduce production DB size** from `db-s-2vcpu-4gb` to `db-s-1vcpu-1gb` if capacity allows —
   saves **$91.50/mo** for the 2-node cluster; validate before relying on it.
4. **Production web `instance_count = 2 → 1`** — saves **$20.00/mo**, drops an instance from the
   rolling-deploy path.
5. **Production worker `basic-s → basic-xxs`** — saves **$15.00/mo**; re-measure queue drain first.
6. **Convert `scheduler` to a real `SCHEDULED` job** once the provider exposes it — saves
   **~$5/mo/env** because scheduled jobs bill only while running.

## Confidence and variance notes

- **Published prices:** App Platform `basic-xxs` $5.00 and `basic-s` $20.00 (legacy plan table);
  Managed DB 1 GiB/1 vCPU $15.15 and 4 GiB/2 vCPU $60.90; Spaces $5.00 subscription; all `$0.00`
  lines (VPC, project, monitoring, DNS, keys, pool, firewall).
- **Assumption — slug→size mapping.** Terraform uses legacy slugs `db-s-1vcpu-1gb` /
  `db-s-2vcpu-4gb`; the marketing page now shows sizes by vCPU/RAM, so the mapping is by
  vCPU/RAM (1 vCPU/1 GiB → $15.15; 2 vCPU/4 GiB → $60.90). The PostgreSQL docs page rounds
  these to "from $15.00" and "$30.00 per 2 GiB node" respectively.
- **Assumption — legacy App Platform plans.** `basic-xxs`/`basic-s` appear under *Legacy Plans*
  (apps created before 7 May 2024). The published legacy prices are used above. **Variance:** if
  DO maps them to current plans on a new app, `basic-s` becomes `apps-s-1vcpu-2gb` at **$25.00**,
  adding **$15.00/mo** to production (3 × $5) → **$201.80/mo**, and the legacy `basic-*` plans
  show *Manual Scaling: No*, which may reject `web_instance_count = 2`. Confirm at the
  credentialed plan/apply gate before relying on these numbers.
- **Assumption — `migrate` job cost ≈ $0.00.** PRE_DEPLOY jobs are billed only while they run
  (per-second, one-minute minimum). At ~1–2 minutes per deploy the monthly cost is fractions of
  a cent; it is shown as $0.00. It scales with deploy frequency, not uptime.
- **Assumption — Spaces counted once.** One $5/mo team subscription covers every bucket, so
  production shows $0.00 for Spaces. If the two environments live on separate DO teams, add
  $5.00 to production (combined $226.95).
- **Assumption — no overages.** Bandwidth and storage overage rates are listed above but not
  costed; validate against real usage after the first billing cycle.

## Not included

Taxes/VAT, domain registration, any existing account credit, one-off engineering time, DNS
registration fees, cross-region Spaces backup copies required by `docs/runbooks/deployment.md`
(the runbook's DR copy would add Spaces storage/egress), and the out-of-band Terraform state
buckets (already covered by the shared Spaces subscription).
