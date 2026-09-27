import { check, pgTable, text } from "drizzle-orm/pg-core";

import { enumCheck, tstz } from "./columns";

/*
 * `DEC-139` item 8: the DB-backed worker heartbeat.
 *
 * pg-boss 12 keeps work-in-progress in each worker process's memory (there is no
 * `wip` table), so one process cannot see another's in-flight work and a stalled
 * worker has no in-app signal. This small operational table closes that gap: the
 * worker and the scheduler each upsert one row keyed by a process identity
 * (`worker_id`) with the instant they were last alive, and the in-app monitor
 * (`@aquarela/jobs-runtime` monitor) alerts when no `worker` heartbeat is newer
 * than its threshold. The platform-log alert (absence of the `info` heartbeat
 * line) stays as a secondary, out-of-band signal.
 *
 * Deliberately **not org-scoped**: this is infrastructure liveness, not a
 * business fact, so there is no `organization_id` (the `rate_limit_counter`
 * precedent). The shape mirrors that table — a tiny mutable operational row —
 * with a text primary key instead of a uuid surrogate, because the natural key
 * is the process identity itself; the row is disposable and may be pruned or
 * deleted freely (a dead worker simply stops updating it).
 *
 * The `role` allow-list is narrowed in the table only: it is a module-local list,
 * not an exported vocabulary and not a `schemas/domain-enums.yaml` key (the
 * `job.status` precedent, because `vocabularies.test.ts` requires every exported
 * vocabulary to be yaml-backed).
 */
const WORKER_HEARTBEAT_ROLES = ["worker", "scheduler"] as const;

export const workerHeartbeat = pgTable(
  "worker_heartbeat",
  {
    /** The process identity (`<role>:<hostname>:<pid>`, or an env override). */
    workerId: text("worker_id").primaryKey(),
    role: text("role").notNull(),
    lastSeenAt: tstz("last_seen_at").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [check("worker_heartbeat_role_check", enumCheck(t.role, WORKER_HEARTBEAT_ROLES))],
);
