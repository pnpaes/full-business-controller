import { DomainError } from "@aquarela/domain";

import { JOB_AUDIT_ACTIONS, OUTBOX_EVENT_ENTITY_TYPE } from "./actions";
import type { OutboxJobDispatcher } from "./dispatch";
import type { JobRecord, OutboxEventRecord, OutboxJobStore } from "./types";
import { assertUuid, requiredText } from "./validation";

export interface EnqueueOutboxEventInput {
  readonly organizationId: string;
  readonly eventType: string;
  readonly eventVersion?: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  /** The runner queue name; defaults to `eventType`. */
  readonly queue?: string;
  /** The application job kind; defaults to `eventType`. */
  readonly kind?: string;
  readonly scheduledAt?: Date | null;
  /** Defaults to 5 (matching the `job.max_attempts` default). */
  readonly maxAttempts?: number;
  /** The acting user; `null` (the default) means system-initiated. */
  readonly actorId?: string | null;
}

export interface EnqueueOutboxEventResult {
  readonly outboxEventId: string;
  readonly jobId: string;
}

interface NormalizedEnqueueInput {
  readonly organizationId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  readonly queue: string;
  readonly kind: string;
  readonly scheduledAt: Date | null;
  readonly maxAttempts: number;
  readonly actorId: string | null;
}

function normalizeEnqueueInput(input: EnqueueOutboxEventInput): NormalizedEnqueueInput {
  const organizationId = requiredText(input.organizationId, "organizationId");
  const eventType = requiredText(input.eventType, "eventType");
  const aggregateType = requiredText(input.aggregateType, "aggregateType");
  assertUuid(input.aggregateId, "aggregateId");

  if (typeof input.payload !== "object" || input.payload === null || Array.isArray(input.payload)) {
    throw new DomainError("payload must be an object");
  }

  const eventVersion = input.eventVersion ?? 1;
  if (!Number.isInteger(eventVersion) || eventVersion < 1) {
    throw new DomainError("eventVersion must be a positive integer");
  }

  const maxAttempts = input.maxAttempts ?? 5;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new DomainError("maxAttempts must be a positive integer");
  }

  return {
    organizationId,
    eventType,
    eventVersion,
    aggregateType,
    aggregateId: input.aggregateId,
    payload: input.payload,
    queue: requiredText(input.queue ?? eventType, "queue"),
    kind: requiredText(input.kind ?? eventType, "kind"),
    scheduledAt: input.scheduledAt ?? null,
    maxAttempts,
    actorId: input.actorId ?? null,
  };
}

/**
 * Creates the projection for an existing outbox event if it is somehow missing
 * (self-heal), so an idempotent re-enqueue can return a `jobId` without a second
 * event or a second dispatch. Enqueue normally creates both rows atomically, so
 * this is a defensive branch, not the common path.
 */
async function ensureProjection(
  tx: OutboxJobStore,
  event: OutboxEventRecord,
  input: NormalizedEnqueueInput,
): Promise<JobRecord> {
  const existing = await tx.findJobByOutboxEventId(input.organizationId, event.id);
  if (existing !== undefined) {
    return existing;
  }
  return tx.createScheduledJob({
    organizationId: input.organizationId,
    queue: input.queue,
    kind: input.kind,
    payload: input.payload,
    scheduledAt: input.scheduledAt,
    maxAttempts: input.maxAttempts,
    outboxEventId: event.id,
    actorId: input.actorId,
  });
}

/**
 * The enqueue command (`ADR-0004` shape P2). Inside **one** `withTransaction` it
 * (1) dedups, (2) inserts the durable `outbox_event`, (3) creates the `job`
 * projection, (4) calls the dispatcher **within the same transaction** and (5)
 * audits. Because the dispatch runs inside the transaction, a dispatch failure
 * throws out of the transaction and rolls the outbox row and the projection back
 * with it — the queue and the outbox can never diverge (the runtime binds pg-boss
 * to the same transaction via its Drizzle adapter).
 *
 * **Dedup rule (application-level idempotency):** while an event with the same
 * `(organizationId, aggregateType, aggregateId, eventType)` is still
 * **unpublished**, a re-enqueue is a no-op that returns the existing
 * `outboxEventId` and the existing `jobId`. A *published* outbox row is history
 * and does not block a new event of the same natural key, so a legitimate repeat
 * after delivery is not suppressed.
 */
export async function enqueueOutboxEvent(
  store: OutboxJobStore,
  input: EnqueueOutboxEventInput,
  dispatcher: OutboxJobDispatcher,
): Promise<EnqueueOutboxEventResult> {
  const normalized = normalizeEnqueueInput(input);

  return store.withTransaction(async (tx) => {
    const existing = await tx.findUnpublishedByKey({
      organizationId: normalized.organizationId,
      aggregateType: normalized.aggregateType,
      aggregateId: normalized.aggregateId,
      eventType: normalized.eventType,
    });
    if (existing !== undefined) {
      const projection = await ensureProjection(tx, existing, normalized);
      return { outboxEventId: existing.id, jobId: projection.id };
    }

    const event = await tx.insertOutboxEvent({
      organizationId: normalized.organizationId,
      eventType: normalized.eventType,
      eventVersion: normalized.eventVersion,
      aggregateType: normalized.aggregateType,
      aggregateId: normalized.aggregateId,
      payload: normalized.payload,
    });

    const projection = await tx.createScheduledJob({
      organizationId: normalized.organizationId,
      queue: normalized.queue,
      kind: normalized.kind,
      payload: normalized.payload,
      scheduledAt: normalized.scheduledAt,
      maxAttempts: normalized.maxAttempts,
      outboxEventId: event.id,
      actorId: normalized.actorId,
    });

    await dispatcher.dispatch({
      id: event.id,
      organizationId: normalized.organizationId,
      eventType: normalized.eventType,
      aggregateType: normalized.aggregateType,
      aggregateId: normalized.aggregateId,
      queue: normalized.queue,
    });

    await tx.writeAudit({
      organizationId: normalized.organizationId,
      actorId: normalized.actorId,
      action: JOB_AUDIT_ACTIONS.outboxEventEnqueued,
      entityType: OUTBOX_EVENT_ENTITY_TYPE,
      entityId: event.id,
      after: {
        event_type: normalized.eventType,
        event_version: normalized.eventVersion,
        aggregate_type: normalized.aggregateType,
        aggregate_id: normalized.aggregateId,
        job_id: projection.id,
      },
    });

    return { outboxEventId: event.id, jobId: projection.id };
  });
}
