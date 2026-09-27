import { createPostgresJobStore } from "@aquarela/application";
import { createDb } from "@aquarela/persistence";

import { createBoss } from "./boss";
import type { JobsRuntimeHandle } from "./boss";
import type { OutboxHandlerRegistry } from "./consumer";
import { defaultOutboxHandlers } from "./handlers";
import type { RuntimeLogger } from "./logging";
import { registerMaintenance } from "./maintenance";
import { registerPayrollSchedule } from "./payroll-schedule";
import { ensureQueues, MAINTENANCE_QUEUE, PAYROLL_SCHEDULE_QUEUE, outboxQueueName } from "./queues";
import { installShutdownHandlers } from "./shutdown";

export interface SchedulerOptions {
  readonly connectionString: string;
  readonly organizationId: string;
  readonly cron: string;
  /** The payroll-generation cron (`PAYROLL_CRON`); defaults to `0 5 * * *`. */
  readonly payrollCron?: string;
  readonly limit?: number;
  readonly handlers?: OutboxHandlerRegistry;
  readonly logger: RuntimeLogger;
}

/**
 * The scheduler runtime: own pg-boss cron (`schedule: true`) and run the outbox
 * replay job. It also ensures the outbox queues exist, because replay sends into
 * them; pg-boss `send` resolves the queue through its cache and refuses an
 * unknown queue, so the queues must exist before the first cron fires.
 */
export async function startScheduler(options: SchedulerOptions): Promise<JobsRuntimeHandle> {
  const handlers = options.handlers ?? defaultOutboxHandlers;
  const limit = options.limit ?? 100;
  const { logger } = options;
  const client = createDb(options.connectionString);
  const store = createPostgresJobStore(client.db);
  const boss = createBoss(options.connectionString, { schedule: true });
  boss.on("error", (error) => logger.error({ err: error }, "pg-boss error"));
  boss.on("warning", (warning) => logger.warn({ warning }, "pg-boss warning"));
  const queues = [
    ...Object.keys(handlers).map((eventType) => outboxQueueName(eventType)),
    MAINTENANCE_QUEUE,
    PAYROLL_SCHEDULE_QUEUE,
  ];

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await boss.stop();
    await client.close();
  };

  try {
    await boss.start();
    await ensureQueues(boss, queues);
    await registerMaintenance(boss, store, {
      organizationId: options.organizationId,
      cron: options.cron,
      limit,
      logger,
    });
    await registerPayrollSchedule(boss, client.db, {
      organizationId: options.organizationId,
      cron: options.payrollCron ?? "0 5 * * *",
      logger,
    });
    logger.info(
      { cron: options.cron, payrollCron: options.payrollCron ?? "0 5 * * *", queues },
      "scheduler registered the outbox maintenance and payroll crons",
    );
  } catch (error) {
    logger.error({ err: error }, "scheduler failed to start");
    await stop().catch(() => undefined);
    throw error;
  }

  installShutdownHandlers(stop, logger);
  return { boss, stop };
}
