import { DomainError, NotFoundError } from "@aquarela/domain";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { discardDeadLetteredJob, retryDeadLetteredJob } from "./dead-letter";
import { FakeJobStore } from "./test-support";
import type { JobRecord } from "./types";

const ORGANIZATION_ID = randomUUID();
const OTHER_ORGANIZATION_ID = randomUUID();
const ACTOR = randomUUID();

/** A `dead_lettered` job, optionally linked to an outbox event. */
async function seedDeadLettered(
  store: FakeJobStore,
  organizationId: string,
  outboxEventId: string | null = null,
): Promise<JobRecord> {
  const job = await store.createScheduledJob({
    organizationId,
    queue: "outbox.platform.smoke",
    kind: "platform.smoke",
    payload: { runId: randomUUID() },
    outboxEventId,
  });
  await store.markRunning(organizationId, job.id, 1);
  const dead = await store.markDeadLettered(organizationId, job.id, "boom");
  return dead!;
}

/** A dead-lettered job whose outbox event is also dead-lettered and published. */
async function seedWithDeadLetteredOutbox(
  store: FakeJobStore,
  organizationId: string,
): Promise<{ job: JobRecord; outboxEventId: string }> {
  const event = await store.insertOutboxEvent({
    organizationId,
    eventType: "platform.smoke",
    aggregateType: "smoke",
    aggregateId: randomUUID(),
    payload: { note: "x" },
  });
  await store.deadLetter(event.id);
  await store.markPublished(event.id);
  const job = await seedDeadLettered(store, organizationId, event.id);
  return { job, outboxEventId: event.id };
}

describe("retryDeadLetteredJob", () => {
  it("resets the projection and clears the outbox dead-letter", async () => {
    const store = new FakeJobStore();
    const { job, outboxEventId } = await seedWithDeadLetteredOutbox(store, ORGANIZATION_ID);

    const updated = await retryDeadLetteredJob(store, {
      organizationId: ORGANIZATION_ID,
      jobId: job.id,
      actorId: ACTOR,
    });

    expect(updated).toMatchObject({
      status: "pending",
      attempts: 0,
      error: null,
      startedAt: null,
      finishedAt: null,
    });
    expect(store.outboxEvents.find((event) => event.id === outboxEventId)).toMatchObject({
      deadLetteredAt: null,
      publishedAt: null,
    });
    expect(store.audits.at(-1)).toMatchObject({
      action: "jobs.job.retried",
      entityType: "job",
      entityId: job.id,
      actorId: ACTOR,
    });
  });

  it("retries a job with no outbox event", async () => {
    const store = new FakeJobStore();
    const job = await seedDeadLettered(store, ORGANIZATION_ID);

    const updated = await retryDeadLetteredJob(store, {
      organizationId: ORGANIZATION_ID,
      jobId: job.id,
    });

    expect(updated.status).toBe("pending");
    expect(store.audits.at(-1)).toMatchObject({ action: "jobs.job.retried" });
  });

  it("refuses a job that is not dead-lettered", async () => {
    const store = new FakeJobStore();
    const job = await store.createScheduledJob({
      organizationId: ORGANIZATION_ID,
      queue: "outbox.platform.smoke",
      kind: "platform.smoke",
      payload: {},
    });

    await expect(
      retryDeadLetteredJob(store, { organizationId: ORGANIZATION_ID, jobId: job.id }),
    ).rejects.toThrow(DomainError);
    expect(store.jobs[0]!.status).toBe("pending");
    expect(store.audits).toHaveLength(0);
  });

  it("is an indistinguishable NotFoundError for an unknown or other-organization id", async () => {
    const store = new FakeJobStore();
    const job = await seedDeadLettered(store, ORGANIZATION_ID);

    await expect(
      retryDeadLetteredJob(store, { organizationId: ORGANIZATION_ID, jobId: randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      retryDeadLetteredJob(store, { organizationId: OTHER_ORGANIZATION_ID, jobId: job.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(store.jobs[0]!.status).toBe("dead_lettered");
  });
});

describe("discardDeadLetteredJob", () => {
  it("moves the job to terminal failed and keeps the outbox dead-letter marker", async () => {
    const store = new FakeJobStore();
    const { job, outboxEventId } = await seedWithDeadLetteredOutbox(store, ORGANIZATION_ID);

    const updated = await discardDeadLetteredJob(store, {
      organizationId: ORGANIZATION_ID,
      jobId: job.id,
      actorId: ACTOR,
    });

    expect(updated).toMatchObject({ status: "failed", error: "boom" });
    expect(store.outboxEvents.find((event) => event.id === outboxEventId)).toMatchObject({
      deadLetteredAt: expect.any(Date),
      publishedAt: expect.any(Date),
    });
    expect(store.audits.at(-1)).toMatchObject({
      action: "jobs.job.discarded",
      entityId: job.id,
      actorId: ACTOR,
    });
  });

  it("refuses a job that is not dead-lettered", async () => {
    const store = new FakeJobStore();
    const job = await seedDeadLettered(store, ORGANIZATION_ID);
    await retryDeadLetteredJob(store, { organizationId: ORGANIZATION_ID, jobId: job.id });

    await expect(
      discardDeadLetteredJob(store, { organizationId: ORGANIZATION_ID, jobId: job.id }),
    ).rejects.toThrow(DomainError);
  });

  it("is an indistinguishable NotFoundError for an unknown or other-organization id", async () => {
    const store = new FakeJobStore();
    const { job } = await seedWithDeadLetteredOutbox(store, ORGANIZATION_ID);

    await expect(
      discardDeadLetteredJob(store, { organizationId: ORGANIZATION_ID, jobId: randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      discardDeadLetteredJob(store, { organizationId: OTHER_ORGANIZATION_ID, jobId: job.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
