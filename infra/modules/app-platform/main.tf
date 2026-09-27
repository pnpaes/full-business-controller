locals {
  source_repo = "${var.repo_owner}/${var.repo_name}"

  # Shared RUN_TIME env for the long-lived components (web, worker, scheduler).
  # DATABASE_URL is the pooled URL; Spaces keys are scoped to the app bucket.
  runtime_env = [
    {
      key   = "DATABASE_URL"
      value = var.database_url
      scope = "RUN_TIME"
      type  = "SECRET"
    },
    {
      key   = "LOG_LEVEL"
      value = var.log_level
      scope = "RUN_TIME"
      type  = "GENERAL"
    },
    {
      key   = "SPACES_ACCESS_KEY_ID"
      value = var.spaces_access_key_id
      scope = "RUN_TIME"
      type  = "SECRET"
    },
    {
      key   = "SPACES_SECRET_KEY"
      value = var.spaces_secret_key
      scope = "RUN_TIME"
      type  = "SECRET"
    },
  ]

  # ORGANIZATION_ID — the one organization this install serves (printed by
  # `npm run bootstrap`). The web auth layer pins it, and the scheduler's
  # organization-scoped outbox replay requires it (it exits 1 without it).
  # `worker` reads neither, so it stays on the shared runtime_env. An
  # empty value adds nothing.
  organization_env = var.organization_id == null || var.organization_id == "" ? [] : [
    {
      key   = "ORGANIZATION_ID"
      value = var.organization_id
      scope = "RUN_TIME"
      type  = "GENERAL"
    },
  ]

  # Web-only runtime env: the shared runtime_env plus ORGANIZATION_ID and the
  # base64 32-byte key sealing TOTP secrets at rest.
  web_env = concat(
    local.runtime_env,
    local.organization_env,
    var.totp_secret_encryption_key == null || var.totp_secret_encryption_key == "" ? [] : [
      {
        key   = "TOTP_SECRET_ENCRYPTION_KEY"
        value = var.totp_secret_encryption_key
        scope = "RUN_TIME"
        type  = "SECRET"
      },
    ],
  )

  # Scheduler-only runtime env: the shared runtime_env plus ORGANIZATION_ID. The
  # scheduler registers the organization-scoped outbox replay cron and exits 1
  # without it, so it no longer uses the bare runtime_env. `worker` is unchanged.
  scheduler_env = concat(local.runtime_env, local.organization_env)

  # The migration job uses the DIRECT/session URL only (see the comment on the job).
  migrate_env = [
    {
      key   = "DATABASE_MIGRATIONS_URL"
      value = var.database_migrations_url
      scope = "RUN_TIME"
      type  = "SECRET"
    },
    {
      key   = "LOG_LEVEL"
      value = var.log_level
      scope = "RUN_TIME"
      type  = "GENERAL"
    },
  ]

  # Only add alert destinations when there is somewhere to send them.
  alert_destinations = length(var.alert_emails) > 0 || var.slack_webhook_url != "" ? [1] : []
}

# Plan-time guardrail (non-blocking) for the ORGANIZATION_ID requirement.
#
# `local.organization_env` silently omits ORGANIZATION_ID when the input is
# empty, but the scheduler component now exits 1 at boot without it (its
# organization-scoped outbox replay and payroll cron need the organization),
# and the web auth layer needs it too. An empty value is still allowed on
# purpose — environments that never run the scheduler/web rely on it, and the
# repo's offline `plan` with dummy/empty inputs must keep working — so this is
# a `check` (warning only), never a `validation`/`precondition` (hard fail).
check "organization_id_set" {
  assert {
    condition     = trimspace(coalesce(var.organization_id, "")) != ""
    error_message = "organization_id is empty: no ORGANIZATION_ID env var will be set. The scheduler component exits 1 at boot without it, and the web auth layer throws ConfigError(\"ORGANIZATION_ID is not set\") until it is set. Supply the id printed by `npm run bootstrap` — safe to commit in the env's tfvars once known."
  }
}

