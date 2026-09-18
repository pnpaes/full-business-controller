# Aquarela Business Control

Secure, testable modular monolith for Aquarela's business control system. The
implementation follows the Phase 0 package (`00_README.md` … `13_AGENT_BUILD_BRIEF.md`)
and the ADRs in `docs/adr/`.

This repository currently contains the **project foundation** only: tooling, the
package boundaries and a proof-of-boundary value type. No business slices or
database schema are implemented yet.

## Working practices

This project keeps a living handoff and work log at `docs/HANDOFF.md` and follows
the rules in `AGENTS.md`: session handoff and work log, reversibility of every
change, and decisions-as-authority.

## Requirements

- Node.js 22 (see `.nvmrc`; `nvm use`)
- npm 10+
- Docker (optional, for the local PostgreSQL)

## Layout

```text
apps/
  web/                 # Next.js (App Router) UI and HTTP adapters
packages/
  config/              # zod-validated environment configuration
  logger/              # pino structured logging with secret redaction
  domain/              # framework-free value objects (Money, Quantity)
  application/         # use cases orchestrating domain objects
  persistence/         # Drizzle config; schema lives in the persistence slice
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

| Command             | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | Start the Next.js app in development        |
| `npm run build`     | Build the Next.js app                       |
| `npm run lint`      | ESLint (flat config, typescript-eslint)     |
| `npm run format`    | Prettier write                              |
| `npm run typecheck` | `tsc --noEmit` for packages and the web app |
| `npm run test`      | Vitest unit tests                           |

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
```

This starts PostgreSQL 16 on `localhost:5432` (user/password/database `aquarela`),
matching the sample `DATABASE_URL` in `.env.example`.

## Container image

```bash
docker build -t aquarela-web .
docker run --rm -p 3000:3000 -e DATABASE_URL=... aquarela-web
```

The image is multi-stage (Node 22 Alpine), runs as a non-root user and keeps only
production dependencies plus the built Next.js output.
