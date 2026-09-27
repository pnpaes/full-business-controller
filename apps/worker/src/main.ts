import { loadConfig } from "@aquarela/config";
import { startWorker } from "@aquarela/jobs-runtime";
import { createLogger } from "@aquarela/logger";

// `loadConfig()` requires DATABASE_URL, so a missing/unusable URL fails loudly at
// boot (the deploy spec runs this with `tsx`, and there is no health check).
const config = loadConfig();
const logger = createLogger({ name: "worker" });

function positiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

// Smoke semantics preserved: with WORKER_TICKS set, emit that many heartbeats
// then stop pg-boss and exit 0; otherwise run as a long-lived consumer.
const heartbeatMs = positiveInt("WORKER_HEARTBEAT_MS", process.env.WORKER_HEARTBEAT_MS, 30000);
const ticks =
  process.env.WORKER_TICKS === undefined
    ? undefined
    : positiveInt("WORKER_TICKS", process.env.WORKER_TICKS, 1);

const worker = await startWorker({
  connectionString: config.DATABASE_URL,
  logger,
}).catch((error: unknown) => {
  logger.error({ err: error }, "worker failed to start");
  process.exit(1);
});

logger.info({ nodeEnv: config.NODE_ENV }, "worker started; consuming outbox queues");

let tick = 0;
const timer = setInterval(() => {
  tick += 1;
  // The in-app monitor cannot see another process's WIP (pg-boss 12 keeps it in
  // memory, no `wip` table), so worker liveness is observed out-of-band: DO
  // Monitoring alerts when this `info` heartbeat is absent for more than
  // WORKER_HEARTBEAT_ALERT_SECONDS (see @aquarela/jobs-runtime monitor).
  logger.info({ tick }, "worker heartbeat");
  if (ticks !== undefined && tick >= ticks) {
    clearInterval(timer);
    logger.info({ ticks: tick }, "worker smoke run complete");
    void worker.stop().finally(() => process.exit(0));
  }
}, heartbeatMs);
