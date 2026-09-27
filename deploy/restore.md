# Restore procedure — single-VM deployment

Backups are logical `pg_dump` custom-format files written by `deploy/backup.sh`
to the mounted DO volume:

- `daily/aquarela-<YYYY-MM-DD>.dump` — kept 14 days
- `weekly/aquarela-<YYYY-Www>.dump` — written Sundays, kept 4 weeks

A dump contains one database: every `public` table (including the raw-SQL
invariants), the `pgboss` schema, sequences and the `pgcrypto`/`btree_gist`
extensions. Application file bytes (`/srv/aquarela/uploads`) are **not** in the
dump — they are covered by the volume itself (see "File uploads" below).

## RPO / RTO

| Metric                | Value                      | Basis                                                                                                                                |
| --------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| RPO (max data loss)   | **up to 24 h**             | one nightly dump at 03:17 UTC; no WAL archiving. Run the timer more often to tighten it.                                             |
| RTO (time to service) | **~30–60 min**             | provision/reuse droplet + volume, clone the repo, `docker compose up`, restore the dump, verify. Dominated by image build on 1 vCPU. |
| Offsite RPO           | up to 24 h + upload window | only when `BACKUP_S3_BUCKET` and `aws` are configured.                                                                               |

There is no point-in-time recovery: to restore closer to a failure than the last
nightly dump, run the backup more frequently (change the systemd `OnCalendar`) or
enable Postgres WAL archiving (not configured here).

## Preconditions

- Docker and the compose plugin are installed (run `deploy/bootstrap-vm.sh` first,
  or on a rebuilt box clone the repo to `/opt/aquarela` and run it).
- The Postgres container exists (`docker compose ... ps postgres`), even if web is
  down. Restoring drops and recreates the database in place, so Postgres itself
  must be running.
- You have the dump file locally on the volume, or downloaded from offsite.

## Restore (in place, from the nightly dump)

> This is destructive to the current database. Confirm the target and the chosen
> dump first. Never rehearse this against a database you care about.

```bash
cd /opt/aquarela
COMPOSE="docker compose --project-directory /opt/aquarela/deploy \
  -f /opt/aquarela/deploy/docker-compose.prod.yml --env-file /opt/aquarela/deploy/.env.prod"

# 1. Stop writers so no new rows land mid-restore (Postgres stays up).
$COMPOSE stop web worker scheduler

# 2. Pick the dump and sanity-check it (it must be a non-empty custom-format file).
ls -lh /srv/aquarela/backups/daily/
pg_restore --list /srv/aquarela/backups/daily/aquarela-YYYY-MM-DD.dump | head   # run on any host with pg_restore

# 3. Drop and recreate the database (FORCE terminates lingering connections).
$COMPOSE exec -T postgres psql -U aquarela -d postgres -c 'DROP DATABASE IF EXISTS aquarela WITH (FORCE);'
$COMPOSE exec -T postgres psql -U aquarela -d postgres -c 'CREATE DATABASE aquarela OWNER aquarela;'

# 4. Restore. `-T` passes the host file over stdin into the container.
$COMPOSE exec -T postgres pg_restore -U aquarela -d aquarela --exit-on-error \
  < /srv/aquarela/backups/daily/aquarela-YYYY-MM-DD.dump

# 5. Verify: table count, the owner row, and the app health endpoint.
$COMPOSE exec -T postgres psql -U aquarela -d aquarela -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
$COMPOSE exec -T postgres psql -U aquarela -d aquarela -c \
  "SELECT count(*) FROM app_user;"

# 6. Bring the stack back.
$COMPOSE up -d
curl -fsS https://<CADDY_DOMAIN>/api/health   # -> {"status":"ok"}
```

`--exit-on-error` makes a partial restore fail loudly instead of leaving a
half-populated database. If it fails, drop the database again and re-run step 4;
the dump is unchanged.

### Restore from an offsite copy

```bash
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp \
  "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/aquarela-YYYY-MM-DD.dump" \
  /srv/aquarela/backups/daily/
# then run the restore steps above against the downloaded file
```

### Replace a lost droplet

1. Create a droplet (`s-1vcpu-2gb`) and a volume; attach, format and mount the
   volume at `/srv/aquarela` (see the header of `deploy/bootstrap-vm.sh`).
2. Restore the dump into `/srv/aquarela/backups/daily/`, then copy the previous
   `/srv/aquarela/uploads` contents from your file backup into `/srv/aquarela/uploads`.
3. Clone the repo to `/opt/aquarela`, copy `deploy/.env.prod` (from your secret
   store — it is not in the dump), keep its `POSTGRES_PASSWORD`/`DATABASE_URL`.
4. `sudo deploy/bootstrap-vm.sh` (idempotent: migrate is a no-op, bootstrap sees
   the existing owner and continues), then run the restore steps above.
5. Point DNS at the new droplet and verify `/api/health`.

## File uploads

`pg_dump` does not back up uploaded file bytes. `FILE_STORAGE_ROOT` is
`/srv/aquarela/uploads` on the mounted volume, so those bytes are protected by the
volume. For offsite protection, snapshot the DO volume (or `restic`/`rclone` the
`uploads/` directory) on the same schedule as the database dump. If you configure
Spaces (`SPACES_*`), uploads live there instead and are outside this procedure.

## Restore rehearsal

Rehearse on a throwaway database, never on production:

```bash
$COMPOSE exec -T postgres psql -U aquarela -d postgres -c 'CREATE DATABASE aquarela_rehearsal OWNER aquarela;'
$COMPOSE exec -T postgres pg_restore -U aquarela -d aquarela_rehearsal --exit-on-error < <dump>
$COMPOSE exec -T postgres psql -U aquarela -d aquarela_rehearsal -c "SELECT count(*) FROM app_user;"
$COMPOSE exec -T postgres psql -U aquarela -d postgres -c 'DROP DATABASE aquarela_rehearsal;'
```
