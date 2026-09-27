import { createPostgresJobStore, enqueueOutboxEvent } from "@aquarela/application";
import type { EnqueueOutboxEventInput, EnqueueOutboxEventResult } from "@aquarela/application";
import type { NodeDatabase } from "@aquarela/persistence";
import { sql } from "drizzle-orm";

import type { BossSendApi } from "./boss";
import { createPgBossDispatcher } from "./dispatcher";

/**
 * The shared transactional **producer** seam (`ADR-0004` shape P2). One
 * transaction commits the durable `outbox_event`, the `job` projection, the
 * pg-boss queue insert and the audit fact together, or rolls them all back —
 * the dispatcher is bound to the same Drizzle transaction via `fromDrizzle`.
 *
 * Extracted from the payroll schedule so every producer (the scheduler cron and
 * the web `202` route) shares exactly one enqueue path. `input.queue` is the
 * **bare** runner queue name: the dispatcher applies `outboxQueueName` itself.
 */
export async function enqueueJobWithDispatch(
  boss: BossSendApi,
  db: NodeDatabase,
  input: EnqueueOutboxEventInput,
): Promise<EnqueueOutboxEventResult> {
  return db.transaction(async (tx) =>
    enqueueOutboxEvent(createPostgresJobStore(tx), input, createPgBossDispatcher(boss, tx, sql)),
  );
}
