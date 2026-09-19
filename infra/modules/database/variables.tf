variable "name" {
  description = "Managed database cluster name (e.g. aquarela-staging-db)."
  type        = string
}

variable "db_name" {
  description = "Logical database name created inside the cluster."
  type        = string
  default     = "aquarela"
}

variable "region" {
  description = "DO region slug; ams3 per DEC-014 (EU/EEA)."
  type        = string
  default     = "ams3"
}

variable "size" {
  description = "Managed database size slug (e.g. db-s-1vcpu-1gb)."
  type        = string
}

variable "node_count" {
  description = "Number of nodes in the cluster (1 for staging, >=2 for production HA)."
  type        = number
  default     = 1
}

variable "engine_version" {
  description = "PostgreSQL major version."
  type        = string
  default     = "16"
}

variable "vpc_uuid" {
  description = "VPC UUID the cluster joins (private_network_uuid)."
  type        = string
}

variable "app_user_name" {
  description = "Application runtime database user."
  type        = string
  default     = "app"
}

variable "migrator_user_name" {
  description = "Migration database user (pre-deploy job only)."
  type        = string
  default     = "migrator"
}

variable "pool_name" {
  description = "Connection pool name."
  type        = string
  default     = "app"
}

variable "pool_size" {
  description = "Connection pool size (number of pooled connections per node)."
  type        = number
  default     = 10
}

variable "tags" {
  description = "Tags applied to the cluster (e.g. [\"<app>-<env>\"])."
  type        = list(string)
  default     = []
}
