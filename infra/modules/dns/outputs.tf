output "domain_name" {
  description = "Managed apex domain, or null when manage_dns is false."
  value       = try(digitalocean_domain.this[0].name, null)
}

output "domain_urn" {
  description = "Managed domain URN, or null when manage_dns is false."
  value       = try(digitalocean_domain.this[0].urn, null)
}

output "www_fqdn" {
  description = "FQDN of the www record, or null when not created."
  value       = try(digitalocean_record.www[0].fqdn, null)
}
