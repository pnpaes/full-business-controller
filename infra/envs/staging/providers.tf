terraform {
  required_version = ">= 1.6"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.101"
    }
  }
}

provider "digitalocean" {
  # Defaults to null so the provider reads DIGITALOCEAN_TOKEN from the environment.
  # A dummy value (e.g. dop_v1_dummy) is sufficient for `terraform plan -refresh=false`
  # offline; never commit a real token.
  token = var.digitalocean_token

  # Provider Spaces credentials, if ever needed, also come from the environment
  # (SPACES_ACCESS_KEY_ID / SPACES_SECRET_ACCESS_KEY) rather than this file.
}
