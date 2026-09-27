#!/usr/bin/env bash
#
# Idempotent first-run bootstrap for the single-VM deployment
# (deploy/docker-compose.prod.yml). Run as root on a fresh Ubuntu 22.04/24.04
# droplet:
#
#   sudo deploy/bootstrap-vm.sh
#
# It installs Docker Engine + the Compose plugin, prepares the DO volume mount
# point and a 2 GB swap file, builds the image, brings Postgres up first, runs the
# migrator and the first-owner bootstrap, then starts the rest of the stack. Every
# step fails closed: a failure stops the script with a non-zero exit and no
# further mutation.
#
# Attaching the DigitalOcean volume (do this once, BEFORE the first run):
#   1. In the DO console: create a volume (e.g. aquarela-data) in the droplet's
#      region and attach it to the droplet.
#   2. The device appears as /dev/disk/by-id/scsi-0DO_Volume_aquarela-data.
#      Format it (ONLY the first time, and only if it is empty):
#        sudo mkfs.ext4 -F /dev/disk/by-id/scsi-0DO_Volume_aquarela-data
#   3. Mount it at /srv/aquarela and persist it across reboots:
#        sudo mkdir -p /srv/aquarela
#        sudo mount -o discard,defaults /dev/disk/by-id/scsi-0DO_Volume_aquarela-data /srv/aquarela
#        echo '/dev/disk/by-id/scsi-0DO_Volume_aquarela-data /srv/aquarela ext4 discard,defaults,nofail 0 2' | sudo tee -a /etc/fstab
#   4. Verify with `findmnt /srv/aquarela` (must show the volume device, NOT overlay
#      or the root disk).
#
# Set ALLOW_ROOT_DISK=1 to stage the stack on the droplet's own root disk (test
# only — data is lost if the droplet is rebuilt).
#
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_ROOT="${AQUARELA_DATA_ROOT:-/srv/aquarela}"
ENV_FILE="$DEPLOY_DIR/.env.prod"
ENV_EXAMPLE="$DEPLOY_DIR/.env.prod.example"
IMAGE_TAG="aquarela-app:latest"
HEALTH_TIMEOUT_S="${HEALTH_TIMEOUT_S:-300}"

log() { printf '\n\033[1;34m[%s]\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() { printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "run this script as root (sudo $0)"

COMPOSE=(docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/docker-compose.prod.yml" --env-file "$ENV_FILE")

# --- 1. Env file -----------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  log "deploy/.env.prod is absent; copying the example"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  fail "populate $ENV_FILE (fill every CHANGE_ME and DATABASE_URL password), then re-run"
fi
chmod 600 "$ENV_FILE"

# Read a value without sourcing the file (values may contain spaces or `<>`).
env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }

require_env() {
  local key="$1" value
  value="$(env_value "$key")"
  [ -n "$value" ] || fail "$key is empty in $ENV_FILE"
  case "$value" in
    *CHANGE_ME*) fail "$key still holds the example placeholder in $ENV_FILE" ;;
  esac
}

for key in CADDY_DOMAIN POSTGRES_PASSWORD DATABASE_URL DATABASE_MIGRATIONS_URL \
  TOTP_SECRET_ENCRYPTION_KEY BOOTSTRAP_ORGANIZATION_NAME; do
  require_env "$key"
done
if [ -z "$(env_value BOOTSTRAP_OWNER_EMAIL)$(env_value BOOTSTRAP_OWNER_USERNAME)" ]; then
  fail "set BOOTSTRAP_OWNER_EMAIL or BOOTSTRAP_OWNER_USERNAME in $ENV_FILE"
fi

# --- 2. Docker Engine + Compose plugin ------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "installing Docker Engine + Compose plugin"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  log "Docker already installed"
fi
systemctl enable --now docker
docker compose version >/dev/null 2>&1 || fail "docker compose plugin is unavailable"

# --- 3. Volume mount point -------------------------------------------------------
mkdir -p "$DATA_ROOT/pgdata" "$DATA_ROOT/uploads" "$DATA_ROOT/caddy/data" "$DATA_ROOT/caddy/config" "$DATA_ROOT/backups"
if mountpoint -q "$DATA_ROOT"; then
  log "$DATA_ROOT is a mounted volume"
elif [ "${ALLOW_ROOT_DISK:-0}" = "1" ]; then
  log "WARNING: $DATA_ROOT is NOT a separate volume (ALLOW_ROOT_DISK=1); data lives on the root disk"
else
  fail "$DATA_ROOT is not a mount point. Attach and mount the DO volume first (see the header of this script), or set ALLOW_ROOT_DISK=1 for a test install."
fi
# Postgres runs as uid 999 in postgres:16-alpine and chowns its own PGDATA when it
# starts as root; the app runs as uid 1001 (the Dockerfile's `nextjs` user) and
# cannot chown a bind mount itself, so the uploads directory must be owned by it.
chown -R 1001:1001 "$DATA_ROOT/uploads"
chmod 750 "$DATA_ROOT/uploads"

# --- 4. Swap ---------------------------------------------------------------------
if ! swapon --show | grep -q .; then
  log "creating a 2 GB swap file (the box has 2 GB RAM)"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  log "swap already configured"
