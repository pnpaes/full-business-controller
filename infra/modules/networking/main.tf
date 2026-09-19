# VPC that the Managed PostgreSQL cluster and App Platform app join, so the app
# reaches the database over private networking only (ADR-0012: not publicly reachable).
resource "digitalocean_vpc" "this" {
  name        = var.name
  region      = var.region
  description = var.description
  ip_range    = var.ip_range
}
