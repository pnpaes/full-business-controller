output "project_id" {
  description = "DO project UUID."
  value       = module.project.id
}

output "vpc_id" {
  description = "VPC UUID."
  value       = module.networking.vpc_id
}

output "database_cluster_id" {
  description = "Managed database cluster UUID."
  value       = module.database.cluster_id
}

output "database_host" {
  description = "Private database host."
  value       = module.database.host
}

output "database_name" {
  description = "Logical database name."
  value       = module.database.database_name
}

output "bucket_name" {
  description = "Application-files bucket name."
  value       = module.spaces.bucket_name
}

output "app_id" {
  description = "App Platform app UUID."
  value       = module.app_platform.app_id
}

output "app_live_url" {
  description = "Live App Platform URL."
  value       = module.app_platform.live_url
}

output "app_default_ingress" {
  description = "Default App Platform ingress hostname."
  value       = module.app_platform.default_ingress
}

output "domain_name" {
  description = "Managed custom domain, or null."
  value       = module.dns.domain_name
}
