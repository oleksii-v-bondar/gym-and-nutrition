# Gym Tracker — Oracle Cloud (OCI) deployment

Terraform that provisions a single Always-Free **ARM (A1.Flex)** VM on Oracle
Cloud and runs the app with Docker Compose. TLS is automatic: the app's
**Caddy** container provisions a Let's Encrypt certificate for your DuckDNS
domain — no nginx/certbot wiring required.

## Will this touch my existing OCI app?

**No.** This stack is designed to run alongside your existing deployment:

- It lives in **its own directory with its own local state** (`terraform.tfstate`
  here), so `terraform apply` only ever manages the resources defined here.
- Every resource is named with the `name_prefix` (default `gym-tracker-*`), and
  the VCN uses a separate CIDR (`10.1.0.0/16`), so nothing collides with your
  `progress-app` resources, dynamic groups, policies, or buckets.
- The optional data block volume is **off by default** to avoid consuming the
  Always Free block-volume allowance your existing app already uses.

> Always Free budget reminder: A1.Flex is capped at **4 OCPUs / 24 GB total**
> across *all* your ARM instances. With one existing 1-OCPU/6-GB app, a second
> 1-OCPU/6-GB VM (the default here) fits comfortably.

## What gets created

- VCN + public subnet + internet gateway + route table + security list
  (ingress 22/80/443)
- One `VM.Standard.A1.Flex` VM (Ubuntu 22.04 ARM), default 1 OCPU / 6 GB
- Object Storage bucket for nightly `pg_dump` backups
- A dynamic group + IAM policy letting the VM write backups via instance principal
- *(optional)* a block volume mounted at `/data` for Docker/Postgres data

On first boot the VM installs Docker, clones your repo, writes `deploy/.env`
with freshly generated Postgres and JWT secrets, points DuckDNS at its public
IP, and runs `docker compose up -d --build` from `deploy/`.

## Prerequisites

1. **OCI CLI config** at `~/.oci/config` (default profile) — the provider uses it.
2. **Terraform** ≥ 1.5 and the `oracle/oci` provider (installed by `init`).
3. A **DuckDNS** subdomain + token from <https://www.duckdns.org>.
4. An **SSH public key** for VM access.

## Usage

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # then edit values
terraform init
terraform apply
```

If ARM capacity is unavailable (`Out of host capacity`), use the retry helper,
which cycles availability domains until it succeeds:

```bash
./retry-instance.sh         # optionally add Telegram creds inside the script
```

After `apply`, Terraform prints the public IP and the `app_url`. DNS + the
Let's Encrypt cert take a minute or two on first boot; then visit:

```
https://<your-subdomain>.duckdns.org
```

## Useful outputs

| Output | Meaning |
| --- | --- |
| `app_url` | HTTPS URL the app is served at |
| `instance_public_ip` | VM public IP (DuckDNS is pointed here) |
| `ssh_command` | Ready-to-run SSH command |
| `object_storage_bucket_name` | Backup bucket name |

## Operating the VM

```bash
ssh ubuntu@<public-ip>
sudo tail -f /var/log/gym-tracker-setup.log         # first-boot provisioning log
cd /opt/gym-tracker/deploy
sudo docker compose ps                               # container status
sudo docker compose logs -f caddy                    # TLS / proxy logs
sudo /usr/local/bin/pg-backup.sh                     # run a backup on demand
```

Backups run nightly at 02:00 UTC and are pruned to the most recent 30 in the
Object Storage bucket.

## Updating the app

```bash
ssh ubuntu@<public-ip>
cd /opt/gym-tracker && sudo git pull
cd deploy && sudo docker compose --env-file .env up -d --build
```

## Tearing down (only this stack)

```bash
terraform destroy
```

This removes **only** the `gym-tracker-*` resources in this state file; your
existing app is unaffected.
