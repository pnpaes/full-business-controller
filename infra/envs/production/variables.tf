variable "digitalocean_token" {
  description = "DO API token. Leave null to use DIGITALOCEAN_TOKEN from the environment."
  type        = string
  sensitive   = true
  default     = null
}

variable "region" {
  description = "DO region slug; ams3 everywhere per DEC-014 (EU/EEA)."
  type        = string
  default     = "ams3"
}

variable "environment" {
  description = "DO project environment label: Staging or Production."
  type        = string
  default     = "Production"
}

variable "project_name" {
  description = "DO project name."
  type        = string
  default     = "aquarela-business-control-production"
}

variable "app_name" {
  description = "App Platform app name."
  type        = string
  default     = "aquarela-production"
}

variable "database_name" {
  description = "Managed PostgreSQL cluster name."
  type        = string
  default     = "aquarela-production-db"
}

variable "database_size" {
  description = "Managed database size slug."
  type        = string
  default     = "db-s-2vcpu-4gb"
}

variable "database_node_count" {
  description = "Number of database nodes (1 staging, >=2 production HA)."
  type        = number
  default     = 2
}

variable "bucket_name" {
  description = "Globally unique Spaces bucket name for application files."
  type        = string
  default     = "aquarela-production-files"
}

variable "repo_owner" {
  description = "GitHub owner/org for the app source."
  type        = string
  default     = "aquarela"
}

variable "repo_name" {
  description = "GitHub repository name for the app source."
  type        = string
  default     = "business-controller"
}

variable "branch" {
  description = "Git branch App Platform deploys from."
  type        = string
  default     = "main"
}

variable "deploy_on_push" {
  description = "Auto-deploy on push to the branch (off in production)."
  type        = bool
  default     = false
}

variable "web_instance_size" {
  description = "Instance size slug for the web service."
  type        = string
  default     = "basic-s"
}

variable "worker_instance_size" {
  description = "Instance size slug for the worker."
  type        = string
  default     = "basic-s"
}

variable "scheduler_instance_size" {
  description = "Instance size slug for the scheduler worker."
  type        = string
  default     = "basic-xxs"
}

variable "migrate_instance_size" {
  description = "Instance size slug for the PRE_DEPLOY migration job."
  type        = string
  default     = "basic-xxs"
}

variable "web_instance_count" {
  description = "Number of web instances."
  type        = number
  default     = 2
}

variable "pool_size" {
  description = "Managed database connection pool size."
  type        = number
  default     = 20
}

variable "log_level" {
  description = "LOG_LEVEL injected into every component."
  type        = string
  default     = "info"
}

variable "domain_name" {
  description = "Custom primary domain; null creates none."
  type        = string
  default     = null
}

variable "manage_dns" {
  description = "Manage DNS (domain + www) in DO DNS; off by default."
  type        = bool
  default     = false
}

variable "admin_ip_addresses" {
  description = "Optional admin IP/CIDRs allowed to reach the database directly (empty = none)."
  type        = list(string)
  default     = []
}

variable "organization_id" {
  description = "Organization id the web app serves (printed by `npm run bootstrap`); empty adds no ORGANIZATION_ID env var."
  type        = string
  default     = null
}

variable "totp_secret_encryption_key" {
  description = "Base64-encoded 32-byte key sealing TOTP secrets at rest (required for MFA; secret — supply via TF_VAR_totp_secret_encryption_key, never commit). Empty adds no env var."
  type        = string
  sensitive   = true
  default     = null
}

variable "alert_email" {
  description = "Email addresses for DB and deployment alerts."
  type        = list(string)
  default     = []
}

variable "slack_webhook_url" {
  description = "Optional Slack webhook URL for alerts (secret; supply via TF_VAR_slack_webhook_url, never commit)."
  type        = string
  sensitive   = true
  default     = ""
}