resource "digitalocean_app" "this" {
  spec {
    name   = var.app_name
    region = var.region

    vpc {
      id = var.vpc_id
    }

    # Custom primary domain is opt-in; without it the app keeps its
    # *.ondigitalocean.app ingress. `zone` enables DO-managed DNS when set.
    dynamic "domain" {
      for_each = var.domain_name == null ? [] : [var.domain_name]
      content {
        name = domain.value
        type = "PRIMARY"
        zone = var.domain_zone
      }
    }

    # Deployment-failure alert. Add a second `alert { rule = "DEPLOYMENT_LIVE" }`
    # block if per-deploy success notifications are wanted.
    alert {
      rule = "DEPLOYMENT_FAILED"

      dynamic "destinations" {
        for_each = local.alert_destinations
        content {
          emails = var.alert_emails

          dynamic "slack_webhooks" {
            for_each = var.slack_webhook_url == "" ? [] : [var.slack_webhook_url]
            content {
              channel = var.slack_channel
              url     = slack_webhooks.value
            }
          }
        }
      }
    }

    # web — Next.js UI and, for now, the co-located /api route handlers.
    service {
      name               = "web"
      instance_size_slug = var.web_instance_size
      instance_count     = var.web_instance_count
      dockerfile_path    = var.dockerfile_path
      source_dir         = var.source_dir
      http_port          = var.http_port
      run_command        = "npm run start --workspace @aquarela/web"

      github {
        repo           = local.source_repo
        branch         = var.branch
        deploy_on_push = var.deploy_on_push
      }

      health_check {
        http_path             = "/api/health"
        initial_delay_seconds = 20
        period_seconds        = 30
        timeout_seconds       = 5
        success_threshold     = 1
        failure_threshold     = 3
      }

      # Give in-flight requests time to finish on deploy; Next.js handles the drain.
      termination {
        drain_seconds        = 15
        grace_period_seconds = 30
      }

      dynamic "env" {
        for_each = local.web_env
        content {
          key   = env.value.key
          value = env.value.value
          scope = env.value.scope
          type  = env.value.type
        }
      }
    }

    # worker — Postgres-backed job queue + outbox consumers (ADR-0004).
    worker {
      name               = "worker"
      instance_size_slug = var.worker_instance_size
      instance_count     = 1
      dockerfile_path    = var.dockerfile_path
      source_dir         = var.source_dir
      run_command        = "npm run start --workspace @aquarela/worker"

      github {
        repo           = local.source_repo
        branch         = var.branch
        deploy_on_push = var.deploy_on_push
      }

      termination {
        grace_period_seconds = 30
      }

      dynamic "env" {
        for_each = local.runtime_env
        content {
          key   = env.value.key
          value = env.value.value
          scope = env.value.scope
          type  = env.value.type
        }
      }
    }

    # scheduler — cron-triggered work (month close, payroll-input report, forecasts).
    #
    # PROVIDER LIMITATION (verified against digitalocean/digitalocean v2.101.1): the
    # `job` block has no SCHEDULED kind — only PRE_DEPLOY / POST_DEPLOY / FAILED_DEPLOY.
    # The scheduler therefore runs as a long-lived worker with an internal tick loop.
    #
    # ponytail: a long-lived worker simulating cron is the smallest thing that works
    # today; upgrade path is the `job { kind = "SCHEDULED", schedule { cron = ... } }`
    # block below once the provider (or API/doctl) exposes it.
    # When the provider exposes SCHEDULED (or the component is managed via the API or
    # doctl), convert this block to:
    #
    #   job {
    #     name      = "scheduler"
    #     kind      = "SCHEDULED"
    #     schedule  = { cron = "0 * * * *", timezone = "Europe/Oslo" }
    #     run_command = "npm run start --workspace @aquarela/scheduler"
    #     ...
    #   }
    worker {
      name               = "scheduler"
      instance_size_slug = var.scheduler_instance_size
      instance_count     = 1
      dockerfile_path    = var.dockerfile_path
      source_dir         = var.source_dir
      run_command        = "npm run start --workspace @aquarela/scheduler"

      github {
        repo           = local.source_repo
        branch         = var.branch
        deploy_on_push = var.deploy_on_push
      }

      termination {
        grace_period_seconds = 30
      }

      dynamic "env" {
        for_each = local.scheduler_env
        content {
          key   = env.value.key
          value = env.value.value
          scope = env.value.scope
          type  = env.value.type
        }
      }
    }

    # migrate — the ONLY migration runner in the app.
    #
    # App Platform has no per-component job ownership, so "web-owned" migration means
    # exactly one PRE_DEPLOY job exists in this spec (per ADR-0012). Every other
    # component must never run migrations. It uses DATABASE_MIGRATIONS_URL (direct/
    # session) because transaction pooling breaks drizzle-kit migrate, and
    # `npm run db:migrate` is expected to hold a Postgres advisory lock.
    job {
      name               = "migrate"
      kind               = "PRE_DEPLOY"
      instance_size_slug = var.migrate_instance_size
      dockerfile_path    = var.dockerfile_path
      source_dir         = var.source_dir
      run_command        = "npm run db:migrate"

      github {
        repo           = local.source_repo
        branch         = var.branch
        deploy_on_push = var.deploy_on_push
      }

      dynamic "env" {
        for_each = local.migrate_env
        content {
          key   = env.value.key
          value = env.value.value
          scope = env.value.scope
          type  = env.value.type
        }
      }
    }

    # ---------------------------------------------------------------------------
    # NOT ACTIVE: the `api` component.
    #
    # `api` currently starts co-located inside `web` as Next.js route handlers
    # (/api/v1/...), so no separate component is created here. Split it out only
    # when a real driver appears (independent scaling, an auth/rate-limit boundary,
    # or a differing release cadence — ADR-0012). When that happens, add:
    #
    #   service {
    #     name               = "api"
    #     instance_size_slug = var.api_instance_size
    #     instance_count     = 1
    #     dockerfile_path    = var.dockerfile_path
    #     source_dir         = var.source_dir
    #     http_port          = 3001
    #     run_command        = "npm run start --workspace @aquarela/api"
    #     github { repo = local.source_repo; branch = var.branch; deploy_on_push = var.deploy_on_push }
    #     health_check { http_path = "/api/health"; ... }
    #     env { ... }  # same runtime_env as web
    #   }
    #
    # and split ingress with a spec.ingress block routing the /api/v1 path prefix to
    # `api` (and everything else to `web`), e.g.:
    #
    #   ingress {
    #     rule {
    #       match { path { prefix = "/api/v1" } }
    #       component { name = "api" }
    #     }
    #   }
    #
    # Also revisit session-cookie scoping and CORS/CSRF for the split.
    # ---------------------------------------------------------------------------
  }
}
