import { loadConfig } from "@aquarela/config";
import { startScheduler } from "@aquarela/jobs-runtime";
import { createLogger } from "@aquarela/logger";

// The scheduler stays a long-lived App Platform component (ADR-0012) that owns
// pg-boss cron (`DEC-139`): it registers the recurring outbox replay job.
// `loadConfig()` requires DATABASE_URL, so a missing URL fails loudly at boot.
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

const organizationId = process.env.ORGANIZATION_ID?.trim();
if (organizationId === undefined || organizationId.length === 0) {
  logger.error("ORGANIZATION_ID is required for the scheduler outbox replay");
  process.exit(1);
}

// Smoke semantics preserved: with SCHEDULER_TICKS set, emit that many ticks then
// stop pg-boss and exit 0; otherwise run as a long-lived cron scheduler.
const intervalMs = positiveInt("SCHEDULER_INTERVAL_MS", process.env.SCHEDULER_INTERVAL_MS, 60000);
const ticks =
  process.env.SCHEDULER_TICKS === undefined
    ? undefined
    : positiveInt("SCHEDULER_TICKS", process.env.SCHEDULER_TICKS, 1);

const scheduler = await startScheduler({
  connectionString: config.DATABASE_URL,
  organizationId,
  cron: process.env.MAINTENANCE_CRON?.trim() || "*/15 * * * *",
  payrollCron: process.env.PAYROLL_CRON?.trim() || "0 5 * * *",
  monitorCron: process.env.MONITOR_CRON?.trim() || "*/5 * * * *",
  logger,
}).catch((error: unknown) => {
  logger.error({ err: error }, "scheduler failed to start");
  process.exit(1);
});

logger.info({ nodeEnv: config.NODE_ENV }, "scheduler started; outbox replay cron registered");

let tick = 0;
const timer = setInterval(() => {
  tick += 1;
  logger.debug({ tick }, "scheduler tick");
  if (ticks !== undefined && tick >= ticks) {
    clearInterval(timer);
    logger.info({ ticks: tick }, "scheduler smoke run complete");
    void scheduler.stop().finally(() => process.exit(0));
  }
}, intervalMs);
