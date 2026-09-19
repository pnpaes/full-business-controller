# Partial S3 backend on DigitalOcean Spaces (matching the standard AWS S3
# backend). `bucket` and credentials are intentionally omitted so they are
# supplied at init time:
#
#   terraform init \
#     -backend-config="bucket=<state-bucket>" \
#     -backend-config="access_key=$SPACES_ACCESS_KEY_ID" \
#     -backend-config="secret_key=$SPACES_SECRET_KEY"
#
# or via the AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY environment variables.
# Never commit credentials here. Spaces has no native state locking, so `apply`
# is restricted to a single accountable CI runner (ADR-0012, runbook).
terraform {
  backend "s3" {
    endpoints = {
      s3 = "https://ams3.digitaloceanspaces.com"
    }
    region = "ams3"
    key    = "staging/terraform.tfstate"

    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}
