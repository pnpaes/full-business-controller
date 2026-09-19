locals {
  env_slug = lower(var.environment)

  # Tag format "<app>": `app_name` already carries the environment (e.g.
  # aquarela-staging), so the tag stays stable and human-readable on its own.
  tags = [var.app_name]

  # Project resource attachment is assembled at the env root: attaching resources
  # touches several modules at once, so doing it here avoids inter-module cycles.
  project_resources = concat(
    [module.app_platform.app_urn],
    [module.database.cluster_urn],
    [module.spaces.bucket_urn],
    var.manage_dns ? [module.dns.domain_urn] : [],
  )
}

module "project" {
  source = "../../modules/project"

  name        = var.project_name
  description = "Aquarela Business Control (${var.environment})"
  purpose     = "Web Application"
  environment = var.environment
}

module "networking" {
  source = "../../modules/networking"

  name        = "${var.app_name}-vpc"
  region      = var.region
  description = "Private network for Aquarela Business Control (${var.environment})."
}

module "spaces" {
  source = "../../modules/spaces"

  name     = var.bucket_name
  region   = var.region
  key_name = "${var.app_name}-${local.env_slug}-app"
}

module "database" {
  source = "../../modules/database"

  name       = var.database_name
  region     = var.region
  size       = var.database_size
  node_count = var.database_node_count
  vpc_uuid   = module.networking.vpc_id
  pool_size  = var.pool_size
  tags       = local.tags
}

module "app_platform" {
  source = "../../modules/app-platform"

  app_name                = var.app_name
  region                  = var.region
  vpc_id                  = module.networking.vpc_id
  domain_name             = var.domain_name
  domain_zone             = var.manage_dns ? var.domain_name : null
  repo_owner              = var.repo_owner
  repo_name               = var.repo_name
  branch                  = var.branch
  deploy_on_push          = var.deploy_on_push
  web_instance_size       = var.web_instance_size
  worker_instance_size    = var.worker_instance_size
  scheduler_instance_size = var.scheduler_instance_size
  migrate_instance_size   = var.migrate_instance_size
  web_instance_count      = var.web_instance_count
  log_level               = var.log_level
  database_url            = module.database.database_url
  database_migrations_url = module.database.database_migrations_url
  spaces_access_key_id    = module.spaces.access_key_id
  spaces_secret_key       = module.spaces.secret_key
  alert_emails            = var.alert_email
  slack_webhook_url       = var.slack_webhook_url
}

module "monitoring" {
  source = "../../modules/monitoring"

  database_cluster_id = module.database.cluster_id
  alert_emails        = var.alert_email
  slack_webhook_url   = var.slack_webhook_url
}

module "dns" {
  source = "../../modules/dns"

  manage_dns  = var.manage_dns
  domain_name = var.domain_name
  manage_www  = var.manage_dns && var.domain_name != null
  www_target  = module.app_platform.default_ingress
}

# The database firewall references BOTH the cluster (database module) and the app
# (app-platform module). Keeping it at the env root avoids the cycle
# database -> app-platform -> database.
resource "digitalocean_database_firewall" "this" {
  cluster_id = module.database.cluster_id

  rule {
    type  = "app"
    value = module.app_platform.app_id
  }

  dynamic "rule" {
    for_each = var.admin_ip_addresses
    content {
      type  = "ip_addr"
      value = rule.value
    }
  }
}

resource "digitalocean_project_resources" "this" {
  project   = module.project.id
  resources = local.project_resources
}

# NOTE: this attachment is the single way the cluster joins the project — the
# database module no longer sets its own `project_id` (the two assignments were
# redundant).
