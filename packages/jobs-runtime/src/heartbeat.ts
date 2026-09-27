import { hostname } from "node:os";

import { upsertWorkerHeartbeat, type NodeDatabase } from "@aquarela/persistence";

import type { RuntimeLogger } from "./logging";

/**
 * `DEC-139` item 8: the DB-backed worker heartbeat.
 *
 * pg-boss 12 keeps work-in-progress in each worker process's memory (there is no
 * `wip` table), so one process cannot observe another's in-flight work; a stalled
 * worker has no in-app signal. This writer closes that gap: it upserts one
 * `worker_heartbeat` row (keyed by the process identity) immediately and then on
 * a fixed interval, so the in-app monitor can alert when the newest `worker`
 * heartbeat goes stale. The per-process cost — one tiny upsert every 30 s — is
 * the intended overhead.
 *
 * A heartbeat failure must never kill the process: any write error is logged and
 * swallowed, and the next tick retries. The platform-log alert on the absence of
 * the `info` heartbeat line remains as a secondary, out-of-band signal.
 */

/** The default beat interval (ms): one upsert every 30 s per process. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

export type HeartbeatRole = "worker" | "scheduler";

export interface HeartbeatOptions {
  readonly db: NodeDatabase;
  readonly role: HeartbeatRole;
  /** Overrides the process identity; defaults to {@link defaultWorkerHeartbeatId}. */
  readonly workerId?: string;
  /** Beat interval in ms (default {@link DEFAULT_HEARTBEAT_INTERVAL_MS}). */
  readonly intervalMs?: number;
  readonly logger?: RuntimeLogger;
}

/**
 * The default process identity: `${role}:${hostname}:${pid}`. Stable for the life
 * of one process and distinct across processes on one host, so a restart
 * overwrites its own row rather than accumulating rows (the identity is the
 * table's text primary key). `WORKER_HEARTBEAT_ID` overrides it when a deployment
 * wants a stable per-instance id (for example an App Platform instance name).
 */
export function defaultWorkerHeartbeatId(role: HeartbeatRole): string {
  const override = process.env.WORKER_HEARTBEAT_ID?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return `${role}:${hostname()}:${process.pid}`;
}

/**
 * Starts the heartbeat and returns the interval timer so the caller can clear it
 * on shutdown. The first beat is written synchronously (well, on the next
 * microtask) before the interval is armed, so a freshly started process is
 * visible to the monitor immediately.
 */
export function startHeartbeat(options: HeartbeatOptions): NodeJS.Timeout {
  const { db, role } = options;
  const intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const workerId = options.workerId ?? defaultWorkerHeartbeatId(role);

  const beat = async (): Promise<void> => {
    try {
      await upsertWorkerHeartbeat(db, { workerId, role, seenAt: new Date() });
    } catch (error) {
      // Swallowed on purpose (comment on the module header): a heartbeat write
      // failure is a monitoring gap, not a reason to take the worker down.
      options.logger?.error({ err: error, workerId, role }, "worker heartbeat write failed");
    }
  };

  void beat();
  const timer = setInterval(() => void beat(), intervalMs);
  return timer;
}
