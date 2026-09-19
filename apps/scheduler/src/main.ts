import { loadConfig } from "@aquarela/config";
import { createLogger } from "@aquarela/logger";

// DigitalOcean's Terraform provider (v2.101.1) exposes no SCHEDULED job kind, so
// the scheduler runs as a long-lived worker with an internal tick loop until the
// provider supports scheduled jobs and ADR-0004 (job technology) is accepted.
const config = loadConfig();
const logger = createLogger({ name: "scheduler" });

function positiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

const intervalMs = positiveInt("SCHEDULER_INTERVAL_MS", process.env.SCHEDULER_INTERVAL_MS, 60000);
const ticks =
  process.env.SCHEDULER_TICKS === undefined
    ? undefined
    : positiveInt("SCHEDULER_TICKS", process.env.SCHEDULER_TICKS, 1);

logger.info(
  { nodeEnv: config.NODE_ENV },
  "scheduler started; internal tick loop only, no scheduled jobs wired yet",
);

let tick = 0;
const timer = setInterval(() => {
  tick += 1;
  logger.debug({ tick }, "scheduler tick");
  if (ticks !== undefined && tick >= ticks) {
    clearInterval(timer);
    logger.info({ ticks: tick }, "scheduler smoke run complete");
    process.exit(0);
  }
}, intervalMs);

function shutdown(signal: string): void {
  clearInterval(timer);
  logger.info({ signal }, "scheduler shutting down");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
