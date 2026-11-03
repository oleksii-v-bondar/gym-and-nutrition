terraform {
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 6.37"
    }
  }
}

provider "oci" {
  tenancy_ocid = var.tenancy_ocid
  region       = var.region
  # Uses ~/.oci/config default profile — no credentials in code
}

# ── Data sources ──────────────────────────────────────────────────────────────

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

data "oci_core_images" "ubuntu_arm" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "22.04"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

data "oci_objectstorage_namespace" "ns" {
  compartment_id = var.tenancy_ocid
}

# ── Networking ────────────────────────────────────────────────────────────────
# A dedicated VCN keeps this stack fully isolated from any existing app in the
# same compartment (e.g. progress-app). Nothing here references or mutates
# resources outside this module.

resource "oci_core_vcn" "app" {
  compartment_id = var.compartment_ocid
  cidr_block     = var.vcn_cidr
  display_name   = "${var.name_prefix}-vcn"
  dns_label      = "gymtracker"
}

resource "oci_core_internet_gateway" "app" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.app.id
  display_name   = "${var.name_prefix}-igw"
}

resource "oci_core_route_table" "app" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.app.id
  display_name   = "${var.name_prefix}-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    network_entity_id = oci_core_internet_gateway.app.id
  }
}

resource "oci_core_security_list" "app" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.app.id
  display_name   = "${var.name_prefix}-sl"

  # Allow all outbound
  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }

  # SSH
  ingress_security_rules {
    protocol = "6" # TCP
    source   = "0.0.0.0/0"
    tcp_options {
      min = 22
      max = 22
    }
  }

  # HTTP (also used by Caddy for ACME HTTP-01 challenge)
  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 80
      max = 80
    }
  }

  # HTTPS
  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 443
      max = 443
    }
  }
}

resource "oci_core_subnet" "app" {
  compartment_id    = var.compartment_ocid
  vcn_id            = oci_core_vcn.app.id
  cidr_block        = var.subnet_cidr
  display_name      = "${var.name_prefix}-subnet"
  dns_label         = "app"
  route_table_id    = oci_core_route_table.app.id
  security_list_ids = [oci_core_security_list.app.id]
}

# ── Compute ───────────────────────────────────────────────────────────────────

resource "oci_core_instance" "app" {
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.ad_index].name
  compartment_id      = var.compartment_ocid
  display_name        = var.name_prefix
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = var.instance_ocpus
    memory_in_gbs = var.instance_memory_gbs
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu_arm.images[0].id
    boot_volume_size_in_gbs = var.boot_volume_size_gbs
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.app.id
    assign_public_ip = true
    display_name     = "${var.name_prefix}-vnic"
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data = base64encode(templatefile("${path.module}/user_data.sh", {
      duckdns_token     = var.duckdns_token
      duckdns_subdomain = var.duckdns_subdomain
      repo_url          = var.repo_url
      git_branch        = var.git_branch
      admin_login       = var.admin_login
      bucket_name       = oci_objectstorage_bucket.backups.name
      namespace         = data.oci_objectstorage_namespace.ns.namespace
      use_block_volume  = var.attach_block_volume
    }))
  }
}

# ── Block Volume (optional) ───────────────────────────────────────────────────
# Off by default: a gym-tracker Postgres DB fits comfortably on the boot volume,
# and skipping the extra volume keeps you within the OCI Always Free block-volume
# allowance that your existing app already consumes. Set attach_block_volume=true
# to provision and mount a dedicated data volume at /data.

resource "oci_core_volume" "data" {
  count               = var.attach_block_volume ? 1 : 0
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.ad_index].name
  compartment_id      = var.compartment_ocid
  display_name        = "${var.name_prefix}-data"
  size_in_gbs         = var.block_volume_size_gbs
}

resource "oci_core_volume_attachment" "data" {
  count           = var.attach_block_volume ? 1 : 0
  attachment_type = "paravirtualized"
  instance_id     = oci_core_instance.app.id
  volume_id       = oci_core_volume.data[0].id
  display_name    = "${var.name_prefix}-data-attachment"
}

# ── Object Storage ────────────────────────────────────────────────────────────

resource "oci_objectstorage_bucket" "backups" {
  compartment_id = var.compartment_ocid
  name           = "${var.name_prefix}-backups"
  namespace      = data.oci_objectstorage_namespace.ns.namespace
  access_type    = "NoPublicAccess"
  storage_tier   = "Standard"
}

# ── IAM: Instance Principal for Object Storage ────────────────────────────────
# Distinct names from any existing app so applying this never clobbers them.

resource "oci_identity_dynamic_group" "app_instance" {
  compartment_id = var.tenancy_ocid
  name           = "${var.name_prefix}-instances"
  description    = "Dynamic group for ${var.name_prefix} VM instance principal"
  matching_rule  = "instance.id = '${oci_core_instance.app.id}'"
}

resource "oci_identity_policy" "instance_object_storage" {
  compartment_id = var.tenancy_ocid
  name           = "${var.name_prefix}-instance-storage"
  description    = "Allow ${var.name_prefix} VM to write pg_dump backups to object storage"
  statements = [
    "Allow dynamic-group ${oci_identity_dynamic_group.app_instance.name} to manage objects in compartment id ${var.compartment_ocid} where target.bucket.name = '${oci_objectstorage_bucket.backups.name}'"
  ]
}
