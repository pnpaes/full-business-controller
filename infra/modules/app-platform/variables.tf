variable "app_name" {
  description = "App Platform app name (unique per project)."
  type        = string
}

variable "region" {
  description = "App Platform region slug; ams3 per DEC-014."
  type        = string
  default     = "ams3"
}

variable "vpc_id" {
  description = "VPC UUID the app joins for private DB access."
  type        = string
}

variable "domain_name" {
  description = "Custom primary domain; null keeps only the *.ondigitalocean.app ingress."
  type        = string
  default     = null
}

variable "domain_zone" {
  description = "DO-managed DNS zone for the domain (usually the domain itself); null = external DNS."
  type        = string
  default     = null
}

variable "repo_owner" {
  description = "GitHub owner/org for the app source."
  type        = string
}

variable "repo_name" {
  description = "GitHub repository name for the app source."
  type        = string
}

variable "branch" {
  description = "Git branch App Platform deploys from."
  type        = string
  default     = "main"
}

variable "deploy_on_push" {
  description = "Auto-deploy on push to the branch."
  type        = bool
  default     = false
}

variable "dockerfile_path" {
  description = "Path to the parameterized monorepo Dockerfile, relative to source_dir."
  type        = string
  default     = "Dockerfile"
}

variable "source_dir" {
  description = "Source directory within the repo; '.' for the monorepo root."
  type        = string
  default     = "."
}

variable "http_port" {
  description = "Port the web service listens on."
  type        = number
  default     = 3000
}

variable "web_instance_size" {
  description = "Instance size slug for the web service."
  type        = string
  default     = "basic-xxs"
}

variable "web_instance_count" {
  description = "Number of web instances."
  type        = number
  default     = 1
}

variable "worker_instance_size" {
  description = "Instance size slug for the worker."
  type        = string
  default     = "basic-xxs"
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

variable "log_level" {
  description = "LOG_LEVEL injected into every component."
  type        = string
  default     = "info"
}

variable "database_url" {
  description = "Pooled DATABASE_URL for runtimes (from the database module)."
  type        = string
  sensitive   = true
}

variable "database_migrations_url" {
  description = "Direct/session DATABASE_MIGRATIONS_URL for the migration job."
  type        = string
  sensitive   = true
}

variable "spaces_access_key_id" {
  description = "Scoped Spaces access key ID."
  type        = string
  sensitive   = true
}

variable "spaces_secret_key" {
  description = "Scoped Spaces secret key."
  type        = string
  sensitive   = true
}

variable "organization_id" {
  description = "Organization id this install serves (printed by `npm run bootstrap`); empty adds no ORGANIZATION_ID env var."
  type        = string
  default     = null
}

variable "totp_secret_encryption_key" {
  description = "Base64-encoded 32-byte key sealing TOTP secrets at rest (required for MFA); empty adds no env var."
  type        = string
  sensitive   = true
  default     = null
}

variable "alert_emails" {
  description = "Email addresses for App Platform deployment alerts."
  type        = list(string)
  default     = []
}

variable "slack_webhook_url" {
  description = "Optional Slack webhook URL for App Platform deployment alerts (secret; supplied out of band)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "slack_channel" {
  description = "Slack channel used by alert destinations when a webhook is configured."
  type        = string
  default     = "#alerts"
}
