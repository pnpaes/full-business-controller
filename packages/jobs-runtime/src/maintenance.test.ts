import type { Job } from "pg-boss";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { FakeJobStore } from "../../application/src/jobs/test-support";
import type { RuntimeLogger } from "./logging";
import {
  registerMaintenance,
  replayUnpublishedOutbox,
  type MaintenanceJobData,
} from "./maintenance";
import { MAINTENANCE_QUEUE, outboxQueueName } from "./queues";
import { FakeBoss } from "./test-support";

const ORGANIZATION_ID = randomUUID();
const OTHER_ORGANIZATION_ID = randomUUID();

/** A logger that records its calls, for asserting the mismatch warning. */
function recordingLogger(): {
  logger: RuntimeLogger;
  warn: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
} {
  const warn = vi.fn();
  const info = vi.fn();
  const logger = { warn, info, error: vi.fn() } as unknown as RuntimeLogger;
  return { logger, warn, info };
}

async function seedUnpublished(store: FakeJobStore): Promise<string> {
  const event = await store.insertOutboxEvent({
    organizationId: ORGANIZATION_ID,
    eventType: "platform.smoke",
    aggregateType: "smoke",
    aggregateId: randomUUID(),
    payload: { note: "smoke" },
  });
  return event.id;
}

describe("replayUnpublishedOutbox", () => {
  it("re-enqueues each unpublished event under its own id", async () => {
    const store = new FakeJobStore();
    const boss = new FakeBoss();
    const eventId = await seedUnpublished(store);

    const replayed = await replayUnpublishedOutbox({
      boss,
      store,
      organizationId: ORGANIZATION_ID,
      limit: 10,
    });

    expect(replayed).toBe(1);
    expect(boss.createdQueues.map((call) => call.name)).toContain(
      outboxQueueName("platform.smoke"),
    );
    expect(boss.sent).toHaveLength(1);
    expect(boss.sent[0]!.name).toBe(outboxQueueName("platform.smoke"));
    expect(boss.sent[0]!.options?.id).toBe(eventId);
  });

  it("tolerates a null send result (row already queued)", async () => {
    const store = new FakeJobStore();
    const boss = new FakeBoss();
    boss.sendResult = () => null;
    await seedUnpublished(store);

    const replayed = await replayUnpublishedOutbox({
      boss,
      store,
      organizationId: ORGANIZATION_ID,
      limit: 10,
    });

    expect(replayed).toBe(0);
  });

  it("ignores another organization's unpublished rows", async () => {
    const store = new FakeJobStore();
    const boss = new FakeBoss();
    await seedUnpublished(store);

    const replayed = await replayUnpublishedOutbox({
      boss,
      store,
      organizationId: randomUUID(),
      limit: 10,
    });

    expect(replayed).toBe(0);
    expect(boss.sent).toHaveLength(0);
  });

  it("preserves the projection's scheduledAt as startAfter on replay", async () => {
    const store = new FakeJobStore();
    const boss = new FakeBoss();
    const scheduledAt = new Date("2026-07-01T12:00:00.000Z");
    const eventId = await seedUnpublished(store);
    await store.createScheduledJob({
      organizationId: ORGANIZATION_ID,
      queue: "platform.smoke",
      kind: "platform.smoke",
      payload: { note: "smoke" },
      scheduledAt,
      outboxEventId: eventId,
    });

    const replayed = await replayUnpublishedOutbox({
      boss,
      store,
      organizationId: ORGANIZATION_ID,
      limit: 10,
    });

    expect(replayed).toBe(1);
    expect(boss.sent).toHaveLength(1);
    expect(boss.sent[0]!.options?.id).toBe(eventId);
    expect(boss.sent[0]!.options?.startAfter).toBe(scheduledAt);
  });

  it("sends immediately when the projection is missing or unscheduled", async () => {
    const store = new FakeJobStore();
    const boss = new FakeBoss();
    // Missing projection: the outbox row has no `job` counterpart.
    await seedUnpublished(store);
    // Unscheduled projection: present, but `scheduledAt` is null.
    const unscheduledId = await seedUnpublished(store);
    await store.createScheduledJob({
      organizationId: ORGANIZATION_ID,
      queue: "platform.smoke",
      kind: "platform.smoke",
      payload: { note: "smoke" },
      outboxEventId: unscheduledId,
    });

    const replayed = await replayUnpublishedOutbox({
      boss,
      store,
      organizationId: ORGANIZATION_ID,
      limit: 10,
    });

    expect(replayed).toBe(2);
    expect(boss.sent).toHaveLength(2);
    for (const sent of boss.sent) {
      expect(sent.options).not.toHaveProperty("startAfter");
    }
  });
});

