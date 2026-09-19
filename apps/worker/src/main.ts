import { loadConfig } from "@aquarela/config";
import { createLogger } from "@aquarela/logger";

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

const heartbeatMs = positiveInt("WORKER_HEARTBEAT_MS", process.env.WORKER_HEARTBEAT_MS, 30000);
const ticks =
  process.env.WORKER_TICKS === undefined
    ? undefined
    : positiveInt("WORKER_TICKS", process.env.WORKER_TICKS, 1);

logger.info(
  { nodeEnv: config.NODE_ENV },
  "worker started; queue consumer not wired yet because ADR-0004 is still Proposed",
);

let tick = 0;
const timer = setInterval(() => {
  tick += 1;
  logger.debug({ tick }, "worker heartbeat");
  if (ticks !== undefined && tick >= ticks) {
    clearInterval(timer);
    logger.info({ ticks: tick }, "worker smoke run complete");
    process.exit(0);
  }
}, heartbeatMs);

function shutdown(signal: string): void {
  clearInterval(timer);
  logger.info({ signal }, "worker shutting down");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
