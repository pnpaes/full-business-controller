-- pg-boss schema privilege bootstrap for Aquarela Business Control.
--
-- Sibling of `database-grants.sql`; run as the cluster admin (`doadmin`).
--
-- Why: DEC-139 item 6 / `docs/adr/0004-jobs-and-outbox.md` — the pre-deploy
-- `migrator` owns the `pgboss` schema (DDL) and the runtime `app` role gets DML
-- only. The `pgboss` schema is created by the pre-deploy migrator step
-- (`packages/persistence/scripts/migrate.mjs`), NOT by the drizzle journal, so it
-- does not exist yet on the first bootstrap and this file must be re-runnable.
--
-- Invocation order (both idempotent; re-running is a no-op):
--   1. Once, as `doadmin`, alongside `database-grants.sql` and BEFORE the first
--      deploy: creates nothing, but grants `migrator`/`app` on `pgboss` when the
--      schema already exists and records the default privileges. On a fresh
--      cluster the schema does not exist yet, so every block is skipped.
--   2. AGAIN, as `doadmin`, after the first pre-deploy `npm run db:migrate` has
--      created `pgboss` and its tables/functions, so the explicit grants reach
--      those objects and the default privileges cover future ones. Run it before
--      the app/worker components are used.
--
-- NOTE: `packages/persistence/scripts/migrate.mjs` now applies these same grants
-- itself after provisioning, so this file is belt-and-braces / recovery, not a
-- required manual step (the migrator no-ops when the `app` role is absent).
--
-- `database-grants.sql` must have run first: it gives `migrator` CREATE on the
-- database, which is what lets the migrator step create the `pgboss` schema.
--
-- psql does not interpolate variables inside dollar-quoted `DO $$...$$` bodies, so
-- the role/schema existence guards use `\gset` + `\if` instead of a DO block; the
-- role names still come from psql variables and nothing is hard-coded.
--
-- Invocation (names supplied as psql variables, matching database-grants.sql):
--   psql "postgresql://doadmin:...@<host>:25060/<db>?sslmode=require" \
--     -v db_name=<db> -v migrator_user=migrator -v app_user=app \
--     -f infra/bootstrap/pgboss-grants.sql

\set ON_ERROR_STOP on

-- Existence probes -> psql variables (`t`/`f`) used by the `\if` guards below.
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrator_user') AS has_migrator \gset
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')      AS has_app      \gset
SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'pgboss')     AS has_pgboss   \gset

-- `migrator`: owns the `pgboss` schema and runs the construction/migration plans.
\if :has_migrator
\if :has_pgboss
GRANT USAGE, CREATE ON SCHEMA pgboss TO :"migrator_user";
\endif
\endif

-- `app`: runtime user; no DDL, DML + sequence + function execute only.
\if :has_app
\if :has_pgboss
GRANT USAGE ON SCHEMA pgboss TO :"app_user";

-- Existing objects (present after the first pre-deploy migrate created them).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO :"app_user";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO :"app_user";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO :"app_user";
\endif
\endif

-- Future objects created by `migrator` in `pgboss` are automatically usable by `app`.
-- Requires the grantor role and the schema to both exist.
\if :has_migrator
\if :has_app
\if :has_pgboss
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA pgboss
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA pgboss
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA pgboss
  GRANT EXECUTE ON FUNCTIONS TO :"app_user";
\endif
\endif
\endif
