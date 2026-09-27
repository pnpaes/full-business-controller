import { loadConfig } from "@aquarela/config";
import {
  createOpenAiCompatibleLlmAdapter,
  DEFAULT_AI_ADVISORY_CRON,
  DEFAULT_COMPETITOR_COLLECTION_CRON,
  DEFAULT_COMPETITOR_MAX_PAGES_PER_RUN,
  DEFAULT_COMPETITOR_MIN_DELAY_MS,
  DEFAULT_COMPETITOR_TIMEOUT_MS,
  DEFAULT_COMPETITOR_USER_AGENT,
  startScheduler,
} from "@aquarela/jobs-runtime";
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

/**
 * A positive integer not below `min`. `COMPETITOR_MIN_DELAY_MS` uses its floor
 * (1000 ms) so a configured value can never breach the `DEC-149` ≤ 1 req/s policy.
 */
function boundedInt(
  name: string,
  value: string | undefined,
  fallback: number,
  min: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer >= ${min}, got "${value}"`);
  }
  return parsed;
}

/** `true`/`1`/`yes` (case-insensitive) enable; anything else, including unset, is off. */
function flag(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalised = value.trim().toLowerCase();
  return normalised === "true" || normalised === "1" || normalised === "yes";
}

/** A non-negative decimal string at up to 4 dp (the recorded cost scale). */
function costLimit(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (!/^\d+(\.\d{1,4})?$/.test(trimmed)) {
    throw new Error(
      `${name} must be a non-negative decimal with at most 4 decimals, got "${value}"`,
    );
  }
  return trimmed;
}

const organizationId = process.env.ORGANIZATION_ID?.trim();
if (organizationId === undefined || organizationId.length === 0) {
  logger.error("ORGANIZATION_ID is required for the scheduler outbox replay");
  process.exit(1);
}

// AI advisory (`ADR-0009`, `DEC-142`): the kill switch defaults OFF. The adapter
// fails closed without all three LLM_* values, and the per-run/monthly caps are
// optional non-negative decimals.
const llm = createOpenAiCompatibleLlmAdapter({
  apiUrl: process.env.LLM_API_URL,
  apiKey: process.env.LLM_API_KEY,
  model: process.env.LLM_MODEL,
  logger,
});
const aiAdvisoryEnabled = flag(process.env.AI_ADVISORY_ENABLED);
const aiAdvisoryCron = process.env.AI_ADVISORY_CRON?.trim() || DEFAULT_AI_ADVISORY_CRON;
const aiMonthlyCostLimit = costLimit("AI_MONTHLY_COST_LIMIT", process.env.AI_MONTHLY_COST_LIMIT);
const aiPerRunCostLimit = costLimit("AI_PER_RUN_COST_LIMIT", process.env.AI_PER_RUN_COST_LIMIT);

// Competitor collection (`ADR-0010`, `DEC-143`/`DEC-149`): the kill switch
// defaults OFF, so the cron is registered but makes no request until enabled.
// `COMPETITOR_MIN_DELAY_MS` cannot go below 1000 to honour the ≤ 1 req/s policy.
const competitorEnabled = flag(process.env.COMPETITOR_COLLECTION_ENABLED);
const competitorCron =
  process.env.COMPETITOR_COLLECTION_CRON?.trim() || DEFAULT_COMPETITOR_COLLECTION_CRON;
const competitorUserAgent =
  process.env.COMPETITOR_USER_AGENT?.trim() || DEFAULT_COMPETITOR_USER_AGENT;
const competitorMaxPages = positiveInt(
  "COMPETITOR_MAX_PAGES_PER_RUN",
  process.env.COMPETITOR_MAX_PAGES_PER_RUN,
  DEFAULT_COMPETITOR_MAX_PAGES_PER_RUN,
);
const competitorMinDelay = boundedInt(
  "COMPETITOR_MIN_DELAY_MS",
  process.env.COMPETITOR_MIN_DELAY_MS,
  DEFAULT_COMPETITOR_MIN_DELAY_MS,
  DEFAULT_COMPETITOR_MIN_DELAY_MS,
);
const competitorTimeout = positiveInt(
  "COMPETITOR_TIMEOUT_MS",
  process.env.COMPETITOR_TIMEOUT_MS,
  DEFAULT_COMPETITOR_TIMEOUT_MS,
);

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
  aiAdvisory: {
    enabled: aiAdvisoryEnabled,
    cron: aiAdvisoryCron,
    llm,
    monthlyCostLimit: aiMonthlyCostLimit ?? null,
    perRunCostLimit: aiPerRunCostLimit ?? null,
  },
  competitorCollection: {
    enabled: competitorEnabled,
    cron: competitorCron,
    userAgent: competitorUserAgent,
    maxPagesPerRun: competitorMaxPages,
    minDelayMs: competitorMinDelay,
    timeoutMs: competitorTimeout,
  },
  logger,
}).catch((error: unknown) => {
  logger.error({ err: error }, "scheduler failed to start");
  process.exit(1);
});

logger.info(
  {
    nodeEnv: config.NODE_ENV,
    aiAdvisoryEnabled,
    aiAdvisoryConfigured: llm.configured,
    competitorCollectionEnabled: competitorEnabled,
  },
  "scheduler started; outbox replay cron registered",
);

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
