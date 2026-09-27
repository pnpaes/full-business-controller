import { markJobRunning, markJobSucceeded } from "@aquarela/application";
import type { OutboxEventRecord } from "@aquarela/application";
import type { Job } from "pg-boss";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { FakeJobStore } from "../../application/src/jobs/test-support";
import { createOutboxConsumer } from "./consumer";
import { outboxQueueName } from "./queues";
import type { OutboxJobPayload } from "./queues";

const ORGANIZATION_ID = randomUUID();

function payloadOf(event: OutboxEventRecord): OutboxJobPayload {
  return {
    id: event.id,
    organizationId: event.organizationId,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
  };
}

function makeJob(payload: OutboxJobPayload): Job<OutboxJobPayload> {
  return {
    id: payload.id,
    name: outboxQueueName(payload.eventType),
    data: payload,
    expireInSeconds: 300,
    heartbeatSeconds: null,
    signal: new AbortController().signal,
  };
}

async function seed(
  store: FakeJobStore,
  maxAttempts = 5,
): Promise<{ event: OutboxEventRecord; jobId: string }> {
  const event = await store.insertOutboxEvent({
    organizationId: ORGANIZATION_ID,
    eventType: "platform.smoke",
    aggregateType: "smoke",
    aggregateId: randomUUID(),
    payload: { note: "smoke" },
  });
  const job = await store.createScheduledJob({
    organizationId: ORGANIZATION_ID,
    queue: "platform.smoke",
    kind: "platform.smoke",
    payload: { note: "smoke" },
    maxAttempts,
    outboxEventId: event.id,
  });
  return { event, jobId: job.id };
}

describe("createOutboxConsumer", () => {
  it("runs the handler, then marks the projection succeeded, the outbox published and audits", async () => {
    const store = new FakeJobStore();
    const { event, jobId } = await seed(store);
    const seen: string[] = [];
    const consumer = createOutboxConsumer({
      store,
      handlers: {
        "platform.smoke": async (context) => {
          seen.push(context.outboxEventId);
        },
      },
    });

    await consumer([makeJob(payloadOf(event))]);

    expect(seen).toEqual([event.id]);
    const projection = await store.findJobById(ORGANIZATION_ID, jobId);
    expect(projection).toMatchObject({ status: "succeeded", attempts: 1 });
    expect(projection!.finishedAt).toBeInstanceOf(Date);
    expect(store.outboxEvents[0]!.publishedAt).toBeInstanceOf(Date);
    expect(store.audits.map((audit) => audit.action)).toContain("jobs.job.consumed");
  });

  it("skips an already-succeeded projection but still stamps the outbox published", async () => {
    const store = new FakeJobStore();
    const { event, jobId } = await seed(store);
    await markJobRunning(store, jobId, 1, { organizationId: ORGANIZATION_ID });
    await markJobSucceeded(store, jobId, { organizationId: ORGANIZATION_ID });

    let called = false;
    const consumer = createOutboxConsumer({
      store,
      handlers: {
        "platform.smoke": async () => {
          called = true;
        },
      },
    });

    await consumer([makeJob(payloadOf(event))]);

    expect(called).toBe(false);
    expect(store.outboxEvents[0]!.publishedAt).toBeInstanceOf(Date);
  });

  it("records the attempt and marks the projection failed on a handler throw", async () => {
    const store = new FakeJobStore();
    const { event, jobId } = await seed(store);
    const consumer = createOutboxConsumer({
      store,
      handlers: {
        "platform.smoke": async () => {
          throw new Error("boom");
        },
      },
    });

    await expect(consumer([makeJob(payloadOf(event))])).rejects.toThrow("boom");

    expect(store.outboxEvents[0]!.attempts).toBe(1);
    const projection = await store.findJobById(ORGANIZATION_ID, jobId);
    expect(projection).toMatchObject({ status: "failed", error: "boom" });
    expect(store.outboxEvents[0]!.deadLetteredAt).toBeNull();
    expect(store.audits.map((audit) => audit.action)).toContain("jobs.job.failed");
  });

  it("dead-letters the projection and the outbox once attempts are exhausted", async () => {
    const store = new FakeJobStore();
    const { event, jobId } = await seed(store, 1);
    const consumer = createOutboxConsumer({
      store,
      handlers: {
        "platform.smoke": async () => {
          throw new Error("final failure");
        },
      },
    });

    await expect(consumer([makeJob(payloadOf(event))])).rejects.toThrow("final failure");

    const projection = await store.findJobById(ORGANIZATION_ID, jobId);
    expect(projection).toMatchObject({ status: "dead_lettered", attempts: 1, maxAttempts: 1 });
    expect(store.outboxEvents[0]!.deadLetteredAt).toBeInstanceOf(Date);
    expect(store.audits.map((audit) => audit.action)).toContain("jobs.job.dead_lettered");
  });

  it("throws when no handler is registered for the delivered event type", async () => {
    const store = new FakeJobStore();
    const { event } = await seed(store);
    const consumer = createOutboxConsumer({ store, handlers: {} });

    await expect(consumer([makeJob(payloadOf(event))])).rejects.toThrow(
      'no outbox handler registered for event type "platform.smoke"',
    );
  });
});
