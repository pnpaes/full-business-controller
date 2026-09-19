# Aquarela Business Control

Secure, testable modular monolith for Aquarela's business control system. The
implementation follows the Phase 0 package (`00_README.md` … `13_AGENT_BUILD_BRIEF.md`)
and the ADRs in `docs/adr/`.

This repository contains the **project foundation** (tooling, package boundaries, value types)
plus the **Phase 1–2 persistence core**: the Drizzle schema (35 tables) and its first
migrations live in `packages/persistence`. No business slices are implemented yet.

## Working practices

This project follows the rules in `AGENTS.md` and keeps the living project
context, status and next steps in `CONTEXT.md`: session handoff and work log,
reversibility of every change, and decisions-as-authority.

## Requirements

- Node.js 22 (see `.nvmrc`; `nvm use`)
- npm 10+
- Docker (optional, for the local PostgreSQL)

## Layout

```text
apps/
  web/                 # Next.js (App Router) UI and HTTP adapters
  worker/              # job-queue/outbox worker stub (queue wiring pending ADR-0004)
  scheduler/           # cron-shaped jobs stub (long-lived worker + internal tick loop)
packages/
  config/              # zod-validated environment configuration
  logger/              # pino structured logging with secret redaction
  domain/              # framework-free value objects (Money, Quantity)
  application/         # use cases orchestrating domain objects
  persistence/         # Drizzle schema (Phase 1–2 core, 35 tables) + drizzle-kit migrations
infra/                 # Terraform: DO App Platform, Managed PostgreSQL, Spaces (scaffolded, not applied)
docs/                  # Phase 0 package and ADRs (read-only inputs)
```

Domain and application packages must stay framework-free. Business logic never
lives in route handlers or UI components (`02_ARCHITECTURE.md` §2.4, `13`).

## Install

```bash
nvm use            # Node 22
npm install
```

## Scripts

| Command               | Purpose                                     |
| --------------------- | ------------------------------------------- |
| `npm run dev`         | Start the Next.js app in development        |
| `npm run build`       | Build the Next.js app                       |
| `npm run lint`        | ESLint (flat config, typescript-eslint)     |
| `npm run format`      | Prettier write                              |
| `npm run typecheck`   | `tsc --noEmit` for packages and the web app |
| `npm run test`        | Vitest unit tests                           |
| `npm run db:generate` | Generate a drizzle-kit migration            |
| `npm run db:migrate`  | Apply pending migrations to PostgreSQL      |

## Configuration

Copy `.env.example` to `.env` and adjust. Variables:

| Variable       | Required | Default       | Notes                                 |
| -------------- | -------- | ------------- | ------------------------------------- |
| `NODE_ENV`     | no       | `development` | `development` / `test` / `production` |
| `LOG_LEVEL`    | no       | `info`        | pino level                            |
| `PORT`         | no       | `3000`        | web HTTP port                         |
| `DATABASE_URL` | yes      | –             | PostgreSQL connection string          |

`@aquarela/config` validates the environment with zod and returns a typed, frozen
object. Secret-bearing values are never included in validation errors or logs;
`@aquarela/logger` redacts `password`, `token`, `authorization`, `secret`,
`apiKey` and `cookie` paths. Load `.env` for scripts with
`node --env-file=.env`; Next.js loads it automatically.

## Local PostgreSQL

```bash
docker compose up -d postgres
npm run db:migrate
```

This starts PostgreSQL 16 on `localhost:5432` (user/password/database `aquarela`),
matching the sample `DATABASE_URL` in `.env.example`.

## Container image

```bash
docker build -t aquarela-web .
docker run --rm -p 3000:3000 -e DATABASE_URL=... aquarela-web
```

The image is multi-stage (Node 22 Alpine) and runs as a non-root user. One
parameterized image deliberately ships the full dependency tree (devDependencies
included) so the pre-deploy migration job has `drizzle-kit` and the worker and
scheduler runtimes have `tsx`. The trade-off is a larger image; see the comments
in the `Dockerfile` for the upgrade path.

## Deployment

Local Docker is for development only. Production runs as **DigitalOcean App Platform
components** (`web`, `api`, `worker`, `scheduler`) with **DO Managed PostgreSQL (PITR)** and
**DO Spaces**, provisioned with **Terraform**. See `docs/adr/0012-deployment-topology-and-service-runtimes.md`
and `docs/runbooks/deployment.md`.
