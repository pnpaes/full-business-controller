output "vpc_id" {
  description = "VPC UUID (used as private_network_uuid on the DB cluster)."
  value       = digitalocean_vpc.this.id
}

output "vpc_urn" {
  description = "VPC URN."
  value       = digitalocean_vpc.this.urn
}

output "ip_range" {
  description = "Effective VPC CIDR."
  value       = digitalocean_vpc.this.ip_range
}
