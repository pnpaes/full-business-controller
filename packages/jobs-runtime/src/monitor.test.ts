import type { JobWithMetadata, QueueResult } from "pg-boss";
import type { NodeDatabase } from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeLogger } from "./logging";
import {
  MONITOR_ALERTS,
  MONITOR_QUEUE,
  OLDEST_QUEUED_AGE_SECONDS,
  QUEUE_DEPTH_SCAN_LIMIT,
  QUEUE_DEPTH_THRESHOLD,
  registerMonitor,
  runMonitorCheck,
  WORKER_HEARTBEAT_ALERT_SECONDS,
} from "./monitor";
import { OUTBOX_DEAD_LETTER_QUEUE } from "./queues";
import { FakeBoss } from "./test-support";

const OUTBOX_A = "outbox.platform.smoke";
const OUTBOX_B = "outbox.sales.import.completed";
const QUEUES = [OUTBOX_A, OUTBOX_B];

function queueResult(name: string, counts: Partial<QueueResult> = {}): QueueResult {
  return {
    name,
    deferredCount: 0,
    queuedCount: 0,
    readyCount: 0,
    activeCount: 0,
    failedCount: 0,
    totalCount: 0,
    table: `pgboss.job_${name}`,
    createdOn: new Date(),
    updatedOn: new Date(),
    singletonsActive: null,
    ...counts,
  };
}

function queuedJob(
  name: string,
  createdOn: Date,
  state: JobWithMetadata["state"] = "created",
): JobWithMetadata {
  return {
    id: randomUUID(),
    name,
    data: {},
    expireInSeconds: 300,
    heartbeatSeconds: null,
    signal: new AbortController().signal,
    priority: 0,
    state,
    retryLimit: 0,
    retryCount: 0,
    retryDelay: 0,
    retryBackoff: false,
    startAfter: createdOn,
    startedOn: createdOn,
    singletonKey: null,
    singletonOn: null,
    deleteAfterSeconds: 86400,
    createdOn,
    completedOn: null,
    keepUntil: createdOn,
    policy: "standard",
    heartbeatOn: null,
    blocked: false,
    blocking: false,
    pendingDependencies: 0,
    deadLetter: "",
    output: {},
    sourceName: null,
    sourceId: null,
    sourceCreatedOn: null,
    sourceRetryCount: null,
  };
}

function recordingLogger(): {
  logger: RuntimeLogger;
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
} {
  const error = vi.fn();
  const info = vi.fn();
  const logger = { error, info, warn: vi.fn() } as unknown as RuntimeLogger;
  return { logger, error, info };
}

/** The stable alert keys the logger emitted, in call order. */
function alertKeys(error: ReturnType<typeof vi.fn>): string[] {
  return error.mock.calls
    .map((call) => (call[0] as { alert?: string }).alert)
    .filter((key): key is string => key !== undefined);
}

function bossWith(queues: QueueResult[], jobs: Record<string, JobWithMetadata[]> = {}): FakeBoss {
  const boss = new FakeBoss();
  boss.queues.push(...queues);
  for (const [name, rows] of Object.entries(jobs)) {
    boss.queuedJobs[name] = rows;
  }
  return boss;
}

