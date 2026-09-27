import { createPostgresJobStore } from "@aquarela/application";
import { createDb } from "@aquarela/persistence";

import { registerAiAdvisorySchedule } from "./ai-advisory";
import type { AiAdvisoryLlm } from "./ai-advisory";
import { createBoss } from "./boss";
import type { JobsRuntimeHandle } from "./boss";
import { registerCompetitorCollection } from "./competitor-collector";
import type { CompetitorCollectionOptions } from "./competitor-collector";
import type { OutboxHandlerRegistry } from "./consumer";
import { defaultOutboxHandlers } from "./handlers";
import { startHeartbeat } from "./heartbeat";
import type { RuntimeLogger } from "./logging";
import { registerMaintenance } from "./maintenance";
import { registerMonitor } from "./monitor";
import { registerPayrollSchedule } from "./payroll-schedule";
import {
  AI_ADVISORY_QUEUE,
  COMPETITOR_COLLECTION_QUEUE,
  ensureQueues,
  MAINTENANCE_QUEUE,
  MONITOR_QUEUE,
  PAYROLL_SCHEDULE_QUEUE,
  outboxQueueName,
} from "./queues";
import { installShutdownHandlers } from "./shutdown";

export interface SchedulerOptions {
  readonly connectionString: string;
  readonly organizationId: string;
  readonly cron: string;
  /** The payroll-generation cron (`PAYROLL_CRON`); defaults to `0 5 * * *`. */
  readonly payrollCron?: string;
  /** The alert-monitor cron (`MONITOR_CRON`); defaults to every five minutes. */
  readonly monitorCron?: string;
  /** The AI-advisory cron and its kill switch (`ADR-0009`); omitted = not registered. */
  readonly aiAdvisory?: SchedulerAiAdvisoryOptions;
  /** The competitor-collection cron and its kill switch (`ADR-0010`). */
  readonly competitorCollection?: SchedulerCompetitorCollectionOptions;
  readonly limit?: number;
  readonly handlers?: OutboxHandlerRegistry;
  readonly logger: RuntimeLogger;
}

/** The AI-advisory cron configuration the scheduler registers. */
export interface SchedulerAiAdvisoryOptions {
  /** The kill switch; `false` keeps the cron registered but makes the handler skip. */
  readonly enabled: boolean;
  readonly cron: string;
  readonly llm: AiAdvisoryLlm;
  readonly monthlyCostLimit?: string | null;
  readonly perRunCostLimit?: string | null;
  readonly actorId?: string | null;
  readonly maxTokens?: number;
}

/** The competitor-collection cron configuration the scheduler registers. */
export type SchedulerCompetitorCollectionOptions = Pick<
  CompetitorCollectionOptions,
  "enabled" | "cron" | "userAgent" | "maxPagesPerRun" | "minDelayMs" | "timeoutMs"
>;

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
    MONITOR_QUEUE,
    ...(options.aiAdvisory === undefined ? [] : [AI_ADVISORY_QUEUE]),
    ...(options.competitorCollection === undefined ? [] : [COMPETITOR_COLLECTION_QUEUE]),
  ];

  // `DEC-139` item 8: DB heartbeat so the in-app monitor can detect a dead worker.
  const heartbeat = startHeartbeat({ db: client.db, role: "scheduler", logger });

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    clearInterval(heartbeat);
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
    await registerMonitor(boss, {
      queues,
      cron: options.monitorCron ?? "*/5 * * * *",
      db: client.db,
      logger,
    });
    if (options.aiAdvisory !== undefined) {
      await registerAiAdvisorySchedule(boss, client.db, {
        organizationId: options.organizationId,
        cron: options.aiAdvisory.cron,
        logger,
        enabled: options.aiAdvisory.enabled,
        llm: options.aiAdvisory.llm,
        monthlyCostLimit: options.aiAdvisory.monthlyCostLimit ?? null,
        perRunCostLimit: options.aiAdvisory.perRunCostLimit ?? null,
        actorId: options.aiAdvisory.actorId ?? null,
        maxTokens: options.aiAdvisory.maxTokens,
      });
    }
    if (options.competitorCollection !== undefined) {
      await registerCompetitorCollection(boss, client.db, {
        organizationId: options.organizationId,
        cron: options.competitorCollection.cron,
        enabled: options.competitorCollection.enabled,
        logger,
        userAgent: options.competitorCollection.userAgent,
        maxPagesPerRun: options.competitorCollection.maxPagesPerRun,
        minDelayMs: options.competitorCollection.minDelayMs,
        timeoutMs: options.competitorCollection.timeoutMs,
      });
    }
    logger.info(
      {
        cron: options.cron,
        payrollCron: options.payrollCron ?? "0 5 * * *",
        monitorCron: options.monitorCron ?? "*/5 * * * *",
        queues,
      },
      "scheduler registered the outbox maintenance, payroll and monitor crons",
    );
  } catch (error) {
    logger.error({ err: error }, "scheduler failed to start");
    await stop().catch(() => undefined);
    throw error;
  }

  installShutdownHandlers(stop, logger);
  return { boss, stop };
}