fi

# --- 5. Build the image ----------------------------------------------------------
log "building $IMAGE_TAG (one vCPU; this takes a while)"
"${COMPOSE[@]}" build web

# --- 6. Postgres first, wait healthy --------------------------------------------
log "starting Postgres"
"${COMPOSE[@]}" up -d postgres

wait_healthy() {
  local service="$1" id status waited=0
  while :; do
    id="$("${COMPOSE[@]}" ps -q "$service")"
    [ -n "$id" ] || fail "$service container did not start"
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")"
    if [ "$status" = "healthy" ]; then
      log "$service is healthy"
      return 0
    fi
    [ "$status" = "unhealthy" ] && fail "$service reported unhealthy; check: docker compose -f $DEPLOY_DIR/docker-compose.prod.yml logs $service"
    [ "$waited" -ge "$HEALTH_TIMEOUT_S" ] && fail "timed out waiting for $service to become healthy"
    sleep 5
    waited=$((waited + 5))
  done
}
wait_healthy postgres

# --- 7. Migrate (idempotent) -----------------------------------------------------
log "running db:migrate (drizzle + pgboss provisioning)"
"${COMPOSE[@]}" run --rm -T web npm run db:migrate

# --- 8. Bootstrap the first owner (idempotent) -----------------------------------
log "running the first-owner bootstrap"
set +e
BOOTSTRAP_OUT="$("${COMPOSE[@]}" run --rm -T web npm run bootstrap 2>&1)"
BOOTSTRAP_RC=$?
set -e
printf '%s\n' "$BOOTSTRAP_OUT"
ORG_ID="$(printf '%s\n' "$BOOTSTRAP_OUT" | sed -n 's/^  organization: \([0-9a-fA-F-]\{36\}\).*/\1/p' | tail -n 1)"
CURRENT_ORG_ID="$(env_value ORGANIZATION_ID)"

if [ "$BOOTSTRAP_RC" -ne 0 ]; then
  # Exit 2 == owner already exists (bootstrap.ts refuse()); that is fine only if
  # ORGANIZATION_ID is already recorded, otherwise the re-run has nothing to use.
  if [ "$BOOTSTRAP_RC" -eq 2 ] && [ -n "$CURRENT_ORG_ID" ]; then
    log "bootstrap reports an owner already exists; continuing with the recorded ORGANIZATION_ID"
    ORG_ID="$CURRENT_ORG_ID"
  else
    fail "bootstrap failed (exit $BOOTSTRAP_RC); fix the cause and re-run"
  fi
fi

if [ -z "$CURRENT_ORG_ID" ]; then
  [ -n "$ORG_ID" ] || fail "could not read the organization id from bootstrap output; set ORGANIZATION_ID in $ENV_FILE manually"
  log "recording ORGANIZATION_ID=$ORG_ID in $ENV_FILE"
  cp "$ENV_FILE" "$ENV_FILE.bak"
  if grep -q '^ORGANIZATION_ID=' "$ENV_FILE"; then
    sed -i "s|^ORGANIZATION_ID=.*|ORGANIZATION_ID=${ORG_ID}|" "$ENV_FILE"
  else
    printf 'ORGANIZATION_ID=%s\n' "$ORG_ID" >> "$ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"
elif [ -n "$ORG_ID" ] && [ "$ORG_ID" != "$CURRENT_ORG_ID" ]; then
  log "WARNING: bootstrap organization id ($ORG_ID) differs from ORGANIZATION_ID ($CURRENT_ORG_ID); leaving the env file unchanged"
fi

# --- 9. Start the rest of the stack ---------------------------------------------
log "starting web, worker, scheduler and Caddy"
"${COMPOSE[@]}" up -d
wait_healthy web

# --- 10. Next steps --------------------------------------------------------------
IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo '<droplet-ip>')"
DOMAIN="$(env_value CADDY_DOMAIN)"

cat <<EOF

================================================================================
Stack is up. Remaining steps are outside this box:

1. DNS: point an A record for ${DOMAIN} at ${IP}
   (skip if CADDY_DOMAIN=":80" — that is a local, TLS-less smoke test only).

2. Firewall: allow inbound 80/tcp and 443/tcp (and 443/udp for HTTP/3).

3. Verify once DNS has propagated:
     curl -fsS https://${DOMAIN}/api/health      # -> {"status":"ok"}

4. The owner account:
     ORGANIZATION_ID=${ORG_ID:-$(env_value ORGANIZATION_ID)}
   is recorded in deploy/.env.prod. If you set it by hand, apply it with:
     docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d web scheduler

5. Backups: install the nightly timer, then run one backup now:
     sudo install -m 644 deploy/systemd/aquarela-backup.service deploy/systemd/aquarela-backup.timer /etc/systemd/system/
     sudo systemctl daemon-reload && sudo systemctl enable --now aquarela-backup.timer
     sudo deploy/backup.sh

6. Logs and status:
     docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod ps
     docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod logs -f --tail=100

Runbook and restore procedure: deploy/README.md and deploy/restore.md
================================================================================
EOF
