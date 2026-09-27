import { createPostgresJobStore } from "@aquarela/application";
import { createDb } from "@aquarela/persistence";

import { createBoss } from "./boss";
import type { JobsRuntimeHandle } from "./boss";
import { createOutboxConsumer } from "./consumer";
import type { OutboxHandlerRegistry } from "./consumer";
import { defaultOutboxHandlers } from "./handlers";
import { startHeartbeat } from "./heartbeat";
import type { RuntimeLogger } from "./logging";
import { ensureQueues, outboxQueueName } from "./queues";
import { installShutdownHandlers } from "./shutdown";

export interface WorkerOptions {
  readonly connectionString: string;
  readonly handlers?: OutboxHandlerRegistry;
  readonly logger: RuntimeLogger;
}

/**
 * The worker runtime: consume the outbox queues with the registered handlers.
 * `schedule: false` — the scheduler component owns pg-boss cron (`DEC-139`), so a
 * scaled worker neither registers nor races the schedule.
 */
export async function startWorker(options: WorkerOptions): Promise<JobsRuntimeHandle> {
  const handlers = options.handlers ?? defaultOutboxHandlers;
  const { logger } = options;
  const client = createDb(options.connectionString);
  const store = createPostgresJobStore(client.db);
  const boss = createBoss(options.connectionString, { schedule: false });
  boss.on("error", (error) => logger.error({ err: error }, "pg-boss error"));
  boss.on("warning", (warning) => logger.warn({ warning }, "pg-boss warning"));
  const queues = Object.keys(handlers).map((eventType) => outboxQueueName(eventType));

  // `DEC-139` item 8: DB heartbeat so the in-app monitor can detect a dead worker.
  const heartbeat = startHeartbeat({ db: client.db, role: "worker", logger });

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
    const consumer = createOutboxConsumer({ store, handlers, db: client.db, logger });
    for (const queue of queues) {
      // batchSize: 1 — the consumer's array handler fails the whole batch on the
      // first throwing job, so pin the default to one so batch-mates never burn retries.
      await boss.work(queue, { batchSize: 1 }, consumer);
    }
    logger.info({ queues }, "worker consuming outbox queues");
  } catch (error) {
    logger.error({ err: error }, "worker failed to start");
    await stop().catch(() => undefined);
    throw error;
  }

  installShutdownHandlers(stop, logger);
  return { boss, stop };
}
