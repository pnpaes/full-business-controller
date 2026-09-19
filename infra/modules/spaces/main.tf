# Private S3-compatible bucket for application files (ADR-0006: files are private,
# served via short-lived signed URLs; buckets are never public; AMS3 per DEC-014).
#
# NOTE: the Terraform *remote-state* bucket is provisioned OUT OF BAND (doctl/console),
# not by this module, so that `terraform init` can read state before this stack exists.
# Only the application-files bucket is managed here.
resource "digitalocean_spaces_bucket" "this" {
  name   = var.name
  region = var.region
  acl    = "private"

  versioning {
    enabled = var.versioning_enabled
  }

  dynamic "lifecycle_rule" {
    for_each = var.lifecycle_expiration_days == null ? [] : [1]
    content {
      enabled = true
      expiration {
        days = var.lifecycle_expiration_days
      }
    }
  }
}

# ponytail: one optional blanket expiration rule only. Per-prefix/per-file-class
# retention (ADR-0006) belongs in the application layer or a later lifecycle_rule
# if the bucket-level rule proves insufficient.

# Scoped Spaces key granting the app read/write on this bucket only
# (least privilege; credentials are injected into App Platform as encrypted env vars).
resource "digitalocean_spaces_key" "app" {
  name = var.key_name

  grant {
    bucket     = digitalocean_spaces_bucket.this.name
    permission = "readwrite"
  }
}
