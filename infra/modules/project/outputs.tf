output "id" {
  description = "DO project UUID."
  value       = digitalocean_project.this.id
}

output "name" {
  description = "DO project name."
  value       = digitalocean_project.this.name
}
