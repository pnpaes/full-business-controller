import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "../client";
import { outboxEvent } from "../schema";

export type OutboxEvent = typeof outboxEvent.$inferSelect;
export type NewOutboxEvent = typeof outboxEvent.$inferInsert;

/*
 * `ADR-0004` (accepted 2026-09-26) shape **P2**: `outbox_event` is the durable
 * source of truth for the jobs/outbox platform, and the dedup key is
 * `outbox_event.id`. This is the missing write path over a table that has been
 * live since `0001` but had no repository.
 *
 * A row is one event fact: `published_at` is stamped once the runner queue has
 * accepted it, `attempts` counts delivery attempts and `dead_lettered_at` marks
 * a row that exhausted them. The unpublished scan is backed by the partial index
 * `outbox_unpublished_idx (occurred_at) where published_at is null`, so a runner
 * can rebuild a lost/disposable queue by replaying unpublished rows in
 * `occurred_at` order. `organization_id` is carried directly, so every read and
 * write that takes the organization is scoped by it (`DEC-061`).
 */

/** Inserts one outbox event and returns the durable row (the dedup key). */
export async function insertOutboxEvent(db: Database, input: NewOutboxEvent): Promise<OutboxEvent> {
  const rows = await db.insert(outboxEvent).values(input).returning();
  return rows[0]!;
}

export interface UnpublishedOutboxEventKey {
  readonly organizationId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
}

/**
 * The oldest **unpublished** event matching `(organization_id, aggregate_type,
 * aggregate_id, event_type)`, or `undefined`. Backs the enqueue dedup rule: while
 * an event of the same key is still unpublished, a re-enqueue is a no-op rather
 * than a duplicate (a published row is history and does not block a new event).
 */
export async function findUnpublishedOutboxEventByKey(
  db: Database,
  query: UnpublishedOutboxEventKey,
): Promise<OutboxEvent | undefined> {
  const rows = await db
    .select()
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.organizationId, query.organizationId),
        eq(outboxEvent.aggregateType, query.aggregateType),
        eq(outboxEvent.aggregateId, query.aggregateId),
        eq(outboxEvent.eventType, query.eventType),
        isNull(outboxEvent.publishedAt),
      ),
    )
    .orderBy(asc(outboxEvent.occurredAt), asc(outboxEvent.id))
    .limit(1);
  return rows[0];
}

/** Stamps `published_at` (the queue accepted the event); `undefined` on a miss. */
export async function markOutboxEventPublished(
  db: Database,
  outboxEventId: string,
): Promise<OutboxEvent | undefined> {
  const rows = await db
    .update(outboxEvent)
    .set({ publishedAt: new Date() })
    .where(eq(outboxEvent.id, outboxEventId))
    .returning();
  return rows[0];
}

/** Increments `attempts` by one (a delivery attempt); `undefined` on a miss. */
export async function recordOutboxEventAttempt(
  db: Database,
  outboxEventId: string,
): Promise<OutboxEvent | undefined> {
  const rows = await db
    .update(outboxEvent)
    .set({ attempts: sql`${outboxEvent.attempts} + 1` })
    .where(eq(outboxEvent.id, outboxEventId))
    .returning();
  return rows[0];
}

/** Stamps `dead_lettered_at` (attempts exhausted); `undefined` on a miss. */
export async function deadLetterOutboxEvent(
  db: Database,
  outboxEventId: string,
): Promise<OutboxEvent | undefined> {
  const rows = await db
    .update(outboxEvent)
    .set({ deadLetteredAt: new Date() })
    .where(eq(outboxEvent.id, outboxEventId))
    .returning();
  return rows[0];
}

/**
 * The oldest unpublished events for one organization, `occurred_at`-ascending
 * (then id), bounded by `limit`. This is the replay read a runner uses to rebuild
 * a disposable queue; the organization filter is never optional (`DEC-061`).
 */
export async function listUnpublishedOutboxEvents(
  db: Database,
  organizationId: string,
  limit: number,
): Promise<readonly OutboxEvent[]> {
  return db
    .select()
    .from(outboxEvent)
    .where(and(eq(outboxEvent.organizationId, organizationId), isNull(outboxEvent.publishedAt)))
    .orderBy(asc(outboxEvent.occurredAt), asc(outboxEvent.id))
    .limit(limit);
}
