variable "tenancy_ocid" {
  description = "OCID of your OCI tenancy"
  type        = string
}

variable "compartment_ocid" {
  description = "OCID of the compartment to deploy into (can be the same compartment as your existing app — this stack is isolated by name)"
  type        = string
}

variable "region" {
  description = "OCI region (e.g. eu-frankfurt-1, us-ashburn-1)"
  type        = string
}

variable "ssh_public_key" {
  description = "SSH public key string for VM access (e.g. 'ssh-ed25519 AAAA...')"
  type        = string
}

variable "duckdns_token" {
  description = "DuckDNS API token from duckdns.org"
  type        = string
  sensitive   = true
}

variable "duckdns_subdomain" {
  description = "DuckDNS subdomain (just the name, not .duckdns.org). Caddy auto-provisions HTTPS for <subdomain>.duckdns.org"
  type        = string
}

variable "repo_url" {
  description = "Git repository URL to clone on the VM (https or ssh)"
  type        = string
}

variable "git_branch" {
  description = "Git branch to deploy"
  type        = string
  default     = "main"
}

variable "admin_login" {
  description = "Login name that should have admin rights in the app (maps to ADMIN_LOGIN)"
  type        = string
  default     = "ascererak"
}

variable "name_prefix" {
  description = "Prefix for all resource names. Keep it distinct from any existing deployment so nothing collides."
  type        = string
  default     = "gym-tracker"
}

variable "ad_index" {
  description = "Availability domain index (0, 1, or 2). Single-AD regions only have index 0."
  type        = number
  default     = 0
}

variable "instance_ocpus" {
  description = "OCPUs for the A1.Flex VM (Always Free allows up to 4 total across all A1 instances)"
  type        = number
  default     = 1
}

variable "instance_memory_gbs" {
  description = "Memory in GB for the A1.Flex VM (Always Free allows up to 24 total across all A1 instances)"
  type        = number
  default     = 6
}

variable "boot_volume_size_gbs" {
  description = "Boot volume size in GB (also holds Docker volumes when attach_block_volume = false)"
  type        = number
  default     = 50
}

variable "attach_block_volume" {
  description = "Attach a dedicated block volume mounted at /data for Docker/Postgres data. Off by default to respect the Always Free block-volume allowance your existing app already uses."
  type        = bool
  default     = false
}

variable "block_volume_size_gbs" {
  description = "Size of the optional data block volume (only used when attach_block_volume = true)"
  type        = number
  default     = 50
}

variable "vcn_cidr" {
  description = "CIDR block for this stack's VCN (kept separate from other VCNs)"
  type        = string
  default     = "10.1.0.0/16"
}

variable "subnet_cidr" {
  description = "CIDR block for the public subnet"
  type        = string
  default     = "10.1.1.0/24"
}
