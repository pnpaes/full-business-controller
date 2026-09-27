/**
 * The **P2 seam** (`ADR-0004` shape P2): the runtime implements this port with
 * pg-boss's Drizzle-transaction adapter (`fromDrizzle`), binding the queue to the
 * same transaction the outbox insert runs in. The application must NOT import
 * pg-boss — it only calls `dispatch` inside its own `withTransaction`, so a
 * dispatch failure rolls the outbox insert and the job projection back with it.
 *
 * `event.id` is the outbox row id (the dedup key the runtime should use as the
 * queue job id, so a replay is idempotent); the remaining fields are the routing
 * metadata the runner needs without re-reading the row.
 */
export interface OutboxDispatchEvent {
  readonly id: string;
  readonly organizationId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** The runner queue to route to; `enqueueOutboxEvent` defaults it to the event type. */
  readonly queue: string;
  /**
   * Delayed delivery: when set, the runtime must not deliver before this instant
   * (pg-boss `startAfter`). `null`/absent means deliver immediately.
   */
  readonly scheduledAt?: Date | null;
}

export interface OutboxJobDispatcher {
  dispatch(event: OutboxDispatchEvent): Promise<void>;
}