describe("registerMaintenance", () => {
  it("registers the replay worker and the recurring cron", async () => {
    const store = new FakeJobStore();
    const boss = new FakeBoss();

    await registerMaintenance(boss, store, {
      organizationId: ORGANIZATION_ID,
      cron: "*/15 * * * *",
      limit: 50,
    });

    expect(boss.worked.map((call) => call.name)).toContain(MAINTENANCE_QUEUE);
    expect(boss.scheduled).toHaveLength(1);
    expect(boss.scheduled[0]).toMatchObject({
      name: MAINTENANCE_QUEUE,
      cron: "*/15 * * * *",
      data: { organizationId: ORGANIZATION_ID, limit: 50 },
    });
  });

  it("replays the organization's unpublished rows when the cron job runs", async () => {
    const store = new FakeJobStore();
    const boss = new FakeBoss();
    const eventId = await seedUnpublished(store);
    await registerMaintenance(boss, store, {
      organizationId: ORGANIZATION_ID,
      cron: "*/15 * * * *",
      limit: 50,
    });

    const registered = boss.worked.find((call) => call.name === MAINTENANCE_QUEUE);
    const handler = registered!.handler as (jobs: Job<MaintenanceJobData>[]) => Promise<void>;
    await handler([
      {
        id: randomUUID(),
        name: MAINTENANCE_QUEUE,
        data: { organizationId: ORGANIZATION_ID, limit: 50 },
        expireInSeconds: 300,
        heartbeatSeconds: null,
        signal: new AbortController().signal,
      },
    ]);

    expect(boss.sent).toHaveLength(1);
    expect(boss.sent[0]!.options?.id).toBe(eventId);
  });

  function fakeJob(data: MaintenanceJobData): Job<MaintenanceJobData> {
    return {
      id: randomUUID(),
      name: MAINTENANCE_QUEUE,
      data,
      expireInSeconds: 300,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  it("takes the limit from the configured options, not the stored job data", async () => {
    const store = new FakeJobStore();
    const boss = new FakeBoss();
    await seedUnpublished(store);
    await seedUnpublished(store);

    await registerMaintenance(boss, store, {
      organizationId: ORGANIZATION_ID,
      cron: "*/15 * * * *",
      limit: 1,
    });

    const registered = boss.worked.find((call) => call.name === MAINTENANCE_QUEUE);
    const handler = registered!.handler as (jobs: Job<MaintenanceJobData>[]) => Promise<void>;
    // The stored data asks for 50; the run must page by the configured 1.
    await handler([fakeJob({ organizationId: ORGANIZATION_ID, limit: 50 })]);

    expect(boss.sent).toHaveLength(1);
  });

  it("prunes terminal projections with the configured retention window and batch size", async () => {
    const store = new FakeJobStore();
    const boss = new FakeBoss();
    const prune = vi.spyOn(store, "deleteExpiredJobs").mockResolvedValue(4);
    const now = new Date("2026-06-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      await registerMaintenance(boss, store, {
        organizationId: ORGANIZATION_ID,
        cron: "*/15 * * * *",
        limit: 50,
        retentionDays: 30,
        retentionLimit: 7,
      });

      const registered = boss.worked.find((call) => call.name === MAINTENANCE_QUEUE);
      const handler = registered!.handler as (jobs: Job<MaintenanceJobData>[]) => Promise<void>;
      await handler([fakeJob({ organizationId: ORGANIZATION_ID, limit: 50 })]);

      expect(prune).toHaveBeenCalledTimes(1);
      expect(prune).toHaveBeenCalledWith(
        ORGANIZATION_ID,
        new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        7,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("defaults the retention window to 90 days and the batch to 1000", async () => {
    const store = new FakeJobStore();
    const boss = new FakeBoss();
    const prune = vi.spyOn(store, "deleteExpiredJobs").mockResolvedValue(0);
    const now = new Date("2026-06-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      await registerMaintenance(boss, store, {
        organizationId: ORGANIZATION_ID,
        cron: "*/15 * * * *",
        limit: 50,
      });

      const registered = boss.worked.find((call) => call.name === MAINTENANCE_QUEUE);
      const handler = registered!.handler as (jobs: Job<MaintenanceJobData>[]) => Promise<void>;
      await handler([fakeJob({ organizationId: ORGANIZATION_ID, limit: 50 })]);

      expect(prune).toHaveBeenCalledWith(
        ORGANIZATION_ID,
        new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
        1000,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces aged non-terminal projections as jobs.stuck_pending", async () => {
    const store = new FakeJobStore();
    const boss = new FakeBoss();
    const countStuck = vi.spyOn(store, "countStuckJobs").mockResolvedValue(2);
    const { logger, warn, info } = recordingLogger();
    const now = new Date("2026-06-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      await registerMaintenance(boss, store, {
        organizationId: ORGANIZATION_ID,
        cron: "*/15 * * * *",
        limit: 50,
        logger,
      });

      const registered = boss.worked.find((call) => call.name === MAINTENANCE_QUEUE);
      const handler = registered!.handler as (jobs: Job<MaintenanceJobData>[]) => Promise<void>;
      await handler([fakeJob({ organizationId: ORGANIZATION_ID, limit: 50 })]);

      // The default stuck cutoff is 60 minutes, org-scoped.
      expect(countStuck).toHaveBeenCalledWith(
        ORGANIZATION_ID,
        new Date(now.getTime() - 60 * 60 * 1000),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          alert: "jobs.stuck_pending",
          organizationId: ORGANIZATION_ID,
          stuck: 2,
        }),
        expect.any(String),
      );
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORGANIZATION_ID, stuck: 2 }),
        expect.any(String),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not alert when no projection is stuck", async () => {
    const store = new FakeJobStore();
    const boss = new FakeBoss();
    vi.spyOn(store, "countStuckJobs").mockResolvedValue(0);
    const { logger, warn } = recordingLogger();

    await registerMaintenance(boss, store, {
      organizationId: ORGANIZATION_ID,
      cron: "*/15 * * * *",
      limit: 50,
      logger,
    });

    const registered = boss.worked.find((call) => call.name === MAINTENANCE_QUEUE);
    const handler = registered!.handler as (jobs: Job<MaintenanceJobData>[]) => Promise<void>;
    await handler([fakeJob({ organizationId: ORGANIZATION_ID, limit: 50 })]);

    expect(warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ alert: "jobs.stuck_pending" }),
      expect.any(String),
    );
  });

  it("uses the configured organization and warns when the stored job data differs", async () => {
    const store = new FakeJobStore();
    const boss = new FakeBoss();
    const eventId = await seedUnpublished(store);
    const { logger, warn } = recordingLogger();

    await registerMaintenance(boss, store, {
      organizationId: ORGANIZATION_ID,
      cron: "*/15 * * * *",
      limit: 50,
      logger,
    });

    const registered = boss.worked.find((call) => call.name === MAINTENANCE_QUEUE);
    const handler = registered!.handler as (jobs: Job<MaintenanceJobData>[]) => Promise<void>;
    await handler([fakeJob({ organizationId: OTHER_ORGANIZATION_ID, limit: 50 })]);

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        storedOrganizationId: OTHER_ORGANIZATION_ID,
      }),
      expect.stringContaining("differs"),
    );
    expect(boss.sent).toHaveLength(1);
    expect(boss.sent[0]!.options?.id).toBe(eventId);
  });
});
