#!/usr/bin/env bash
#
# Nightly Postgres backup for the single-VM stack. Writes a custom-format
# `pg_dump` to the mounted volume and prunes old dumps:
#   - daily dumps  kept 14 days  (/srv/aquarela/backups/daily)
#   - weekly dumps kept 4 weeks  (/srv/aquarela/backups/weekly, taken on Sundays)
#
# Optional offsite copy: when BACKUP_S3_BUCKET is set in deploy/.env.prod AND an
# `aws` CLI is on PATH, each dump is also uploaded to that S3-compatible bucket
# (DigitalOcean Spaces or AWS S3). Missing credentials or `aws` are a warning, not
# a failure — the local dump is the source of truth. The upload is gated on env
# being set: an unset bucket means no network call at all.
#
# Schedule it with deploy/systemd/aquarela-backup.{service,timer} (recommended) or
# a root cron entry:
#   17 3 * * * /opt/aquarela/deploy/backup.sh >> /var/log/aquarela-backup.log 2>&1
#
# Restore procedure and RPO/RTO: deploy/restore.md
#
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$DEPLOY_DIR/.env.prod"
DATA_ROOT="${AQUARELA_DATA_ROOT:-/srv/aquarela}"
BACKUP_ROOT="${AQUARELA_BACKUP_ROOT:-$DATA_ROOT/backups}"
DAILY_DIR="$BACKUP_ROOT/daily"
WEEKLY_DIR="$BACKUP_ROOT/weekly"
KEEP_DAILY=14
KEEP_WEEKLY=4
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
TODAY="$(date -u +%Y-%m-%d)"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
warn() { printf '[%s] WARNING: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

[ -f "$ENV_FILE" ] || { echo "backup: $ENV_FILE not found" >&2; exit 1; }
env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }

COMPOSE=(docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/docker-compose.prod.yml" --env-file "$ENV_FILE")

mkdir -p "$DAILY_DIR" "$WEEKLY_DIR"

# Serialise overlapping runs (a slow dump plus the timer firing again).
if command -v flock >/dev/null 2>&1; then
  exec 9>"$BACKUP_ROOT/.backup.lock"
  flock -n 9 || { log "another backup is already running; exiting"; exit 0; }
fi

# Fail closed if Postgres is not running rather than writing an empty "backup".
if [ -z "$("${COMPOSE[@]}" ps -q postgres)" ]; then
  echo "backup: the postgres service is not running" >&2
  exit 1
fi

DUMP="$DAILY_DIR/aquarela-$TODAY.dump"
TMP="$DUMP.tmp"
log "dumping database to $DUMP"
# Local unix-socket connection inside the container (POSTGRES_USER is the cluster
# superuser and `aquarela` is its database), so no password is needed or logged.
if ! "${COMPOSE[@]}" exec -T postgres pg_dump -U aquarela -d aquarela -Fc -Z 6 > "$TMP"; then
  rm -f "$TMP"
  echo "backup: pg_dump failed" >&2
  exit 1
fi
if [ ! -s "$TMP" ]; then
  rm -f "$TMP"
  echo "backup: pg_dump produced an empty file" >&2
  exit 1
fi
mv "$TMP" "$DUMP"
log "wrote $(du -h "$DUMP" | cut -f1) dump"

# Weekly copy on Sundays (weekday 7 in GNU date).
if [ "$(date -u +%u)" = "7" ]; then
  WEEKLY="$WEEKLY_DIR/aquarela-$(date -u +%G-W%V).dump"
  cp -f "$DUMP" "$WEEKLY"
  log "wrote weekly copy $WEEKLY"
fi

# Retention: keep the newest N files in each directory.
prune() {
  local dir="$1" keep="$2"
  find "$dir" -maxdepth 1 -type f -name '*.dump' -print0 2>/dev/null \
    | xargs -0 ls -1t 2>/dev/null \
    | tail -n +"$((keep + 1))" \
    | while read -r old; do log "pruning $old"; rm -f -- "$old"; done
}
prune "$DAILY_DIR" "$KEEP_DAILY"
prune "$WEEKLY_DIR" "$KEEP_WEEKLY"

# Optional offsite copy.
S3_BUCKET="$(env_value BACKUP_S3_BUCKET)"
if [ -n "$S3_BUCKET" ]; then
  PREFIX="$(env_value BACKUP_S3_PREFIX)"
  if command -v aws >/dev/null 2>&1; then
    [ -n "$(env_value AWS_ACCESS_KEY_ID)" ] && export AWS_ACCESS_KEY_ID="$(env_value AWS_ACCESS_KEY_ID)"
    [ -n "$(env_value AWS_SECRET_ACCESS_KEY)" ] && export AWS_SECRET_ACCESS_KEY="$(env_value AWS_SECRET_ACCESS_KEY)"
    [ -n "$(env_value AWS_DEFAULT_REGION)" ] && export AWS_DEFAULT_REGION="$(env_value AWS_DEFAULT_REGION)"
    ENDPOINT_ARGS=()
    S3_ENDPOINT="$(env_value BACKUP_S3_ENDPOINT)"
    [ -n "$S3_ENDPOINT" ] && ENDPOINT_ARGS=(--endpoint-url "$S3_ENDPOINT")
    log "uploading to s3://$S3_BUCKET/${PREFIX}$(basename "$DUMP")"
    if aws "${ENDPOINT_ARGS[@]}" s3 cp "$DUMP" "s3://$S3_BUCKET/${PREFIX}$(basename "$DUMP")"; then
      log "offsite upload complete"
    else
      warn "offsite upload failed; the local dump at $DUMP is intact"
    fi
  else
    warn "BACKUP_S3_BUCKET is set but no aws CLI is installed; skipping offsite copy"
  fi
else
  log "BACKUP_S3_BUCKET unset; local backup only"
fi

log "backup finished (RPO: up to 24 h; see deploy/restore.md)"
