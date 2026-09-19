output "cluster_id" {
  description = "Database cluster UUID (used by the firewall and monitoring)."
  value       = digitalocean_database_cluster.this.id
}

output "cluster_urn" {
  description = "Database cluster URN (for project resource attachment)."
  value       = digitalocean_database_cluster.this.urn
}

output "host" {
  description = "Private (VPC) hostname of the cluster."
  value       = digitalocean_database_cluster.this.private_host
}

output "port" {
  description = "Database port."
  value       = digitalocean_database_cluster.this.port
}

output "database_name" {
  description = "Logical database name."
  value       = digitalocean_database_db.this.name
}

output "app_user" {
  description = "Application runtime user name."
  value       = digitalocean_database_user.app.name
}

output "migrator_user" {
  description = "Migration user name."
  value       = digitalocean_database_user.migrator.name
}

# Pooled URL for the long-lived runtimes (web/worker/scheduler). Built by hand from
# the pooler's private host/port so it never leaves the VPC, with the password
# urlencoded to survive reserved characters.
#
# ponytail: the provider already exposes `private_uri` on the pool and cluster, but
# it does not urlencode the password for the DATABASE_URL contract, so the URL is
# assembled explicitly with urlencode() as the runbook requires.
output "database_url" {
  description = "Pooled (transaction mode) DATABASE_URL for app runtimes."
  value = format(
    "postgresql://%s:%s@%s:%s/%s?sslmode=require",
    digitalocean_database_user.app.name,
    urlencode(digitalocean_database_user.app.password),
    digitalocean_database_connection_pool.app.private_host,
    digitalocean_database_connection_pool.app.port,
    digitalocean_database_db.this.name,
  )
  sensitive = true
}

# Direct/session URL for the pre-deploy migration job only. drizzle-kit migrate
# cannot run through transaction pooling (the advisory lock and DDL would land on
# different backends), so migrations use the direct cluster endpoint and the
# dedicated migrator user.
output "database_migrations_url" {
  description = "Direct/session DATABASE_MIGRATIONS_URL for the pre-deploy migration job."
  value = format(
    "postgresql://%s:%s@%s:%s/%s?sslmode=require",
    digitalocean_database_user.migrator.name,
    urlencode(digitalocean_database_user.migrator.password),
    digitalocean_database_cluster.this.private_host,
    digitalocean_database_cluster.this.port,
    digitalocean_database_db.this.name,
  )
  sensitive = true
}
