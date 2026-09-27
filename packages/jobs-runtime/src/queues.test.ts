import { describe, expect, it } from "vitest";

import {
  DEAD_LETTER_QUEUE_OPTIONS,
  ensureQueues,
  OUTBOX_DEAD_LETTER_QUEUE,
  OUTBOX_QUEUE_OPTIONS,
  outboxQueueName,
  queueOptionsFor,
} from "./queues";
import { FakeBoss } from "./test-support";

describe("outbox queue configuration", () => {
  it("namespaces each event type into its own queue", () => {
    expect(outboxQueueName("platform.smoke")).toBe("outbox.platform.smoke");
    expect(outboxQueueName("sales.import.completed")).toBe("outbox.sales.import.completed");
  });

  it("uses the shared retry/backoff/DLQ policy", () => {
    expect(OUTBOX_QUEUE_OPTIONS).toMatchObject({
      retryLimit: 5,
      retryBackoff: true,
      retryDelay: 1,
      retryDelayMax: 3600,
      deadLetter: OUTBOX_DEAD_LETTER_QUEUE,
    });
  });

  it("ensures the dead-letter queue before the outbox queues", async () => {
    const boss = new FakeBoss();

    await ensureQueues(boss, ["outbox.platform.smoke", "outbox.platform.smoke"]);

    expect(boss.createdQueues.map((call) => call.name)).toEqual([
      OUTBOX_DEAD_LETTER_QUEUE,
      "outbox.platform.smoke",
    ]);
    expect(boss.updatedQueues.map((call) => call.name)).toEqual([
      OUTBOX_DEAD_LETTER_QUEUE,
      "outbox.platform.smoke",
    ]);
    expect(queueOptionsFor(OUTBOX_DEAD_LETTER_QUEUE)).toBe(DEAD_LETTER_QUEUE_OPTIONS);
  });
});