describe("runMonitorCheck", () => {
  it("emits no alerts and a heartbeat when every queue is healthy", async () => {
    const { logger, error, info } = recordingLogger();
    const boss = bossWith([
      queueResult(OUTBOX_DEAD_LETTER_QUEUE, { queuedCount: 0 }),
      queueResult(OUTBOX_A, { queuedCount: 0 }),
      queueResult(OUTBOX_B, { queuedCount: 0 }),
    ]);

    await runMonitorCheck(boss, { queues: QUEUES, logger });

    expect(alertKeys(error)).toEqual([]);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ depth: 0, deadLetterCount: 0 }),
      "jobs monitor check complete",
    );
  });

  it("alerts jobs.dead_letter when the DLQ holds a job", async () => {
    const { logger, error } = recordingLogger();
    const boss = bossWith([
      queueResult(OUTBOX_DEAD_LETTER_QUEUE, { queuedCount: 2 }),
      queueResult(OUTBOX_A, { queuedCount: 0 }),
    ]);

    await runMonitorCheck(boss, { queues: QUEUES, logger });

    expect(alertKeys(error)).toEqual([MONITOR_ALERTS.deadLetter]);
  });

  it("alerts jobs.queue_depth on the ready backlog, not the queued total", async () => {
    const { logger, error } = recordingLogger();
    const boss = bossWith([
      queueResult(OUTBOX_A, { readyCount: 60, queuedCount: 500 }),
      queueResult(OUTBOX_B, { readyCount: 50 }),
    ]);

    await runMonitorCheck(boss, { queues: QUEUES, logger });

    expect(alertKeys(error)).toEqual([MONITOR_ALERTS.queueDepth]);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        alert: MONITOR_ALERTS.queueDepth,
        depth: 110,
        queuedCount: 500,
      }),
      expect.any(String),
    );
  });

  it("does not alert at exactly the depth threshold", async () => {
    const { logger, error } = recordingLogger();
    const boss = bossWith([queueResult(OUTBOX_A, { readyCount: QUEUE_DEPTH_THRESHOLD })]);

    await runMonitorCheck(boss, { queues: QUEUES, logger });

    expect(alertKeys(error)).toEqual([]);
  });

  it("alerts jobs.oldest_queued_age when the oldest queued job is too old", async () => {
    const { logger, error } = recordingLogger();
    const old = new Date(Date.now() - 700 * 1000);
    const boss = bossWith([queueResult(OUTBOX_A, { readyCount: 1 })], {
      [OUTBOX_A]: [queuedJob(OUTBOX_A, old)],
    });

    await runMonitorCheck(boss, { queues: QUEUES, logger });

    expect(alertKeys(error)).toEqual([MONITOR_ALERTS.oldestQueuedAge]);
  });

  it("does not alert on age when the oldest queued job is fresh", async () => {
    const { logger, error } = recordingLogger();
    const fresh = new Date(Date.now() - 5 * 1000);
    const boss = bossWith([queueResult(OUTBOX_A, { readyCount: 1 })], {
      [OUTBOX_A]: [queuedJob(OUTBOX_A, fresh)],
    });

    await runMonitorCheck(boss, { queues: QUEUES, logger });

    expect(alertKeys(error)).toEqual([]);
  });

  it("does not count retry-state jobs (backoff) toward the age alert", async () => {
    const { logger, error } = recordingLogger();
    // An old `retry` job is waiting out `retryDelayMax`; counting it would
    // false-alert while the retry policy works as designed.
    const old = new Date(Date.now() - 700 * 1000);
    const boss = bossWith([queueResult(OUTBOX_A, { readyCount: 1 })], {
      [OUTBOX_A]: [queuedJob(OUTBOX_A, old, "retry")],
    });

    await runMonitorCheck(boss, { queues: QUEUES, logger });

    expect(alertKeys(error)).toEqual([]);
  });

  it("does not alert when the oldest ready job is exactly at the age threshold", async () => {
    const { logger, error } = recordingLogger();
    const now = new Date("2026-06-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const atThreshold = new Date(now.getTime() - OLDEST_QUEUED_AGE_SECONDS * 1000);
      const boss = bossWith([queueResult(OUTBOX_A, { readyCount: 1 })], {
        [OUTBOX_A]: [queuedJob(OUTBOX_A, atThreshold)],
      });

      await runMonitorCheck(boss, { queues: QUEUES, logger });

      expect(alertKeys(error)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips a job whose createdOn is not a finite date", async () => {
    const { logger, error } = recordingLogger();
    const boss = bossWith([queueResult(OUTBOX_A, { readyCount: 1 })], {
      [OUTBOX_A]: [queuedJob(OUTBOX_A, new Date(Number.NaN))],
    });

    await expect(runMonitorCheck(boss, { queues: QUEUES, logger })).resolves.toBeUndefined();
    expect(alertKeys(error)).toEqual([]);
  });

  it("skips the oldest-queued scan when the depth exceeds the scan limit", async () => {
    const { logger, error } = recordingLogger();
    const old = new Date(Date.now() - 700 * 1000);
    const boss = bossWith([queueResult(OUTBOX_A, { readyCount: QUEUE_DEPTH_SCAN_LIMIT + 1 })], {
      [OUTBOX_A]: [queuedJob(OUTBOX_A, old)],
    });
    const findJobs = vi.spyOn(boss, "findJobs");

    await runMonitorCheck(boss, { queues: QUEUES, logger });

    expect(alertKeys(error)).toEqual([MONITOR_ALERTS.queueDepth]);
    expect(findJobs).not.toHaveBeenCalled();
  });

  it("emits no heartbeat alert when a fresh worker heartbeat exists", async () => {
    const { logger, error } = recordingLogger();
    const boss = bossWith([queueResult(OUTBOX_A, { queuedCount: 0 })]);
    const readHeartbeats = vi.fn().mockResolvedValue([
      { workerId: "worker:host:1", role: "worker", lastSeenAt: new Date() },
      { workerId: "scheduler:host:2", role: "scheduler", lastSeenAt: new Date() },
    ]);

    await runMonitorCheck(boss, { queues: QUEUES, logger, readHeartbeats });

    expect(readHeartbeats).toHaveBeenCalledTimes(1);
    expect(alertKeys(error)).toEqual([]);
  });

  it("alerts jobs.worker_heartbeat_missing when there is no worker heartbeat", async () => {
    const { logger, error } = recordingLogger();
    const boss = bossWith([queueResult(OUTBOX_A, { queuedCount: 0 })]);
    // Only a scheduler row: the alert is about job consumers, not the cron owner.
    const readHeartbeats = vi
      .fn()
      .mockResolvedValue([
        { workerId: "scheduler:host:2", role: "scheduler", lastSeenAt: new Date() },
      ]);

    await runMonitorCheck(boss, { queues: QUEUES, logger, readHeartbeats });

    expect(alertKeys(error)).toEqual([MONITOR_ALERTS.workerHeartbeatMissing]);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        alert: MONITOR_ALERTS.workerHeartbeatMissing,
        ageSeconds: null,
        workers: 0,
      }),
      expect.any(String),
    );
  });

  it("alerts jobs.worker_heartbeat_missing when the newest worker heartbeat is stale", async () => {
    const { logger, error } = recordingLogger();
    const boss = bossWith([queueResult(OUTBOX_A, { queuedCount: 0 })]);
    const stale = new Date(Date.now() - (WORKER_HEARTBEAT_ALERT_SECONDS + 60) * 1000);
    const readHeartbeats = vi
      .fn()
      .mockResolvedValue([{ workerId: "worker:host:1", role: "worker", lastSeenAt: stale }]);

    await runMonitorCheck(boss, { queues: QUEUES, logger, readHeartbeats });

    expect(alertKeys(error)).toEqual([MONITOR_ALERTS.workerHeartbeatMissing]);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        alert: MONITOR_ALERTS.workerHeartbeatMissing,
        threshold: WORKER_HEARTBEAT_ALERT_SECONDS,
        workers: 1,
      }),
      expect.any(String),
    );
  });

  it("does not alert when the newest worker heartbeat is exactly at the threshold", async () => {
    const { logger, error } = recordingLogger();
    const now = new Date("2026-06-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const boss = bossWith([queueResult(OUTBOX_A, { queuedCount: 0 })]);
      const atThreshold = new Date(now.getTime() - WORKER_HEARTBEAT_ALERT_SECONDS * 1000);
      const readHeartbeats = vi
        .fn()
        .mockResolvedValue([
          { workerId: "worker:host:1", role: "worker", lastSeenAt: atThreshold },
        ]);

      await runMonitorCheck(boss, { queues: QUEUES, logger, readHeartbeats });

      expect(alertKeys(error)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs the newest of several worker heartbeats, not an older one", async () => {
    const { logger, error } = recordingLogger();
    const boss = bossWith([queueResult(OUTBOX_A, { queuedCount: 0 })]);
    const readHeartbeats = vi.fn().mockResolvedValue([
      { workerId: "worker:host:1", role: "worker", lastSeenAt: new Date(Date.now() - 10_000) },
      // A stale second worker must not drag the newest forward.
      { workerId: "worker:host:2", role: "worker", lastSeenAt: new Date(Date.now() - 500_000) },
    ]);

    await runMonitorCheck(boss, { queues: QUEUES, logger, readHeartbeats });

    expect(alertKeys(error)).toEqual([]);
  });

  it("skips the heartbeat check (warn only) when the heartbeat read fails", async () => {
    const { logger, error } = recordingLogger();
    const warn = logger.warn as ReturnType<typeof vi.fn>;
    const boss = bossWith([queueResult(OUTBOX_A, { queuedCount: 0 })]);
    const readHeartbeats = vi.fn().mockRejectedValue(new Error("db down"));

    await runMonitorCheck(boss, { queues: QUEUES, logger, readHeartbeats });

    expect(alertKeys(error)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("registerMonitor", () => {
  it("registers the monitor worker and the recurring cron", async () => {
    const boss = new FakeBoss();

    await registerMonitor(boss, { queues: QUEUES, cron: "*/5 * * * *" });

    expect(boss.worked.map((call) => call.name)).toContain(MONITOR_QUEUE);
    expect(boss.scheduled).toHaveLength(1);
    expect(boss.scheduled[0]).toMatchObject({
      name: MONITOR_QUEUE,
      cron: "*/5 * * * *",
      data: {},
      options: { missed: "once" },
    });
  });

  it("runs the check when the cron job fires", async () => {
    const { logger, error } = recordingLogger();
    const boss = bossWith([queueResult(OUTBOX_DEAD_LETTER_QUEUE, { queuedCount: 1 })]);

    await registerMonitor(boss, { queues: QUEUES, cron: "*/5 * * * *", logger });

    const handler = boss.worked.find((call) => call.name === MONITOR_QUEUE)!
      .handler as () => Promise<void>;
    await handler();

    expect(alertKeys(error)).toContain(MONITOR_ALERTS.deadLetter);
  });

  it("reads the heartbeat store when a db is provided and alerts when no worker is live", async () => {
    const { logger, error } = recordingLogger();
    const boss = bossWith([queueResult(OUTBOX_DEAD_LETTER_QUEUE, { queuedCount: 0 })]);
    const db = {
      select: () => ({ from: () => ({ orderBy: () => Promise.resolve([]) }) }),
    } as unknown as NodeDatabase;

    await registerMonitor(boss, { queues: QUEUES, cron: "*/5 * * * *", logger, db });

    const handler = boss.worked.find((call) => call.name === MONITOR_QUEUE)!
      .handler as () => Promise<void>;
    await handler();

    expect(alertKeys(error)).toContain(MONITOR_ALERTS.workerHeartbeatMissing);
  });
});
