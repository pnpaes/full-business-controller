import {
  listWorkerHeartbeats,
  type NodeDatabase,
  type WorkerHeartbeatRow,
} from "@aquarela/persistence";

import type { BossMonitorApi, JobsBoss } from "./boss";
import type { RuntimeLogger } from "./logging";
import { MONITOR_QUEUE, OUTBOX_DEAD_LETTER_QUEUE } from "./queues";

export { MONITOR_QUEUE };

/**
 * `DEC-139` item 8: the alert surfaces. A recurring cron job scans the pg-boss
 * monitoring API and emits **structured alerts** (`logger.error({ alert }, …)`)
 * that the platform's log monitoring turns into notifications. It alerts on the
 * outbox runtime's real failure modes:
 *
 * - `jobs.dead_letter`     — the dead-letter queue holds any job at all;
 * - `jobs.queue_depth`     — the summed outbox queue depth is above {@link QUEUE_DEPTH_THRESHOLD};
 * - `jobs.oldest_queued_age` — the oldest queued job is older than {@link OLDEST_QUEUED_AGE_SECONDS};
 * - `jobs.worker_heartbeat_missing` — no live `worker` heartbeat newer than
 *   {@link WORKER_HEARTBEAT_ALERT_SECONDS}.
 *
 * Worker liveness: pg-boss 12 keeps work-in-progress in each worker process's
 * memory (there is no `wip` table), so one process cannot see another's in-flight
 * jobs. The DB-backed `worker_heartbeat` table is now the **in-app cross-process
 * signal** — the worker and scheduler write it (see `heartbeat.ts`) and this
 * monitor alerts on the newest `worker` row going stale. The platform-log alert
 * on the absence of the worker's `info` heartbeat line remains as a secondary,
 * out-of-band signal (DO Monitoring).
 */

/** A dead-letter queue holding more than zero jobs is an alert. */
export const DEAD_LETTER_THRESHOLD = 0;
/** The summed outbox queue depth above which the monitor alerts. */
export const QUEUE_DEPTH_THRESHOLD = 100;
/** The oldest queued job age (seconds) above which the monitor alerts. */
export const OLDEST_QUEUED_AGE_SECONDS = 600;
/**
 * Above this depth the oldest-queued scan is skipped: `FindJobsOptions` has no
 * order/limit, so the scan is a full per-queue read. At this size the depth alert
 * already fires on the same run, so the age detail is dropped rather than scanning
 * an unbounded backlog.
 */
export const QUEUE_DEPTH_SCAN_LIMIT = 1000;

/**
 * The worker-heartbeat alert threshold (seconds), `DEC-139` item 8. The worker
 * and scheduler upsert a `worker_heartbeat` row every 30 s; this monitor alerts
 * when the newest `role: "worker"` row is older than this window (two missed
 * beats), or when there is no `worker` row at all. The platform-log alert on the
 * worker's `info` heartbeat line (DO Monitoring) stays as a secondary signal.
 */
export const WORKER_HEARTBEAT_ALERT_SECONDS = 120;

/** Stable alert keys the log monitoring matches on. */
export const MONITOR_ALERTS = {
  deadLetter: "jobs.dead_letter",
  queueDepth: "jobs.queue_depth",
  oldestQueuedAge: "jobs.oldest_queued_age",
  workerHeartbeatMissing: "jobs.worker_heartbeat_missing",
} as const;

export type MonitorAlert = (typeof MONITOR_ALERTS)[keyof typeof MONITOR_ALERTS];

/** The heartbeat read seam: a fake store lets the unit suite drive the check. */
export type ReadWorkerHeartbeats = () => Promise<readonly WorkerHeartbeatRow[]>;

export interface MonitorCheckOptions {
  /** The outbox-family queues whose depth is summed. */
  readonly queues: readonly string[];
  readonly logger?: RuntimeLogger;
  /** When present, the heartbeat check runs against this store. */
  readonly readHeartbeats?: ReadWorkerHeartbeats;
}

export interface RegisterMonitorOptions {
  readonly queues: readonly string[];
  readonly cron: string;
  readonly logger?: RuntimeLogger;
  /** The DB handle the heartbeat check reads from (the scheduler's client). */
  readonly db?: NodeDatabase;
}

/**
 * The oldest **runnable** queued job's age in seconds, or `undefined` when nothing
 * is ready. Only `state === "created"` jobs count: `findJobs(queued: true)` also
 * returns `retry`-state jobs waiting out `retryDelayMax` (up to 3600 s), and those
 * are backoff working as designed, not a backlog — counting them would false-alert
 * every pass while the retry policy does its job.
 */
async function oldestQueuedAgeSeconds(
  boss: BossMonitorApi,
  queues: readonly string[],
): Promise<number | undefined> {
  const now = Date.now();
  let oldestMs: number | undefined;
  for (const name of queues) {
    const jobs = await boss.findJobs(name, { queued: true });
    for (const job of jobs) {
      if (job.state !== "created") {
        continue;
      }
      const createdMs = new Date(job.createdOn).getTime();
      if (Number.isNaN(createdMs)) {
        continue;
      }
      if (oldestMs === undefined || createdMs < oldestMs) {
        oldestMs = createdMs;
      }
    }
  }
  return oldestMs === undefined ? undefined : (now - oldestMs) / 1000;
}

