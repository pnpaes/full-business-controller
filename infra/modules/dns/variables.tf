variable "manage_dns" {
  description = "Create and manage the domain in DO DNS; false disables the module entirely."
  type        = bool
  default     = false
}

variable "domain_name" {
  description = "Apex domain to manage (required when manage_dns is true)."
  type        = string
  default     = null
}

variable "manage_www" {
  description = "Create a www CNAME in addition to the apex domain."
  type        = bool
  default     = false
}

variable "www_target" {
  description = "CNAME target for www (e.g. the app default_ingress); null points at the apex."
  type        = string
  default     = null
}

variable "ttl" {
  description = "TTL in seconds for the www record."
  type        = number
  default     = 1800
}
