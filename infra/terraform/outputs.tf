output "instance_public_ip" {
  description = "Public IP of the app VM — DuckDNS is pointed here automatically"
  value       = oci_core_instance.app.public_ip
}

output "app_url" {
  description = "HTTPS URL where the app will be served (Caddy auto-provisions the certificate)"
  value       = "https://${var.duckdns_subdomain}.duckdns.org"
}

output "ssh_command" {
  description = "SSH command to connect to the VM"
  value       = "ssh ubuntu@${oci_core_instance.app.public_ip}"
}

output "object_storage_bucket_name" {
  description = "Name of the Object Storage bucket for pg_dump backups"
  value       = oci_objectstorage_bucket.backups.name
}

output "object_storage_namespace" {
  description = "Object Storage namespace"
  value       = data.oci_objectstorage_namespace.ns.namespace
}
