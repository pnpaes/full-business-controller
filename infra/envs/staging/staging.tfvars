# Staging: smaller, single-node, auto-deploy. Non-secret values only — no tokens,
# passwords or webhook URLs here (supply those via the environment / TF_VAR_*).
environment             = "Staging"
project_name            = "aquarela-business-control-staging"
app_name                = "aquarela-staging"
database_name           = "aquarela-staging-db"
database_size           = "db-s-1vcpu-1gb"
database_node_count     = 1
bucket_name             = "aquarela-staging-files"
deploy_on_push          = true
web_instance_size       = "basic-xxs"
worker_instance_size    = "basic-xxs"
scheduler_instance_size = "basic-xxs"
migrate_instance_size   = "basic-xxs"
web_instance_count      = 1
pool_size               = 5
log_level               = "info"

# App-runtime wiring — both are per environment (empty adds no env var):
#   organization_id            — the id printed by the first-owner bootstrap
#                                (`npm run bootstrap`); safe to commit once known.
#                                Required wherever the scheduler or web runs — the
#                                scheduler exits 1 without it (a plan-time check
#                                warns, does not block; empty is only valid for
#                                environments that never run scheduler/web).
#   totp_secret_encryption_key — generated base64 32-byte key (required for MFA);
#                                a SECRET, so supply it via
#                                TF_VAR_totp_secret_encryption_key, never here
#                                (an empty assignment here would shadow the env var).
organization_id = ""
# totp_secret_encryption_key = ""
