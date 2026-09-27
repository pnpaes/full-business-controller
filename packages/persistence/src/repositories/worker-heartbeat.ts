import { desc } from "drizzle-orm";

import type { Database } from "../client";
import { workerHeartbeat } from "../schema";

/**
 * `DEC-139` item 8: the DB-backed worker heartbeat store.
 *
 * Unlike every business table in this package, `worker_heartbeat` is **not**
 * organization-scoped: it records process liveness (infrastructure), not a
 * business fact, so there is no `DEC-061` tenant filter. It is deliberately tiny
 * and mutable — one row per live worker/scheduler process, overwritten on each
 * beat. A dead process simply stops updating its row; the monitor alerts on the
 * age of the newest `worker` row.
 */

export type WorkerHeartbeatRole = "worker" | "scheduler";

export interface UpsertWorkerHeartbeatInput {
  /** The process identity (`<role>:<hostname>:<pid>`, or an env override). */
  readonly workerId: string;
  readonly role: WorkerHeartbeatRole;
  /** The instant the process was last seen alive. */
  readonly seenAt: Date;
}

/**
 * Insert-or-update the heartbeat row for `workerId`. The upsert is keyed on the
 * text primary key, so a restarted process with the same identity overwrites its
 * own row instead of accumulating one per run; `last_seen_at` and `updated_at`
 * both advance to `seenAt`. `created_at` keeps its insert default and is not
 * reset on update.
 */
export async function upsertWorkerHeartbeat(
  db: Database,
  input: UpsertWorkerHeartbeatInput,
): Promise<void> {
  await db
    .insert(workerHeartbeat)
    .values({
      workerId: input.workerId,
      role: input.role,
      lastSeenAt: input.seenAt,
      updatedAt: input.seenAt,
    })
    .onConflictDoUpdate({
      target: workerHeartbeat.workerId,
      set: {
        role: input.role,
        lastSeenAt: input.seenAt,
        updatedAt: input.seenAt,
      },
    });
}

export interface WorkerHeartbeatRow {
  readonly workerId: string;
  readonly role: string;
  readonly lastSeenAt: Date;
}

/**
 * Every live heartbeat, newest `last_seen_at` first. Used by the monitor: the
 * newest `role: "worker"` row is the dead-worker signal. Unbounded on purpose —
 * the table holds one row per running process, a handful in practice.
 */
export async function listWorkerHeartbeats(db: Database): Promise<readonly WorkerHeartbeatRow[]> {
  return db
    .select({
      workerId: workerHeartbeat.workerId,
      role: workerHeartbeat.role,
      lastSeenAt: workerHeartbeat.lastSeenAt,
    })
    .from(workerHeartbeat)
    .orderBy(desc(workerHeartbeat.lastSeenAt));
}
