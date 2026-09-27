import type { JobStore } from "@aquarela/application";

import type { JobsBoss } from "./boss";
import type { RuntimeLogger } from "./logging";
import { MAINTENANCE_QUEUE, outboxJobPayload, outboxQueueName, queueOptionsFor } from "./queues";

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
      logger?.info({ organizationId, replayed }, "outbox maintenance replay complete");
    }
  });

  await boss.schedule(MAINTENANCE_QUEUE, cron, {
    organizationId,
    limit,
  });
}
