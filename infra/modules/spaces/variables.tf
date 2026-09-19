variable "name" {
  description = "Globally unique Spaces bucket name for application files."
  type        = string
}

variable "region" {
  description = "Spaces region slug; ams3 per DEC-014 (EU/EEA)."
  type        = string
  default     = "ams3"
}

variable "key_name" {
  description = "Name of the scoped Spaces access key granted readwrite on the bucket."
  type        = string
}

variable "versioning_enabled" {
  description = "Enable object versioning (keeps overwritten/deleted objects recoverable)."
  type        = bool
  default     = true
}

variable "lifecycle_expiration_days" {
  description = "Optional lifecycle expiration in days; null disables the lifecycle rule."
  type        = number
  default     = null
}
