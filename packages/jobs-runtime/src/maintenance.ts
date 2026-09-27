import type { JobStore } from "@aquarela/application";

import type { JobsBoss } from "./boss";
import type { RuntimeLogger } from "./logging";
import { MAINTENANCE_QUEUE, outboxJobPayload, outboxQueueName, queueOptionsFor } from "./queues";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

/** Default retention window for terminal job projections (days). */
export const DEFAULT_RETENTION_DAYS = 90;
/** Default per-run cap on pruned rows; a larger backlog drains over successive crons. */
export const DEFAULT_RETENTION_LIMIT = 1000;
/** Default age (minutes) after which a non-terminal projection counts as stuck. */
export const DEFAULT_STUCK_AFTER_MINUTES = 60;
/** The alert key raised when aged non-terminal projections exist. */
export const STUCK_PENDING_ALERT = "jobs.stuck_pending";

/**
 * The P2 recovery job: **replaying unpublished outbox rows**. This is what makes
 * the runner's queue disposable — if pg-boss loses its queue (schema dropped, a
 * swap to another runner), the durable `outbox_event` rows are re-enqueued under
 * their own ids, which deduplicates any row still queued.
 */
export interface MaintenanceJobData {
  readonly organizationId: string;
  readonly limit: number;
}

export interface ReplayOptions {
  readonly boss: JobsBoss;
  readonly store: JobStore;
  readonly organizationId: string;
  readonly limit: number;
  readonly logger?: RuntimeLogger;
}

export async function replayUnpublishedOutbox(options: ReplayOptions): Promise<number> {
  const events = await options.store.listUnpublished(options.organizationId, options.limit);
  const ensured = new Set<string>();
  let replayed = 0;

  for (const event of events) {
    const queue = outboxQueueName(event.eventType);
    if (!ensured.has(queue)) {
      await options.boss.createQueue(queue, queueOptionsFor(queue));
      ensured.add(queue);
    }
    const id = await options.boss.send(queue, outboxJobPayload(event), { id: event.id });
    if (id !== null) {
      replayed += 1;
    }
  }

  return replayed;
}

export interface MaintenanceRegistrationOptions {
  readonly organizationId: string;
  readonly cron: string;
  readonly limit: number;
  /** Terminal-projection retention window in days (default {@link DEFAULT_RETENTION_DAYS}). */
  readonly retentionDays?: number;
  /** Per-run prune batch size (default {@link DEFAULT_RETENTION_LIMIT}). */
  readonly retentionLimit?: number;
  /** Age in minutes after which a non-terminal projection is stuck (default {@link DEFAULT_STUCK_AFTER_MINUTES}). */
  readonly stuckAfterMinutes?: number;
  readonly logger?: RuntimeLogger;
}

/**
 * Registers the replay worker on {@link MAINTENANCE_QUEUE} and the recurring cron
 * (`boss.schedule(queue, cron, data)`). Called by the scheduler process, which
 * owns cron per `DEC-139`; the worker runs with scheduling disabled.
 */
export async function registerMaintenance(
  boss: JobsBoss,
  store: JobStore,
  options: MaintenanceRegistrationOptions,
): Promise<void> {
  const { organizationId, cron, limit, logger } = options;
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const retentionLimit = options.retentionLimit ?? DEFAULT_RETENTION_LIMIT;
  const stuckAfterMinutes = options.stuckAfterMinutes ?? DEFAULT_STUCK_AFTER_MINUTES;

  await boss.work<MaintenanceJobData>(MAINTENANCE_QUEUE, async (jobs) => {
    for (const job of jobs) {
      // The configured options are the authority; the pg-boss-stored job data is
      // only routing metadata and must not widen the scope or the page size.
      const storedOrganizationId = job.data.organizationId;
      if (storedOrganizationId !== undefined && storedOrganizationId !== organizationId) {
        logger?.warn(
          { organizationId, storedOrganizationId },
          "maintenance job data organizationId differs from the configured organization; using the configured one",
        );
      }
      const replayed = await replayUnpublishedOutbox({
        boss,
        store,
        organizationId,
        limit,
        ...(logger === undefined ? {} : { logger }),
      });
      // Retention prune: terminal projections only, org-scoped, batched by
      // `retentionLimit`. The cutoff is computed per run from `new Date()`; the
      // configured options (not the pg-boss-stored job data) are the authority.
      const olderThan = new Date(Date.now() - retentionDays * MS_PER_DAY);
      const pruned = await store.deleteExpiredJobs(organizationId, olderThan, retentionLimit);
      // Stuck check: an aged `pending`/`running` projection means the consumer that
      // claimed it diverged — its pg-boss job vanished, so the monitor (which reads
      // only pg-boss) can never see it. The prune keeps these rows for evidence, so
      // surface the count here. Cut from `created_at`, org-scoped as configured.
      const stuckOlderThan = new Date(Date.now() - stuckAfterMinutes * MS_PER_MINUTE);
      const stuck = await store.countStuckJobs(organizationId, stuckOlderThan);
      if (stuck > 0) {
        logger?.warn(
          { alert: STUCK_PENDING_ALERT, organizationId, stuck },
          "non-terminal job projections are older than the stuck threshold",
        );
      }
      logger?.info(
        { organizationId, replayed, pruned, stuck },
        "outbox maintenance replay and prune complete",
      );
    }
  });

  await boss.schedule(MAINTENANCE_QUEUE, cron, {
    organizationId,
    limit,
  });
}
