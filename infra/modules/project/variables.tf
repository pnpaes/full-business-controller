variable "name" {
  description = "DO project name, unique per environment (e.g. aquarela-staging)."
  type        = string
}

variable "description" {
  description = "Human-readable project description."
  type        = string
  default     = ""
}

variable "purpose" {
  description = "DO project purpose."
  type        = string
  default     = "Web Application"
}

variable "environment" {
  description = "DO project environment: Development, Staging or Production."
  type        = string
  default     = "Staging"
}
