# syntax=docker/dockerfile:1
#
# ONE parameterized image builds the whole npm-workspaces monorepo once. The
# runtime component is selected per-component by the App Platform `run_command`
# (not by a build arg), so the same image can run every component:
#
#   web       -> npm run start --workspace @aquarela/web        (HTTP :3000, default CMD)
#   worker    -> npm run start --workspace @aquarela/worker
#   scheduler -> npm run start --workspace @aquarela/scheduler
#   migrate   -> npm run db:migrate   (owned by `web`; pre-deploy job; carries drizzle-kit)
#
# Every component uses `source_dir: "."` in the App Platform spec.
# See docs/runbooks/deployment.md ("App Platform specification") and
# docs/adr/0012-deployment-topology-and-service-runtimes.md.

FROM node:22-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json ./
# ponytail: copy the whole workspaces (not just their manifests) so a parallel
# task adding apps/worker and apps/scheduler needs no Dockerfile edit. Trade-off:
# any source edit busts this layer and re-runs `npm ci`; split into per-workspace
# manifest COPY lines if image-build time ever matters.
COPY apps apps
COPY packages packages
RUN npm ci

FROM base AS builder
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN addgroup -g 1001 -S nextjs && adduser -S -u 1001 -G nextjs nextjs

# ponytail: ship the full node_modules from `base` (devDependencies included)
# because the migrator needs drizzle-kit (a devDependency) and worker/scheduler
# need tsx. Ceiling: a larger image. Upgrade path when size matters: precompile
# TS to JS at build time and/or split a dedicated migrator stage, then prune to
# production deps here.
COPY --chown=nextjs:nextjs --from=base /app/node_modules ./node_modules
COPY --chown=nextjs:nextjs --from=builder /app/apps ./apps
COPY --chown=nextjs:nextjs --from=builder /app/packages ./packages
COPY --chown=nextjs:nextjs --from=builder /app/package.json ./package.json
COPY --chown=nextjs:nextjs --from=builder /app/package-lock.json ./package-lock.json
COPY --chown=nextjs:nextjs --from=builder /app/tsconfig.json ./tsconfig.json

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["npm", "run", "start", "--workspace", "@aquarela/web"]
