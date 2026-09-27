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
function recordingLogger(): { logger: RuntimeLogger; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  const info = vi.fn();
  const logger = { warn, info, error: vi.fn() } as unknown as RuntimeLogger;
  return { logger, warn };
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
