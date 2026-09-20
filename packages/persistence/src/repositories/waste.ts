import { and, desc, eq, gte, lte } from "drizzle-orm";

import type { Database } from "../client";
import { wasteEvent } from "../schema";

export type WasteEvent = typeof wasteEvent.$inferSelect;
export type NewWasteEvent = typeof wasteEvent.$inferInsert;

export async function createWasteEvent(db: Database, input: NewWasteEvent): Promise<WasteEvent> {
  const rows = await db.insert(wasteEvent).values(input).returning();
  return rows[0]!;
}

export interface FindWasteEventQuery {
  readonly organizationId: string;
  readonly wasteEventId: string;
}

/** One waste event by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findWasteEvent(
  db: Database,
  query: FindWasteEventQuery,
): Promise<WasteEvent | undefined> {
  const rows = await db
    .select()
    .from(wasteEvent)
    .where(
      and(
        eq(wasteEvent.id, query.wasteEventId),
        eq(wasteEvent.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ListWasteEventsQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  readonly itemId?: string;
  readonly stage?: string;
  /** Filters `occurred_at >= occurredFrom`. */
  readonly occurredFrom?: Date;
  /** Filters `occurred_at <= occurredTo`. */
  readonly occurredTo?: Date;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Waste events for one organization, newest first (`occurred_at`, then `id`),
 * with optional location/item/stage and `occurred_at` window filters. Every
 * filter is optional except the organization, so the caller never sees another
 * tenant's rows.
 *
 * There is no natural key on `waste_event`, so there is deliberately no
 * `findOrCreate` path here (unlike `findOrCreateStockCountLine`).
 */
export async function listWasteEvents(
  db: Database,
  query: ListWasteEventsQuery,
): Promise<WasteEvent[]> {
  const statement = db
    .select()
    .from(wasteEvent)
    .where(
      and(
        eq(wasteEvent.organizationId, query.organizationId),
        query.locationId === undefined ? undefined : eq(wasteEvent.locationId, query.locationId),
        query.itemId === undefined ? undefined : eq(wasteEvent.itemId, query.itemId),
        query.stage === undefined ? undefined : eq(wasteEvent.stage, query.stage),
        query.occurredFrom === undefined
          ? undefined
          : gte(wasteEvent.occurredAt, query.occurredFrom),
        query.occurredTo === undefined ? undefined : lte(wasteEvent.occurredAt, query.occurredTo),
      ),
    )
    .orderBy(desc(wasteEvent.occurredAt), desc(wasteEvent.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}
