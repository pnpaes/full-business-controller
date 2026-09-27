import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { auditColumns, enumCheck, jsonObject, orgId, tstz, uuidPk } from "./columns";
import { organization } from "./organization";

/*
 * `ADR-0004` accepted 2026-09-26 (per `DEC-062`), shape **P2**: the transactional
 * `outbox_event` table (`./platform`) is the durable source of truth and the
 * dedup key is `outbox_event.id`; the runner queue is disposable and swappable
 * by replaying unpublished rows. This `job` table is the **application job
 * projection** — the API-facing 202 job URL/progress record, *not* the runner's
 * own queue. The runner (pg-boss) keeps its own schema; a runtime adapter
 * (`OutboxJobDispatcher`, wired in a later wave) enqueues into that queue from
 * the same transaction that writes the outbox row, so the queue and the outbox
 * commit together and the queue can be rebuilt from the outbox at any time.
 *
 * The runner dependency (pg-boss) is deliberately **not** imported anywhere in
 * this package: the persistence/application layers only see the `outbox_event`
 * and `job` tables. `outbox_event_id` is a plain uuid (no FK — the outbox table
 * is the source of truth, mirroring `task.created_from_event_id`), so a job
 * projection can be rebuilt or replayed without a referential coupling to the
 * outbox row.
 *
 * The `status` allow-list is narrowed in the table only (the
 * `integration_source.system_type` precedent): it is a module-local list, not an
 * exported vocabulary and not a `schemas/domain-enums.yaml` key, because
 * `vocabularies.test.ts` requires every exported vocabulary to be yaml-backed.
 * The table is mutable (a job advances pending -> running -> succeeded/failed/
 * dead_lettered) and carries the standard `auditColumns()`.
 */

/** The `job` status vocabulary, constrained in the table only (see above). */
const JOB_STATUS = ["pending", "running", "succeeded", "failed", "dead_lettered"] as const;

export const job = pgTable(
  "job",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    /** The runner queue name (pg-boss queue); `kind` is the application job type. */
    queue: text("queue").notNull(),
    kind: text("kind").notNull(),
    payload: jsonObject("payload"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    scheduledAt: tstz("scheduled_at"),
    startedAt: tstz("started_at"),
    finishedAt: tstz("finished_at"),
    error: text("error"),
    /** Plain uuid: the outbox row is the source of truth (`task.created_from_event_id`). */
    outboxEventId: uuid("outbox_event_id"),
    ...auditColumns(),
  },
  (t) => [
    check("job_status_check", enumCheck(t.status, JOB_STATUS)),
    check("job_attempts_non_negative_check", sql`${t.attempts} >= 0 and ${t.maxAttempts} >= 0`),
    index("job_org_status_scheduled_idx").on(t.organizationId, t.status, t.scheduledAt),
    index("job_org_outbox_event_idx").on(t.organizationId, t.outboxEventId),
    index("job_org_created_at_idx").on(t.organizationId, t.createdAt),
  ],
);
