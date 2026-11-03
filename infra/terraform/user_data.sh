#!/bin/bash
set -euo pipefail
exec > /var/log/gym-tracker-setup.log 2>&1
echo "=== Gym Tracker Setup Started: $(date) ==="

DUCKDNS_TOKEN="${duckdns_token}"
DUCKDNS_SUBDOMAIN="${duckdns_subdomain}"
DOMAIN="$${DUCKDNS_SUBDOMAIN}.duckdns.org"
REPO_URL="${repo_url}"
GIT_BRANCH="${git_branch}"
ADMIN_LOGIN="${admin_login}"
BUCKET_NAME="${bucket_name}"
NAMESPACE="${namespace}"
USE_BLOCK_VOLUME="${use_block_volume}"
APP_DIR="/opt/gym-tracker"
DEPLOY_DIR="$APP_DIR/deploy"

# ── 1. System update & packages ───────────────────────────────────────────────
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git python3 python3-pip

# Add Docker's official repo
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Install OCI CLI (used by the backup cron to push dumps to Object Storage)
curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh \
  | bash -s -- --accept-all-defaults
export PATH="$PATH:/root/bin"
echo 'export PATH="$PATH:/root/bin"' >> /root/.bashrc

# ── 2. Optional block volume for Docker/Postgres data ─────────────────────────
if [ "$USE_BLOCK_VOLUME" = "true" ]; then
  echo "=== Waiting for block volume device ==="
  DEVICE=""
  for i in $(seq 1 60); do
    if [ -b /dev/oracleoci/oraclevdb ]; then
      DEVICE="/dev/oracleoci/oraclevdb"; break
    elif [ -b /dev/sdb ]; then
      DEVICE="/dev/sdb"; break
    fi
    echo "Attempt $i: device not found yet, waiting 10s..."
    sleep 10
  done

  if [ -z "$DEVICE" ]; then
    echo "ERROR: Block volume device not found after 10 minutes. Aborting."
    exit 1
  fi
  echo "Found block volume at $DEVICE"

  if ! blkid "$DEVICE" | grep -q ext4; then
    echo "Formatting $DEVICE as ext4..."
    mkfs.ext4 "$DEVICE"
  fi

  mkdir -p /data
  mount "$DEVICE" /data
  DEVICE_UUID=$(blkid -s UUID -o value "$DEVICE")
  echo "UUID=$DEVICE_UUID /data ext4 defaults,nofail 0 2" >> /etc/fstab

  # Point Docker's data-root at the block volume so named volumes persist there
  mkdir -p /data/docker
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<DOCKERJSON
{ "data-root": "/data/docker" }
DOCKERJSON
  echo "=== Block volume mounted at /data; Docker data-root set to /data/docker ==="
fi

systemctl enable docker
systemctl restart docker

# ── 3. Clone repository ───────────────────────────────────────────────────────
git clone --branch "$GIT_BRANCH" "$REPO_URL" "$APP_DIR"

# ── 4. Generate deploy/.env ───────────────────────────────────────────────────
# Caddy reads SITE_ADDRESS; setting it to the real domain triggers automatic
# Let's Encrypt HTTPS. Secrets are generated on the box and never leave it.
DB_PASSWORD=$(openssl rand -base64 48 | tr -d '=+/' | cut -c1-40)
JWT_SECRET=$(openssl rand -base64 48 | tr -d '=+/' | cut -c1-48)
cat > "$DEPLOY_DIR/.env" <<EOF
POSTGRES_USER=gym
POSTGRES_PASSWORD=$DB_PASSWORD
POSTGRES_DB=gym
JWT_SECRET=$JWT_SECRET
SITE_ADDRESS=$DOMAIN
ADMIN_LOGIN=$ADMIN_LOGIN
EOF
chmod 600 "$DEPLOY_DIR/.env"

# ── 5. DuckDNS IP registration ────────────────────────────────────────────────
# Caddy needs the domain to resolve to this VM before it can obtain a cert.
cat > /usr/local/bin/duckdns-update.sh <<'DUCKDNS'
#!/bin/bash
TOKEN="DUCKDNS_TOKEN_PLACEHOLDER"
SUBDOMAIN="DUCKDNS_SUBDOMAIN_PLACEHOLDER"
curl -s "https://www.duckdns.org/update?domains=$SUBDOMAIN&token=$TOKEN&ip=" > /var/log/duckdns.log
DUCKDNS
sed -i "s|DUCKDNS_TOKEN_PLACEHOLDER|$DUCKDNS_TOKEN|" /usr/local/bin/duckdns-update.sh
sed -i "s|DUCKDNS_SUBDOMAIN_PLACEHOLDER|$DUCKDNS_SUBDOMAIN|" /usr/local/bin/duckdns-update.sh
chmod +x /usr/local/bin/duckdns-update.sh
/usr/local/bin/duckdns-update.sh
echo "DuckDNS update result: $(cat /var/log/duckdns.log)"

# ── 6. Start the stack ────────────────────────────────────────────────────────
cd "$DEPLOY_DIR"
docker compose --env-file .env up -d --build
echo "=== Docker stack started ==="

# ── 7. pg_dump backup to Object Storage ───────────────────────────────────────
cat > /usr/local/bin/pg-backup.sh <<PGBACKUP
#!/bin/bash
set -euo pipefail
export PATH="\$PATH:/root/bin"
set -a; source $DEPLOY_DIR/.env; set +a
DATE=\$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="/tmp/gym_backup_\$DATE.sql.gz"
docker compose -f $DEPLOY_DIR/docker-compose.yml --env-file $DEPLOY_DIR/.env exec -T db \
  pg_dump -U "\$POSTGRES_USER" "\$POSTGRES_DB" | gzip > "\$BACKUP_FILE"
oci os object put \
  --bucket-name $BUCKET_NAME \
  --namespace-name $NAMESPACE \
  --name "backup-\$DATE.sql.gz" \
  --file "\$BACKUP_FILE" \
  --auth instance_principal
rm "\$BACKUP_FILE"
echo "Backup completed: backup-\$DATE.sql.gz"

# Keep only the last 30 backups
oci os object list --bucket-name $BUCKET_NAME --namespace-name $NAMESPACE \
  --auth instance_principal --all 2>/dev/null | \
  python3 -c "
import sys,json
items=json.load(sys.stdin)['data']
items.sort(key=lambda x: x['name'])
for item in items[:-30]:
    print(item['name'])
" | while read name; do
  oci os object delete --bucket-name $BUCKET_NAME --namespace-name $NAMESPACE \
    --name "\$name" --auth instance_principal --force 2>/dev/null || true
done
PGBACKUP
chmod +x /usr/local/bin/pg-backup.sh

# ── 8. Cron jobs ──────────────────────────────────────────────────────────────
(crontab -l 2>/dev/null || true; cat <<CRON
# DuckDNS: keep the IP fresh every 5 minutes
*/5 * * * * /usr/local/bin/duckdns-update.sh >> /var/log/duckdns.log 2>&1

# pg_dump backup: daily at 2 AM UTC
0 2 * * * /usr/local/bin/pg-backup.sh >> /var/log/pg-backup.log 2>&1
CRON
) | crontab -

echo "=== Cron jobs installed ==="
echo "=== Setup Complete: $(date) ==="
echo "=== App should be live at https://$DOMAIN ==="
