# Database health alerts via DO Monitoring's DBaaS alert types. These cover the
# cluster itself (CPU/memory/disk/load).
#
# NOT covered here: application errors, request latency and queue depth/job age.
# Those signals come from the App Platform app-spec `alert` blocks (see the
# app-platform module) and the DO log sink (pino structured logs), not from
# `digitalocean_monitor_alert` on the DB cluster.
#
# ponytail: four fixed threshold-based DB alerts are enough for now; add per-metric
# `tags`-based alert variants only when a real incident needs them.
locals {
  db_alerts = {
    cpu = {
      type        = "v1/dbaas/alerts/cpu_alerts"
      description = "PostgreSQL CPU utilization"
      compare     = "GreaterThan"
      value       = var.cpu_threshold
      window      = "5m"
    }
    memory = {
      type        = "v1/dbaas/alerts/memory_utilization_alerts"
      description = "PostgreSQL memory utilization"
      compare     = "GreaterThan"
      value       = var.memory_threshold
      window      = "5m"
    }
    disk = {
      type        = "v1/dbaas/alerts/disk_utilization_alerts"
      description = "PostgreSQL disk utilization"
      compare     = "GreaterThan"
      value       = var.disk_threshold
      window      = "5m"
    }
    load = {
      type        = "v1/dbaas/alerts/load_15_alerts"
      description = "PostgreSQL 15-minute load average"
      compare     = "GreaterThan"
      value       = var.load15_threshold
      window      = "10m"
    }
  }
}

resource "digitalocean_monitor_alert" "database" {
  for_each = local.db_alerts

  type        = each.value.type
  description = each.value.description
  compare     = each.value.compare
  value       = each.value.value
  window      = each.value.window
  entities    = [var.database_cluster_id]
  enabled     = var.enabled

  alerts {
    email = var.alert_emails

    dynamic "slack" {
      for_each = var.slack_webhook_url == "" ? [] : [var.slack_webhook_url]
      content {
        channel = var.slack_channel
        url     = slack.value
      }
    }
  }
}
