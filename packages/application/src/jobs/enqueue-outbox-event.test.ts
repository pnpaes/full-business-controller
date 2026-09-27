import { DomainError } from "@aquarela/domain";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { enqueueOutboxEvent, type EnqueueOutboxEventInput } from "./enqueue-outbox-event";
import { FakeJobStore, FakeOutboxJobDispatcher } from "./test-support";

const ORGANIZATION_ID = randomUUID();

function baseInput(overrides: Partial<EnqueueOutboxEventInput> = {}): EnqueueOutboxEventInput {
  return {
    organizationId: ORGANIZATION_ID,
    eventType: "sales.import.completed",
    aggregateType: "import_run",
    aggregateId: randomUUID(),
    payload: { runId: randomUUID() },
    ...overrides,
  };
}

describe("enqueueOutboxEvent", () => {
  it("inserts the outbox event, creates the projection, dispatches and audits in one transaction", async () => {
    const store = new FakeJobStore();
    const dispatcher = new FakeOutboxJobDispatcher();

    const input = baseInput();
    const result = await enqueueOutboxEvent(store, input, dispatcher);

    expect(store.outboxEvents).toHaveLength(1);
    const event = store.outboxEvents[0]!;
    expect(event.id).toBe(result.outboxEventId);
    expect(event).toMatchObject({
      organizationId: ORGANIZATION_ID,
      eventType: "sales.import.completed",
      eventVersion: 1,
      aggregateType: "import_run",
      aggregateId: input.aggregateId,
      publishedAt: null,
      attempts: 0,
      deadLetteredAt: null,
    });

    expect(store.jobs).toHaveLength(1);
    const job = store.jobs[0]!;
    expect(job.id).toBe(result.jobId);
    expect(job).toMatchObject({
      organizationId: ORGANIZATION_ID,
      queue: "sales.import.completed",
      kind: "sales.import.completed",
      status: "pending",
      attempts: 0,
      maxAttempts: 5,
      outboxEventId: result.outboxEventId,
    });

    expect(dispatcher.dispatched).toHaveLength(1);
    expect(dispatcher.dispatched[0]!.id).toBe(result.outboxEventId);
    expect(dispatcher.dispatched[0]!.queue).toBe("sales.import.completed");

    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({
      organizationId: ORGANIZATION_ID,
      action: "jobs.outbox_event.enqueued",
      entityType: "outbox_event",
      entityId: result.outboxEventId,
    });
  });

  it("dispatches to the explicit queue override when one is supplied", async () => {
    const store = new FakeJobStore();
    const dispatcher = new FakeOutboxJobDispatcher();

    await enqueueOutboxEvent(store, baseInput({ queue: "imports.heavy" }), dispatcher);

    expect(dispatcher.dispatched).toHaveLength(1);
    expect(dispatcher.dispatched[0]!.queue).toBe("imports.heavy");
  });

  it("dedups a repeat enqueue while the natural-key event is unpublished", async () => {
    const store = new FakeJobStore();
    const dispatcher = new FakeOutboxJobDispatcher();

    const input = baseInput();
    const first = await enqueueOutboxEvent(store, input, dispatcher);
    const second = await enqueueOutboxEvent(
      store,
      { ...input, payload: { runId: "different-but-same-key" } },
      dispatcher,
    );

    expect(second).toEqual(first);
    expect(store.outboxEvents).toHaveLength(1);
    expect(store.jobs).toHaveLength(1);
    expect(dispatcher.dispatched).toHaveLength(1);
    expect(store.audits).toHaveLength(1);
  });

  it("does not suppress a repeat once the earlier event is published", async () => {
    const store = new FakeJobStore();
    const dispatcher = new FakeOutboxJobDispatcher();

    const input = baseInput();
    const first = await enqueueOutboxEvent(store, input, dispatcher);
    await store.markPublished(first.outboxEventId);

    const second = await enqueueOutboxEvent(store, input, dispatcher);

    expect(second.outboxEventId).not.toBe(first.outboxEventId);
    expect(store.outboxEvents).toHaveLength(2);
    expect(store.jobs).toHaveLength(2);
    expect(dispatcher.dispatched).toHaveLength(2);
  });

  it("rolls the outbox insert and the projection back when the dispatch fails", async () => {
    const store = new FakeJobStore();
    const dispatcher = new FakeOutboxJobDispatcher();
    dispatcher.failNext = new Error("queue unavailable");

    await expect(enqueueOutboxEvent(store, baseInput(), dispatcher)).rejects.toThrow(
      "queue unavailable",
    );

    expect(store.outboxEvents).toHaveLength(0);
    expect(store.jobs).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
    expect(dispatcher.dispatched).toHaveLength(0);
  });

  it("rejects a blank eventType, a non-uuid aggregateId and a non-object payload", async () => {
    const store = new FakeJobStore();
    const dispatcher = new FakeOutboxJobDispatcher();

    await expect(
      enqueueOutboxEvent(store, baseInput({ eventType: "  " }), dispatcher),
    ).rejects.toThrow(DomainError);
    await expect(
      enqueueOutboxEvent(store, baseInput({ aggregateId: "not-a-uuid" }), dispatcher),
    ).rejects.toThrow(DomainError);
    await expect(
      enqueueOutboxEvent(
        store,
        baseInput({ payload: ["not", "object"] as unknown as Record<string, unknown> }),
        dispatcher,
      ),
    ).rejects.toThrow(DomainError);

    expect(store.outboxEvents).toHaveLength(0);
  });
});