/**
 * The `DEC-139` item-8 heartbeat check: the newest `role: "worker"` heartbeat's
 * age against {@link WORKER_HEARTBEAT_ALERT_SECONDS}. No `worker` row at all, or a
 * newest row older than the window, raises `jobs.worker_heartbeat_missing`.
 * Scheduler rows are written for completeness but never satisfy this check (the
 * alert is about job consumers). A read failure is logged and skipped: a monitor
 * DB blip must not fail the whole check and mask the queue alerts.
 */
async function checkWorkerHeartbeat(
  readHeartbeats: ReadWorkerHeartbeats,
  logger: RuntimeLogger | undefined,
): Promise<void> {
  let rows: readonly WorkerHeartbeatRow[];
  try {
    rows = await readHeartbeats();
  } catch (error) {
    logger?.warn({ err: error }, "worker heartbeat read failed; skipping the heartbeat check");
    return;
  }

  const workers = rows.filter((row) => row.role === "worker");
  let newestMs: number | undefined;
  for (const row of workers) {
    const at = row.lastSeenAt.getTime();
    if (Number.isNaN(at)) {
      continue;
    }
    if (newestMs === undefined || at > newestMs) {
      newestMs = at;
    }
  }
  const ageSeconds = newestMs === undefined ? undefined : (Date.now() - newestMs) / 1000;
  if (ageSeconds === undefined || ageSeconds > WORKER_HEARTBEAT_ALERT_SECONDS) {
    logger?.error(
      {
        alert: MONITOR_ALERTS.workerHeartbeatMissing,
        ageSeconds: ageSeconds ?? null,
        threshold: WORKER_HEARTBEAT_ALERT_SECONDS,
        workers: workers.length,
      },
      "no live worker heartbeat within the threshold",
    );
  }
}

/**
 * The monitor check itself: evaluates every threshold and logs the alerts. Kept
 * separate from the pg-boss worker registration so the unit suite can drive it
 * with a crafted {@link BossMonitorApi} and assert the exact alert keys.
 */
export async function runMonitorCheck(
  boss: BossMonitorApi,
  options: MonitorCheckOptions,
): Promise<void> {
  const { queues, logger } = options;

  const deadLetter = await boss.getQueue(OUTBOX_DEAD_LETTER_QUEUE);
  const deadLetterCount = deadLetter?.queuedCount ?? 0;
  if (deadLetterCount > DEAD_LETTER_THRESHOLD) {
    logger?.error(
      {
        alert: MONITOR_ALERTS.deadLetter,
        queue: OUTBOX_DEAD_LETTER_QUEUE,
        count: deadLetterCount,
      },
      "dead-letter queue is not empty",
    );
  }

  const results = await boss.getQueues([...queues]);
  // Depth is the *ready* backlog: `queuedCount` also counts deferred/future-dated
  // jobs, which are scheduled rather than backed up. Both sums are reported so a
  // deferred spike is still visible in the payload.
  const depth = results.reduce((sum, queue) => sum + queue.readyCount, 0);
  const queuedCount = results.reduce((sum, queue) => sum + queue.queuedCount, 0);
  if (depth > QUEUE_DEPTH_THRESHOLD) {
    logger?.error(
      {
        alert: MONITOR_ALERTS.queueDepth,
        depth,
        queuedCount,
        threshold: QUEUE_DEPTH_THRESHOLD,
      },
      "outbox queue depth exceeded the threshold",
    );
  }

  if (depth > QUEUE_DEPTH_SCAN_LIMIT) {
    logger?.info(
      { depth, scanLimit: QUEUE_DEPTH_SCAN_LIMIT },
      "queue depth too large to scan for the oldest queued age; relying on the depth alert",
    );
  } else {
    const oldestAge = await oldestQueuedAgeSeconds(boss, queues);
    if (oldestAge !== undefined && oldestAge > OLDEST_QUEUED_AGE_SECONDS) {
      logger?.error(
        {
          alert: MONITOR_ALERTS.oldestQueuedAge,
          ageSeconds: oldestAge,
          threshold: OLDEST_QUEUED_AGE_SECONDS,
        },
        "oldest queued job exceeded the age threshold",
      );
    }
  }

  if (options.readHeartbeats !== undefined) {
    await checkWorkerHeartbeat(options.readHeartbeats, logger);
  }

  // Heartbeat: one info line per run — the monitor's own liveness trace. The
  // monitor's cron queue has no dead-letter, so an exhausted monitor cron job ends
  // `failed` in its own queue (no DLQ signal); platform log monitoring must alert
  // on the *absence* of this heartbeat.
  logger?.info({ depth, queuedCount, deadLetterCount }, "jobs monitor check complete");
}

/**
 * Registers the monitor worker on {@link MONITOR_QUEUE} and its recurring cron
 * (`missed: "once"` catches up a single missed pass, matching the payroll cron).
 * Called by the scheduler process, which owns pg-boss cron per `DEC-139`.
 */
export async function registerMonitor(
  boss: JobsBoss,
  options: RegisterMonitorOptions,
): Promise<void> {
  const { queues, cron, logger, db } = options;
  const readHeartbeats = db === undefined ? undefined : () => listWorkerHeartbeats(db);

  await boss.work(MONITOR_QUEUE, async () => {
    await runMonitorCheck(boss, {
      queues,
      ...(logger === undefined ? {} : { logger }),
      ...(readHeartbeats === undefined ? {} : { readHeartbeats }),
    });
  });

  await boss.schedule(MONITOR_QUEUE, cron, {}, { missed: "once" });
}
