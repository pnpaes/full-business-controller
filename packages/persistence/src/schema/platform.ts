import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { auditColumns, enumCheck, orgId, tstz, uuidPk } from "./columns";
import { organization } from "./organization";
import { EXCEPTION_SEVERITY, EXCEPTION_STATUS } from "./vocabularies";

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

/*
 * `DEC-080` (`DATA_DICTIONARY` §9, `DQ-001`): the data-quality exception store.
 * One row is one detected problem with a named `rule_code` on a polymorphic
 * `(entity_type, entity_id)` target; `severity` and `status` are constrained by
 * the `exception_severity` / `exception_status` vocabularies. `entity_id` is a
 * plain uuid (no FK — a polymorphic target cannot be a single FK, the
 * deferred-FK convention), as is `owner_id` (an `app_user` id, left plain like
 * `created_by`). `rule_code` stays provisional free text: the rule set is
 * growing and has no closed vocabulary yet (the `DEC-071` precedent).
 *
 * The first producer is `receiveStockTransfer`'s transfer discrepancy
 * (`transfer_discrepancy`, severity `high`, entity `stock_transfer`); the count
 * and yield variances (`PROD-003`) are expected producers later, which is why
 * `rule_code`/`entity_type` are plain text.
 */
export const dataQualityException = pgTable(
  "data_quality_exception",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    ruleCode: text("rule_code").notNull(),
    severity: text("severity").notNull().default("medium"),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    detectedAt: tstz("detected_at").notNull().defaultNow(),
    ownerId: uuid("owner_id"),
    dueDate: date("due_date"),
    status: text("status").notNull().default("open"),
    resolution: text("resolution"),
    ...auditColumns(),
  },
  (t) => [
    check("data_quality_exception_severity_check", enumCheck(t.severity, EXCEPTION_SEVERITY)),
    check("data_quality_exception_status_check", enumCheck(t.status, EXCEPTION_STATUS)),
    index("data_quality_exception_org_status_idx").on(
      t.organizationId,
      t.status,
      t.severity,
      t.detectedAt,
    ),
    index("data_quality_exception_org_entity_idx").on(t.organizationId, t.entityType, t.entityId),
  ],
);
