# Production: larger, multi-node, no auto-deploy. Non-secret values only — no
# tokens, passwords or webhook URLs here (supply those via the environment /
# TF_VAR_*). Changing these sizes does not change the provider contract.
environment             = "Production"
project_name            = "aquarela-business-control-production"
app_name                = "aquarela-production"
database_name           = "aquarela-production-db"
database_size           = "db-s-2vcpu-4gb"
database_node_count     = 2
bucket_name             = "aquarela-production-files"
deploy_on_push          = false
web_instance_size       = "basic-s"
worker_instance_size    = "basic-s"
scheduler_instance_size = "basic-xxs"
migrate_instance_size   = "basic-xxs"
web_instance_count      = 2
pool_size               = 20
log_level               = "info"
