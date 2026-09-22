import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { auditColumns, enumCheck, orgId, tstz, uuidPk } from "./columns";
import { organization } from "./organization";
import {
  APPROVAL_DECISION,
  EXCEPTION_SEVERITY,
  EXCEPTION_STATUS,
  TASK_STATUS,
} from "./vocabularies";

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
 * (`transfer_discrepancy`, severity `high`, entity `stock_transfer`); the
 * count- and yield-variance producers landed 2026-09-21 (`DEC-084`) —
 * `count_variance` from count approval and `yield_variance` from batch
 * completion, recorded unconditionally pending the FIN tolerance thresholds.
 * `rule_code`/`entity_type` stay plain text because the rule set is open.
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

/*
 * `ADR-0006` / `DEC-085` (row-11 import-framework point 6): the storage-object
 * registry. One row is one stored file — the bytes live in object storage, this
 * table is the metadata authority. Schema-only for now: no storage client, no
 * signed URLs and no retention enforcement, so `retention_policy` stays
 * provisional free text (no vocabulary, no check — the `rule_code` precedent).
 *
 * `(organization_id, storage_key)` is unique: a storage key identifies exactly
 * one object within an organization (mirrors `import_profile_org_source_key`).
 * `uploaded_by` is a plain uuid (the `app_user` FK is deferred, like
 * `created_by`), and `(linked_entity_type, linked_entity_id)` is a polymorphic
 * target with no FK. `import_run.file_object_id` is a real FK (migration `0035`)
 * with a forward-only `file_object_org_guard` trigger (migration `0036`, the
 * `DEC-079` shape) so a run cannot link another organization's file.
 */
export const fileObject = pgTable(
  "file_object",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    // Object sizes are counted in bytes; `>= 0` is enforced below.
    // ponytail: `{ mode: "number" }` is exact only up to 2^53-1 bytes (~9 PB);
    // a larger file would silently lose bytes on the JS round-trip. If
    // petabyte files ever become real, switch to `{ mode: "bigint" }` or
    // `numeric(19,0)`.
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    // ponytail: the expected value is 64 lowercase hex chars (SHA-256), but the
    // column stays unconstrained free text — provisional, the `DEC-071`
    // precedent. Once the upload path closes the format, add
    // `CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$')`.
    checksumSha256: text("checksum_sha256").notNull(),
    retentionPolicy: text("retention_policy").notNull(),
    uploadedBy: uuid("uploaded_by"),
    uploadedAt: tstz("uploaded_at").notNull().defaultNow(),
    linkedEntityType: text("linked_entity_type"),
    linkedEntityId: uuid("linked_entity_id"),
    ...auditColumns(),
  },
  (t) => [
    check("file_object_size_bytes_check", sql`${t.sizeBytes} >= 0`),
    unique("file_object_org_storage_key_key").on(t.organizationId, t.storageKey),
  ],
);

/*
 * `DEC-094` (the schema-only workflow platform): the `task` and `approval`
 * platform tables, built now with no ADR dependency. This is the schema-only
 * host for ownership and due-dates: `task` records a unit of follow-up work
 * (its `type`/`priority` are free text — no vocabulary authority in the spec,
 * the `equipment.kind`/`DEC-097` precedent), and `approval` records a
 * polymorphic approval request on `(entity_type, entity_id)` with an
 * all-or-nothing decision.
 *
 * The `job` table, the worker/scheduler and the outbox async layer are
 * deliberately **not** built here: they are gated on `ADR-0004`, still
 * `Proposed`, so `created_from_event_id` stays a **plain uuid** rather than an
 * FK to `outbox_event` (the outbox table exists but the workflow link is not
 * part of this slice). `task` has no `location_id` — the `corrective_action`
 * location-scope ceiling: a task is organization-scoped, and a location-scoped
 * task is not modelled until the spec defines one. `HMS-001`'s task/approval
 * link is not defined by the spec, so no FK joins them (recorded open conflict,
 * `DEC-094`).
 *
 * Both tables are mutable (not append-only) and carry the standard
 * `auditColumns()`. `owner_id`/`requested_by`/`decided_by` are plain uuids (the
 * `app_user` FK is deferred repo-wide); `approval.entity_id` is a plain uuid
 * (polymorphic target, no single FK — the `data_quality_exception.entity_id`
 * precedent) and `approval.entity_version` matches `audit_event.entity_version`.
 * A `task` is either standalone or linked: `task_linked_entity_check` requires
 * `linked_entity_type` and `linked_entity_id` to be both null or both set. An
 * `approval` is undecided while `decision is null` (the `approval_decision` yaml
 * has no `pending` value); `approval_decided_check` requires the
 * `decided_by`/`decided_at`/`decision` triple all-null or all-set.
 */
export const task = pgTable(
  "task",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    type: text("type").notNull(),
    linkedEntityType: text("linked_entity_type"),
    linkedEntityId: uuid("linked_entity_id"),
    ownerId: uuid("owner_id"),
    dueDate: date("due_date"),
    priority: text("priority").notNull(),
    status: text("status").notNull().default("open"),
    resolution: text("resolution"),
    createdFromEventId: uuid("created_from_event_id"),
    ...auditColumns(),
  },
  (t) => [
    check("task_status_check", enumCheck(t.status, TASK_STATUS)),
    check(
      "task_linked_entity_check",
      sql`(${t.linkedEntityType} is null) = (${t.linkedEntityId} is null)`,
    ),
    index("task_org_status_idx").on(t.organizationId, t.status),
    index("task_org_owner_due_idx").on(t.organizationId, t.ownerId, t.dueDate),
    index("task_org_linked_idx").on(t.organizationId, t.linkedEntityType, t.linkedEntityId),
  ],
);

export const approval = pgTable(
  "approval",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    entityVersion: integer("entity_version"),
    requestedBy: uuid("requested_by").notNull(),
    requestedAt: tstz("requested_at").notNull(),
    decidedBy: uuid("decided_by"),
    decidedAt: tstz("decided_at"),
    decision: text("decision"),
    comment: text("comment"),
    ...auditColumns(),
  },
  (t) => [
    check("approval_decision_check", enumCheck(t.decision, APPROVAL_DECISION)),
    check(
      "approval_decided_check",
      sql`(${t.decidedBy} is null and ${t.decidedAt} is null and ${t.decision} is null) or (${t.decidedBy} is not null and ${t.decidedAt} is not null and ${t.decision} is not null)`,
    ),
    index("approval_org_entity_idx").on(t.organizationId, t.entityType, t.entityId),
    index("approval_org_decision_idx").on(t.organizationId, t.decision),
  ],
);
