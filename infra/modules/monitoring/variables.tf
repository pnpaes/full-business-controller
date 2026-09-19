variable "database_cluster_id" {
  description = "Managed database cluster UUID to monitor."
  type        = string
}

variable "alert_emails" {
  description = "Email addresses for DB alerts."
  type        = list(string)
  default     = []
}

variable "slack_webhook_url" {
  description = "Optional Slack webhook URL for DB alerts (secret; supplied out of band)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "slack_channel" {
  description = "Slack channel used when a webhook is configured."
  type        = string
  default     = "#alerts"
}

variable "enabled" {
  description = "Whether the DB alerts are active."
  type        = bool
  default     = true
}

variable "cpu_threshold" {
  description = "CPU utilization percentage that triggers the alert."
  type        = number
  default     = 80
}

variable "memory_threshold" {
  description = "Memory utilization percentage that triggers the alert."
  type        = number
  default     = 80
}

variable "disk_threshold" {
  description = "Disk utilization percentage that triggers the alert."
  type        = number
  default     = 80
}

variable "load15_threshold" {
  description = "15-minute load average that triggers the alert."
  type        = number
  default     = 4
}
