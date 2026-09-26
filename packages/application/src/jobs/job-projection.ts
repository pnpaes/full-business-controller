import { DomainError } from "@aquarela/domain";

import { JOB_AUDIT_ACTIONS, JOB_ENTITY_TYPE } from "./actions";
import type { JobRecord, JobStore } from "./types";
import { assertUuid, positiveInteger, requiredText } from "./validation";

/**
 * The worker-facing job-projection commands (`ADR-0004` shape P2). The runner
 * reports progress through these; each command is one `withTransaction`, so the
 * guarded status update and its audit row commit together or not at all. The
 * status guard lives in the database update predicate (see
 * `repositories/jobs.ts`), so a lost race surfaces as `undefined` and is raised
 * here as a `DomainError` rather than a partial write.
 *
 * The organization scope is required (`DEC-061`): the runner is trusted, but the
 * writes stay tenant-scoped like every other command.
 */
export interface JobCommandContext {
  readonly organizationId: string;
  /** The acting user; `null` (the default) means system-initiated. */
  readonly actorId?: string | null;
}

export interface MarkJobFailedOptions {
  /**
   * Force a dead-letter now (no retry). The command also dead-letters
   * automatically once `attempts >= maxAttempts` (the threshold), so a caller
   * that simply reports the last failure still ends terminal.
   */
  readonly deadLetter: boolean;
  readonly organizationId: string;
  readonly actorId?: string | null;
}

async function loadJob(store: JobStore, organizationId: string, jobId: string): Promise<JobRecord> {
  const job = await store.findJobById(organizationId, jobId);
  if (job === undefined) {
    throw new DomainError(`job ${jobId} not found in this organization`);
  }
  return job;
}

/** Marks the job `running` for `attempt` (a positive integer) from `pending`/`failed`. */
export async function markJobRunning(
  store: JobStore,
  jobId: string,
  attempt: number,
  context: JobCommandContext,
): Promise<JobRecord> {
  assertUuid(jobId, "jobId");
  const organizationId = requiredText(context.organizationId, "organizationId");
  const attemptNumber = positiveInteger(attempt, "attempt");

  return store.withTransaction(async (tx) => {
    const job = await loadJob(tx, organizationId, jobId);
    const updated = await tx.markRunning(organizationId, jobId, attemptNumber);
    if (updated === undefined) {
      throw new DomainError(`job ${jobId} cannot be marked running from status "${job.status}"`);
    }
    await tx.writeAudit({
      organizationId,
      actorId: context.actorId ?? null,
      action: JOB_AUDIT_ACTIONS.jobRunning,
      entityType: JOB_ENTITY_TYPE,
      entityId: jobId,
      after: { status: updated.status, attempt: attemptNumber },
    });
    return updated;
  });
}

/** Marks the job `succeeded` (only from `running`). */
export async function markJobSucceeded(
  store: JobStore,
  jobId: string,
  context: JobCommandContext,
): Promise<JobRecord> {
  assertUuid(jobId, "jobId");
  const organizationId = requiredText(context.organizationId, "organizationId");

  return store.withTransaction(async (tx) => {
    const job = await loadJob(tx, organizationId, jobId);
    const updated = await tx.markSucceeded(organizationId, jobId);
    if (updated === undefined) {
      throw new DomainError(`job ${jobId} cannot be marked succeeded from status "${job.status}"`);
    }
    await tx.writeAudit({
      organizationId,
      actorId: context.actorId ?? null,
      action: JOB_AUDIT_ACTIONS.jobSucceeded,
      entityType: JOB_ENTITY_TYPE,
      entityId: jobId,
      after: { status: updated.status },
    });
    return updated;
  });
}

/**
 * Records a failed attempt. It marks `failed`, or `dead_lettered` when the caller
 * passes `deadLetter: true` **or** the job has reached its `maxAttempts`
 * threshold (`attempts >= maxAttempts`), so the last retry is terminal.
 */
export async function markJobFailed(
  store: JobStore,
  jobId: string,
  error: string,
  options: MarkJobFailedOptions,
): Promise<JobRecord> {
  assertUuid(jobId, "jobId");
  const organizationId = requiredText(options.organizationId, "organizationId");
  const message = requiredText(error, "error");

  return store.withTransaction(async (tx) => {
    const job = await loadJob(tx, organizationId, jobId);
    const deadLetter = options.deadLetter || job.attempts >= job.maxAttempts;

    const updated = deadLetter
      ? await tx.markDeadLettered(organizationId, jobId, message)
      : await tx.markFailed(organizationId, jobId, message);
    if (updated === undefined) {
      const target = deadLetter ? "dead_lettered" : "failed";
      throw new DomainError(`job ${jobId} cannot be marked ${target} from status "${job.status}"`);
    }

    await tx.writeAudit({
      organizationId,
      actorId: options.actorId ?? null,
      action: deadLetter ? JOB_AUDIT_ACTIONS.jobDeadLettered : JOB_AUDIT_ACTIONS.jobFailed,
      entityType: JOB_ENTITY_TYPE,
      entityId: jobId,
      after: {
        status: updated.status,
        error: message,
        attempts: updated.attempts,
        max_attempts: updated.maxAttempts,
      },
    });
    return updated;
  });
}
