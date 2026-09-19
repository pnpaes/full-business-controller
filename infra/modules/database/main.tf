# Managed PostgreSQL 16 cluster, EU/EEA (ams3), attached to the VPC so it is not
# publicly reachable (ADR-0012). Backups/PITR are platform defaults for Managed DB.
#
# The database firewall is deliberately NOT in this module: it must reference the
# App Platform app ID, which depends on this cluster's outputs — keeping the
# firewall at the env root avoids a database -> app-platform -> database cycle.
resource "digitalocean_database_cluster" "this" {
  name                 = var.name
  engine               = "pg"
  version              = var.engine_version
  size                 = var.size
  region               = var.region
  node_count           = var.node_count
  private_network_uuid = var.vpc_uuid
  tags                 = var.tags
}

resource "digitalocean_database_db" "this" {
  cluster_id = digitalocean_database_cluster.this.id
  name       = var.db_name
}

# NOTE: DO API/console users get the `normal` role and no privileges; Terraform
# can create these users but cannot grant them. After the cluster and users exist
# and BEFORE the first deploy, run `infra/bootstrap/database-grants.sql` once as
# `doadmin` (see docs/runbooks/deployment.md -> "Database privilege bootstrap").
# The pre-deploy job runs as `migrator`; `app` only gets DML on migrator-owned
# objects.
#
# Application runtime user: used through the transaction pooler.
resource "digitalocean_database_user" "app" {
  cluster_id = digitalocean_database_cluster.this.id
  name       = var.app_user_name
}

# Dedicated migration user: least privilege; used only by the pre-deploy job.
resource "digitalocean_database_user" "migrator" {
  cluster_id = digitalocean_database_cluster.this.id
  name       = var.migrator_user_name
}

# Transaction-mode pool for the long-lived runtimes (web/worker/scheduler).
resource "digitalocean_database_connection_pool" "app" {
  cluster_id = digitalocean_database_cluster.this.id
  name       = var.pool_name
  mode       = "transaction"
  size       = var.pool_size
  db_name    = digitalocean_database_db.this.name
  user       = digitalocean_database_user.app.name
}
