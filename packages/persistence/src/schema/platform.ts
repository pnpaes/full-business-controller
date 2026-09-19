import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { orgId, tstz, uuidPk } from "./columns";
import { organization } from "./organization";

export const outboxEvent = pgTable(
  "outbox_event",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    eventType: text("event_type").notNull(),
    eventVersion: integer("event_version").notNull().default(1),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: tstz("occurred_at").notNull().defaultNow(),
    publishedAt: tstz("published_at"),
    attempts: integer("attempts").notNull().default(0),
    deadLetteredAt: tstz("dead_lettered_at"),
  },
  (t) => [
    index("outbox_unpublished_idx")
      .on(t.occurredAt)
      .where(sql`${t.publishedAt} is null`),
  ],
);

export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    actorId: uuid("actor_id"),
    impersonationContext: jsonb("impersonation_context"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    entityVersion: integer("entity_version"),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    requestId: text("request_id"),
    correlationId: text("correlation_id"),
    occurredAt: tstz("occurred_at").notNull().defaultNow(),
  },
  (t) => [index("audit_event_entity_idx").on(t.entityType, t.entityId, t.occurredAt)],
);

// audit_event_immutable / audit_event_no_truncate triggers are emitted in the
// raw `invariants` migration.
