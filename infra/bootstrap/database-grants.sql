-- Database privilege bootstrap for Aquarela Business Control.
--
-- Run ONCE as the cluster admin (`doadmin`) after the Terraform database module
-- has created the cluster, database and the `migrator`/`app` users, and BEFORE
-- the first deploy (the App Platform pre-deploy job runs as `migrator`).
--
-- Why this is needed: users created through the DigitalOcean API/console get the
-- `normal` role and no privileges; Terraform creates the users but cannot grant
-- them, so privileges must be managed manually. Without this step the pre-deploy
-- migration job cannot create schema objects and the runtime user cannot read
-- them.
--
-- Why the extensions are created here: migration 0000_enable_extensions.sql does
-- `CREATE EXTENSION IF NOT EXISTS pgcrypto` / `btree_gist`, so pre-creating them
-- (as a privileged role) turns 0000 into a no-op instead of a permission error.
--
-- Idempotent: GRANT is additive, CREATE EXTENSION ... IF NOT EXISTS is a no-op
-- when present, and re-issuing ALTER DEFAULT PRIVILEGES replaces the same ACL
-- entries. Safe to re-run.
--
-- Invocation (names supplied as psql variables, nothing hard-coded):
--   psql "postgresql://doadmin:...@<host>:25060/<db>?sslmode=require" \
--     -v db_name=<db> -v migrator_user=migrator -v app_user=app \
--     -f infra/bootstrap/database-grants.sql

\set ON_ERROR_STOP on

-- `migrator`: owns the schema and the pre-deploy migration; needs DDL.
GRANT CONNECT ON DATABASE :"db_name" TO :"migrator_user";
GRANT CREATE  ON DATABASE :"db_name" TO :"migrator_user";
GRANT USAGE, CREATE ON SCHEMA public TO :"migrator_user";

-- Extensions the migrations depend on (0000 becomes a no-op).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- `app`: runtime user; no DDL, and only DML on what `migrator` creates.
GRANT CONNECT ON DATABASE :"db_name" TO :"app_user";
GRANT USAGE ON SCHEMA public TO :"app_user";

-- Future objects created by `migrator` are automatically usable by `app`.
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";
