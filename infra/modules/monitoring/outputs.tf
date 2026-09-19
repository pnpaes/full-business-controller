output "alert_ids" {
  description = "Map of alert key (cpu/memory/disk/load) to DO Monitoring alert UUID."
  value       = { for k, v in digitalocean_monitor_alert.database : k => v.uuid }
}
