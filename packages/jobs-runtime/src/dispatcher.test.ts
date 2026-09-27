import type { OutboxDispatchEvent } from "@aquarela/application";
import type { DrizzleSqlTagLike, DrizzleTransactionLike } from "pg-boss";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createPgBossDispatcher } from "./dispatcher";
import { outboxQueueName } from "./queues";
import { FakeBoss } from "./test-support";

const TX: DrizzleTransactionLike = {
  execute: () => Promise.resolve({ rows: [] }),
};

const SQL: DrizzleSqlTagLike = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  { param: (value: unknown) => value },
);

function dispatchEvent(overrides: Partial<OutboxDispatchEvent> = {}): OutboxDispatchEvent {
  const eventType = overrides.eventType ?? "platform.smoke";
  return {
    id: randomUUID(),
    organizationId: randomUUID(),
    eventType,
    aggregateType: "smoke",
    aggregateId: randomUUID(),
    queue: overrides.queue ?? eventType,
    ...overrides,
  };
}

describe("createPgBossDispatcher", () => {
  it("sends to the event's queue under the outbox id with a transaction db", async () => {
    const boss = new FakeBoss();
    const dispatcher = createPgBossDispatcher(boss, TX, SQL);
    const event = dispatchEvent();

    await dispatcher.dispatch(event);

    expect(boss.sent).toHaveLength(1);
    expect(boss.sent[0]!.name).toBe(outboxQueueName("platform.smoke"));
    expect(boss.sent[0]!.options?.id).toBe(event.id);
    expect(boss.sent[0]!.options?.db).toBeDefined();
    expect(boss.sent[0]!.data).toMatchObject({
      id: event.id,
      organizationId: event.organizationId,
      eventType: "platform.smoke",
    });
  });

  it("routes to an explicit queue override", async () => {
    const boss = new FakeBoss();
    const dispatcher = createPgBossDispatcher(boss, TX, SQL);

    await dispatcher.dispatch(dispatchEvent({ queue: "custom.queue" }));

    expect(boss.sent[0]!.name).toBe(outboxQueueName("custom.queue"));
  });

  it("passes startAfter only when the event is scheduled", async () => {
    const boss = new FakeBoss();
    const dispatcher = createPgBossDispatcher(boss, TX, SQL);
    const scheduledAt = new Date("2026-07-01T12:00:00.000Z");

    await dispatcher.dispatch(dispatchEvent({ scheduledAt }));
    await dispatcher.dispatch(dispatchEvent({ scheduledAt: null }));
    await dispatcher.dispatch(dispatchEvent());

    expect(boss.sent).toHaveLength(3);
    expect(boss.sent[0]!.options?.startAfter).toBe(scheduledAt);
    expect(boss.sent[1]!.options).not.toHaveProperty("startAfter");
    expect(boss.sent[2]!.options).not.toHaveProperty("startAfter");
  });

  it("treats a null send result (duplicate id) as an idempotent no-op", async () => {
    const boss = new FakeBoss();
    boss.sendResult = () => null;
    const dispatcher = createPgBossDispatcher(boss, TX, SQL);

    await expect(dispatcher.dispatch(dispatchEvent())).resolves.toBeUndefined();
    expect(boss.sent).toHaveLength(1);
  });

  it("propagates a send failure so the caller's transaction rolls back", async () => {
    const boss = new FakeBoss();
    boss.sendResult = () => {
      throw new Error("queue unavailable");
    };
    const dispatcher = createPgBossDispatcher(boss, TX, SQL);

    await expect(dispatcher.dispatch(dispatchEvent())).rejects.toThrow("queue unavailable");
  });
});
