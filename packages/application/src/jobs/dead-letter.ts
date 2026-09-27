import { DomainError, NotFoundError } from "@aquarela/domain";

import { JOB_AUDIT_ACTIONS, JOB_ENTITY_TYPE } from "./actions";
import type { JobRecord, JobStore } from "./types";
import { assertUuid, requiredText } from "./validation";

/**
 * The operator DLQ-review commands (`ADR-0004` P2; the weekly runbook's
 * "inspect `outbox-dead-letter`, read the `job` projection error, decide replay
 * vs discard" automated). Both read the projection org-scoped first, require it
 * to be `dead_lettered`, and transition it in one `withTransaction` with an audit
 * fact — the guarded status update and the audit commit together or not at all.
 *
 * A miss is a `NotFoundError` (→ 404, indistinguishable between an unknown id
 * and another organization's id, `DEC-061`); a row that exists but is not
 * `dead_lettered` is a `DomainError` (→ 400).
 */
export interface ReviewDeadLetteredJobInput {
  readonly organizationId: string;
  readonly jobId: string;
  /** The acting operator; `null` (the default) means system-initiated. */
  readonly actorId?: string | null;
}

/** Loads the job and asserts it is currently `dead_lettered`, or throws. */
async function requireDeadLetteredJob(
  store: JobStore,
  organizationId: string,
  jobId: string,
): Promise<JobRecord> {
  const job = await store.findJobById(organizationId, jobId);
  if (job === undefined) {
    throw new NotFoundError(`job ${jobId} not found in this organization`);
  }
  if (job.status !== "dead_lettered") {
    throw new DomainError(`job ${jobId} is not dead_lettered (status "${job.status}")`);
  }
  return job;
}

/**
 * **Retry**: resets a `dead_lettered` job to `pending` (`attempts = 0`, terminal
 * timestamps/error cleared) and clears the outbox dead-letter mark so the event
 * is re-sendable. Returns the reset projection so the caller can re-dispatch it
 * immediately; the projection mutation and the queue send are two steps, and the
 * maintenance replay is the safety net (the event is unpublished again).
 */
export async function retryDeadLetteredJob(
  store: JobStore,
  input: ReviewDeadLetteredJobInput,
): Promise<JobRecord> {
  assertUuid(input.jobId, "jobId");
  const organizationId = requiredText(input.organizationId, "organizationId");

  return store.withTransaction(async (tx) => {
    await requireDeadLetteredJob(tx, organizationId, input.jobId);

    const updated = await tx.resetDeadLetteredJob(organizationId, input.jobId);
    if (updated === undefined) {
      throw new DomainError(`job ${input.jobId} is no longer dead_lettered`);
    }

    if (updated.outboxEventId !== null) {
      await tx.clearDeadLetter(organizationId, updated.outboxEventId);
    }

    await tx.writeAudit({
      organizationId,
      actorId: input.actorId ?? null,
      action: JOB_AUDIT_ACTIONS.jobRetried,
      entityType: JOB_ENTITY_TYPE,
      entityId: input.jobId,
      before: { status: "dead_lettered" },
      after: {
        status: updated.status,
        attempts: updated.attempts,
        outbox_event_id: updated.outboxEventId,
      },
    });
    return updated;
  });
}

/**
 * **Discard**: moves a `dead_lettered` job to the terminal `failed` status,
 * keeping its recorded error. The outbox `dead_lettered_at` stays as the review
 * marker, but the row is stamped published so the maintenance replay cannot
 * resurrect a discarded job as a fresh run (`failed` is not a settled status, so
 * an unpublished row would otherwise be re-consumed). No queue send happens.
 */
export async function discardDeadLetteredJob(
  store: JobStore,
  input: ReviewDeadLetteredJobInput,
): Promise<JobRecord> {
  assertUuid(input.jobId, "jobId");
  const organizationId = requiredText(input.organizationId, "organizationId");

  return store.withTransaction(async (tx) => {
    await requireDeadLetteredJob(tx, organizationId, input.jobId);

    const updated = await tx.discardDeadLetteredJob(organizationId, input.jobId);
    if (updated === undefined) {
      throw new DomainError(`job ${input.jobId} is no longer dead_lettered`);
    }

    if (updated.outboxEventId !== null) {
      await tx.markPublished(updated.outboxEventId);
    }

    await tx.writeAudit({
      organizationId,
      actorId: input.actorId ?? null,
      action: JOB_AUDIT_ACTIONS.jobDiscarded,
      entityType: JOB_ENTITY_TYPE,
      entityId: input.jobId,
      before: { status: "dead_lettered" },
      after: { status: updated.status, outbox_event_id: updated.outboxEventId },
    });
    return updated;
  });
}
