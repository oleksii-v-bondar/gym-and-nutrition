# Co-hosting the gym app on your existing OCI VM

ARM (A1.Flex) capacity is often exhausted ("Out of host capacity"), which makes
a brand-new instance hard to get. Instead you can run the gym app **on the same
VM** that already runs `progress-dashboard` — no new instance required.

Only one process can own ports 80/443, and your existing **nginx container**
already does. So the gym app runs as extra containers that do **not** bind
80/443; your nginx terminates TLS for a second domain and reverse-proxies it to
the gym's internal Caddy over a shared Docker network.

```
Internet ──443──▶ nginx container (existing)
                   ├── progress.duckdns.org      ──▶ frontend / backend
                   └── gym-and-nutrition.duckdns.org ──▶ gym (Caddy) ──▶ api / SPA
                                   (shared "edge" docker network)
```

The gym runs its **own** Postgres, isolated from progress-dashboard. The project
name is pinned to `gym-tracker`, so nothing collides with the existing app.

---

## Prerequisites (already true on the progress-dashboard VM)

- Docker + compose plugin
- nginx running as a container from `docker-compose.prod.yml`, mounting
  `/etc/letsencrypt` (host) read-only
- certbot with the `dns-duckdns` plugin and `/etc/duckdns-certbot.ini`
- The same DuckDNS account/token as the existing app

All commands below run **on the VM** (`ssh ubuntu@<vm-ip>`), as root/sudo.

---

## 1. Point a second DuckDNS subdomain at this VM

One token covers all your subdomains. Set the new one to this VM's IP:

```bash
curl "https://www.duckdns.org/update?domains=gym-and-nutrition&token=<YOUR_DUCKDNS_TOKEN>&ip="
```

(Optional, for a dynamic IP) add it to the existing DuckDNS cron by appending
`,gym-and-nutrition` to the `domains=` list in `/usr/local/bin/duckdns-update.sh`.

## 2. Get the app onto the VM

```bash
sudo git clone --branch main https://github.com/oleksii-v-bondar/gym-and-nutrition.git /opt/gym-tracker
cd /opt/gym-tracker/deploy
sudo cp cohost/.env.example cohost/.env
sudo nano cohost/.env     # set strong POSTGRES_PASSWORD and JWT_SECRET; keep SITE_ADDRESS=:80
sudo chmod 600 cohost/.env
```

## 3. Create the shared network and start the gym stack

```bash
docker network create edge 2>/dev/null || true
cd /opt/gym-tracker/deploy
sudo docker compose -f docker-compose.cohost.yml --env-file cohost/.env up -d --build
```

Check it: `sudo docker compose -f docker-compose.cohost.yml ps` — `db`, `api`,
`web-build`, and `caddy` should be up.

## 4. Issue a TLS certificate for the new domain

Reuse the existing DuckDNS credentials file:

```bash
sudo certbot certonly \
  --authenticator dns-duckdns \
  --dns-duckdns-credentials /etc/duckdns-certbot.ini \
  --dns-duckdns-propagation-seconds 60 \
  -d gym-and-nutrition.duckdns.org \
  --non-interactive --agree-tos \
  --email admin@gym-and-nutrition.duckdns.org --no-eff-email
```

The cert lands in `/etc/letsencrypt/live/gym-and-nutrition.duckdns.org/`, which
is already mounted into the nginx container. `certbot renew` (your existing
cron) will renew it automatically.

## 5. Wire the gym domain into the existing nginx

Edit `progress-dashboard`'s `docker-compose.prod.yml` nginx service — this is
**additive** and does not change existing routing. Add one volume and attach the
`edge` network:

```yaml
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
      - /opt/gym-tracker/deploy/cohost/nginx-gym.conf:/etc/nginx/conf.d/gym.conf:ro   # ← add
    networks:          # ← add (keeps default so backend/frontend still resolve)
      - default
      - edge
    depends_on:
      - backend
      - frontend
    restart: unless-stopped
```

And declare the external network at the bottom of that same compose file:

```yaml
networks:
  edge:
    external: true
```

Apply (recreates only nginx):

```bash
cd /path/to/progress-dashboard
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Validate and reload if needed:

```bash
sudo docker compose -f docker-compose.prod.yml exec nginx nginx -t
sudo docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

## 6. Verify

Visit `https://gym-and-nutrition.duckdns.org`. The SPA loads and `/api/*` works.

```bash
curl -I https://gym-and-nutrition.duckdns.org
```

---

## Updating the gym app

```bash
cd /opt/gym-tracker && sudo git pull
cd deploy && sudo docker compose -f docker-compose.cohost.yml --env-file cohost/.env up -d --build
```

## Optional: nightly backup of the gym DB

The VM already has the OCI CLI + instance principal. Dump the gym DB to your
existing backup bucket (replace `<BUCKET>`/`<NAMESPACE>`):

```bash
cat > /usr/local/bin/gym-backup.sh <<'SH'
#!/bin/bash
set -euo pipefail
export PATH="$PATH:/root/bin"
set -a; source /opt/gym-tracker/deploy/cohost/.env; set +a
DATE=$(date +%Y%m%d-%H%M%S)
F="/tmp/gym_backup_$DATE.sql.gz"
docker compose -f /opt/gym-tracker/deploy/docker-compose.cohost.yml --env-file /opt/gym-tracker/deploy/cohost/.env \
  exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$F"
oci os object put --bucket-name <BUCKET> --namespace-name <NAMESPACE> \
  --name "gym-backup-$DATE.sql.gz" --file "$F" --auth instance_principal
rm "$F"
SH
chmod +x /usr/local/bin/gym-backup.sh
(crontab -l 2>/dev/null; echo "30 2 * * * /usr/local/bin/gym-backup.sh >> /var/log/gym-backup.log 2>&1") | crontab -
```

## Resources

One 1-OCPU / 6-GB VM now runs two Postgres + two app stacks. For low personal
traffic that's fine. If it feels tight, resize the A1.Flex instance up to
**2 OCPU / 12 GB** (still within the Always Free 4-OCPU / 24-GB ARM allowance)
in the OCI console or via the progress-dashboard Terraform `shape_config`.

## Teardown (gym only)

```bash
cd /opt/gym-tracker/deploy
sudo docker compose -f docker-compose.cohost.yml --env-file cohost/.env down   # add -v to drop the gym DB volume
```

Then remove the `gym.conf` volume line + `edge` network from the nginx service
and re-apply. The existing app is unaffected throughout.
