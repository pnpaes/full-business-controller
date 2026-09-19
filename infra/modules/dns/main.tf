# Opt-in DNS management (manage_dns=false by default): the module is valid and
# creates nothing unless explicitly enabled, so environments using external DNS
# (or no custom domain yet) are unaffected.
resource "digitalocean_domain" "this" {
  count = var.manage_dns ? 1 : 0
  name  = var.domain_name
}

# Optional www CNAME. When www_target is null it points at the apex domain; pass
# the App Platform default_ingress to point www directly at the app.
resource "digitalocean_record" "www" {
  count = var.manage_dns && var.manage_www ? 1 : 0

  domain = digitalocean_domain.this[0].name
  type   = "CNAME"
  name   = "www"
  value  = coalesce(var.www_target, var.domain_name)
  ttl    = var.ttl
}
