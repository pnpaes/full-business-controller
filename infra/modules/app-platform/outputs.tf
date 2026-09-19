output "app_id" {
  description = "App Platform app UUID (used as the `app` firewall rule value)."
  value       = digitalocean_app.this.id
}

output "app_urn" {
  description = "App Platform app URN (for project resource attachment)."
  value       = digitalocean_app.this.urn
}

output "default_ingress" {
  description = "Default ingress hostname (*.ondigitalocean.app)."
  value       = digitalocean_app.this.default_ingress
}

output "live_url" {
  description = "Live app URL."
  value       = digitalocean_app.this.live_url
}

output "live_domain" {
  description = "Live app domain."
  value       = digitalocean_app.this.live_domain
}
