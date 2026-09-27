import type { OutboxDispatchEvent, OutboxJobDispatcher } from "@aquarela/application";
import { fromDrizzle } from "pg-boss";
import type { DrizzleSqlTagLike, DrizzleTransactionLike } from "pg-boss";

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
      await boss.send(outboxQueueName(event.queue ?? event.eventType), outboxJobPayload(event), {
        id: event.id,
        db,
      });
      // send resolves null when the id already exists in the queue: idempotent no-op
    },
  };
}
