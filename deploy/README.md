# Single-VM deployment

The primary deploy path: one DigitalOcean droplet (`s-1vcpu-2gb`, ~$12/mo) runs
the whole Aquarela Business Control stack with Docker Compose. No managed
database, no Spaces, no App Platform. Designed for low users and low traffic;
correctness and simplicity over HA.

The App Platform / Terraform path under `infra/` remains the documented
alternative (see `docs/runbooks/deployment.md`). This stack is additive and does
not modify those files.

## Topology

| Service     | Image                 | Role                                     | Reachable from                      |
| ----------- | --------------------- | ---------------------------------------- | ----------------------------------- |
| `postgres`  | `postgres:16-alpine`  | database; data on `/srv/aquarela/pgdata` | compose network only (no host port) |
| `web`       | `aquarela-app:latest` | Next.js (`next start :3000`)             | `web:3000` (Caddy proxies it)       |
| `worker`    | `aquarela-app:latest` | pg-boss consumer                         | compose network                     |
| `scheduler` | `aquarela-app:latest` | pg-boss cron                             | compose network                     |
| `caddy`     | `caddy:2-alpine`      | TLS + reverse proxy                      | public `:80` / `:443`               |

One image (`Dockerfile`) serves web/worker/scheduler; the component is chosen by
the compose `command`. Data lives on an attached DO volume mounted at
`/srv/aquarela` (`pgdata`, `uploads`, `caddy`, `backups`).

## Quickstart

```bash
# 1. Create the droplet (Ubuntu 24.04, s-1vcpu-2gb), a volume in the same
#    region, attach the volume, then add your SSH key.

# 2. On the droplet: attach, format and mount the volume (once). Replace the
#    device id with the one from `ls /dev/disk/by-id/`.
ssh root@<droplet-ip>
mkfs.ext4 -F /dev/disk/by-id/scsi-0DO_Volume_aquarela-data
mkdir -p /srv/aquarela
mount -o discard,defaults /dev/disk/by-id/scsi-0DO_Volume_aquarela-data /srv/aquarela
echo '/dev/disk/by-id/scsi-0DO_Volume_aquarela-data /srv/aquarela ext4 discard,defaults,nofail 0 2' >> /etc/fstab
findmnt /srv/aquarela   # must show the volume device

# 3. Clone the repo and configure.
git clone <repo-url> /opt/aquarela && cd /opt/aquarela
cp deploy/.env.prod.example deploy/.env.prod
openssl rand -base64 32                                   # -> POSTGRES_PASSWORD
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # -> TOTP key
$EDITOR deploy/.env.prod    # CADDY_DOMAIN, POSTGRES_PASSWORD + both URLs, TOTP key, owner

# 4. Bootstrap: Docker, swap, build, migrate, first owner, start the stack.
sudo deploy/bootstrap-vm.sh
```

The script fails closed on any placeholder or missing required value. It prints
the recorded `ORGANIZATION_ID` and the remaining DNS steps.

## DNS and verify

Point an `A` record for `CADDY_DOMAIN` at the droplet, open inbound `80/tcp`,
`443/tcp` (and `443/udp` for HTTP/3), then:

```bash
curl -fsS https://<CADDY_DOMAIN>/api/health     # -> {"status":"ok"}
```

Caddy obtains and renews the certificate automatically. First issuance needs DNS
to resolve and port 80 reachable; check `docker compose ... logs caddy` if it
stalls.

## Operations

```bash
cd /opt/aquarela
C="docker compose --project-directory /opt/aquarela/deploy -f /opt/aquarela/deploy/docker-compose.prod.yml --env-file /opt/aquarela/deploy/.env.prod"

$C ps                       # service status
$C logs -f --tail=100 web   # logs (also: worker, scheduler, postgres, caddy)
$C restart web              # restart one service
$C pull caddy && $C up -d   # update an image
```

### Upgrade

```bash
cd /opt/aquarela
git pull
cp deploy/.env.prod deploy/.env.prod.bak   # keep a copy
sudo deploy/backup.sh                      # take a pre-upgrade dump
$C build web                               # rebuild the shared image
$C run --rm web npm run db:migrate         # apply migrations + pgboss (idempotent)
$C up -d                                   # recreate changed containers
```

Migrations are reversible or expand→migrate→contract; a pg-boss schema bump
cannot be rolled back by redeploying the previous commit (run
`DROP SCHEMA pgboss CASCADE;` — see `packages/persistence/scripts/migrate.mjs`).

### Backups

```bash
sudo install -m 644 deploy/systemd/aquarela-backup.service deploy/systemd/aquarela-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now aquarela-backup.timer
sudo deploy/backup.sh        # run one now
```

Nightly custom-format `pg_dump` to `/srv/aquarela/backups` (14 daily + 4 weekly),
with an optional offsite upload when `BACKUP_S3_BUCKET` is set. Restore procedure
and RPO/RTO: [`deploy/restore.md`](./restore.md).

## Verify the configuration without booting

The compose file has no secret literal and no hard-coded value: app services read
`deploy/.env.prod` via `env_file`, and the two interpolated values
(`POSTGRES_PASSWORD`, `CADDY_DOMAIN`) come from the same file via `--env-file`.
Every compose command therefore needs both. To validate without booting:

```bash
cp deploy/.env.prod.example deploy/.env.prod   # fill the required values
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod config
rm deploy/.env.prod                            # if it was only a throwaway
```
