import { and, desc, eq, gte, lte } from "drizzle-orm";

import type { Database } from "../client";
import { auditEvent } from "../schema";

export type AuditEvent = typeof auditEvent.$inferSelect;
export type NewAuditEvent = typeof auditEvent.$inferInsert;

/**
 * Appends one audit fact. The table is append-only: `audit_event_immutable` and
 * `audit_event_no_truncate` triggers reject UPDATE/DELETE/TRUNCATE, and this
 * module deliberately exposes no update or delete function. It is itself written
 * to be called inside the same transaction as the security change it records.
 */
export async function writeAuditEvent(db: Database, input: NewAuditEvent): Promise<AuditEvent> {
  const rows = await db.insert(auditEvent).values(input).returning();
  return rows[0]!;
}

/** Audit facts for one entity (unordered); read-only companion for tests/reporting. */
export async function listAuditEventsForEntity(
  db: Database,
  entityType: string,
  entityId: string,
): Promise<AuditEvent[]> {
  return db
    .select()
    .from(auditEvent)
    .where(and(eq(auditEvent.entityType, entityType), eq(auditEvent.entityId, entityId)));
}

export interface ListAuditEventsQuery {
  readonly organizationId: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly action?: string;
  readonly actorId?: string;
  /** Inclusive lower bound on `occurred_at`. */
  readonly from?: Date;
  /** Inclusive upper bound on `occurred_at`. */
  readonly to?: Date;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Audit facts for one organization, newest `occurred_at` first (then `id`), with
 * optional entity/action/actor and time filters. The organization is never
 * optional (`DEC-061`), so the review read can never cross tenants; paging is
 * applied after the ordering. The table is append-only and read-only here, like
 * the rest of this module.
 */
export async function listAuditEvents(
  db: Database,
  query: ListAuditEventsQuery,
): Promise<AuditEvent[]> {
  const statement = db
    .select()
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.organizationId, query.organizationId),
        query.entityType === undefined ? undefined : eq(auditEvent.entityType, query.entityType),
        query.entityId === undefined ? undefined : eq(auditEvent.entityId, query.entityId),
        query.action === undefined ? undefined : eq(auditEvent.action, query.action),
        query.actorId === undefined ? undefined : eq(auditEvent.actorId, query.actorId),
        query.from === undefined ? undefined : gte(auditEvent.occurredAt, query.from),
        query.to === undefined ? undefined : lte(auditEvent.occurredAt, query.to),
      ),
    )
    .orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}
