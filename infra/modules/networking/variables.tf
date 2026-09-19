variable "name" {
  description = "VPC name, unique per region (e.g. aquarela-staging-vpc)."
  type        = string
}

variable "region" {
  description = "DO region slug; ams3 everywhere per DEC-014 (EU/EEA)."
  type        = string
  default     = "ams3"
}

variable "description" {
  description = "Human-readable VPC description."
  type        = string
  default     = ""
}

variable "ip_range" {
  description = "Optional RFC1918 CIDR for the VPC; null lets DO pick the default."
  type        = string
  default     = null
}
