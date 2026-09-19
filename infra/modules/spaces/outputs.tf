output "bucket_name" {
  description = "Application-files bucket name."
  value       = digitalocean_spaces_bucket.this.name
}

output "bucket_domain_name" {
  description = "Bucket FQDN (endpoint host) for the S3 API."
  value       = digitalocean_spaces_bucket.this.bucket_domain_name
}

output "bucket_urn" {
  description = "Bucket URN (for project resource attachment)."
  value       = digitalocean_spaces_bucket.this.urn
}

output "access_key_id" {
  description = "Spaces access key ID (injected into the app as SPACES_ACCESS_KEY_ID)."
  value       = digitalocean_spaces_key.app.access_key
}

output "secret_key" {
  description = "Spaces secret key (injected into the app as SPACES_SECRET_KEY)."
  value       = digitalocean_spaces_key.app.secret_key
  sensitive   = true
}
