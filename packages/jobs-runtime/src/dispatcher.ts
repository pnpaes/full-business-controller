import type { OutboxDispatchEvent, OutboxJobDispatcher } from "@aquarela/application";
import { fromDrizzle } from "pg-boss";
import type { DrizzleSqlTagLike, DrizzleTransactionLike, SendOptions } from "pg-boss";

import type { BossSendApi } from "./boss";
import { outboxJobPayload, outboxQueueName } from "./queues";

/**
 * The P2 seam implementation (`ADR-0004` shape P2): the dispatcher is bound to the
 * caller's Drizzle transaction through pg-boss's `fromDrizzle` adapter, so the
 * queue insert commits or rolls back with the outbox row and the job projection.
 *
 * `event.id` (the outbox row id) is the queue job id. A duplicate id is
 * `ON CONFLICT DO NOTHING` and `send` resolves `null` — an idempotent no-op, not
 * an error. Any other failure propagates so the caller's transaction rolls back.
 *
 * Delayed delivery: when `event.scheduledAt` is set, it is passed as pg-boss
 * `startAfter`, so the runner holds the job until that instant. A past value is
 * harmless (pg-boss delivers immediately). Unscheduled/`null` events are sent
 * with no `startAfter`, exactly as before.
 *
 * Construct one per transaction: `createPgBossDispatcher(boss, tx, sql)`.
 */
export function createPgBossDispatcher(
  boss: BossSendApi,
  tx: DrizzleTransactionLike,
  sql: DrizzleSqlTagLike,
): OutboxJobDispatcher {
  const db = fromDrizzle(tx, sql);
  return {
    async dispatch(event: OutboxDispatchEvent): Promise<void> {
      const options: SendOptions = { id: event.id, db };
      if (event.scheduledAt !== undefined && event.scheduledAt !== null) {
        options.startAfter = event.scheduledAt;
      }
      await boss.send(
        outboxQueueName(event.queue ?? event.eventType),
        outboxJobPayload(event),
        options,
      );
      // send resolves null when the id already exists in the queue: idempotent no-op
    },
  };
}
