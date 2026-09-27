import {
  createBoss,
  enqueueJobWithDispatch,
  ensureQueues,
  outboxQueueName,
  PAYROLL_REPORT_GENERATE_EVENT_TYPE,
} from "@aquarela/jobs-runtime";
import { createLogger } from "@aquarela/logger";

import { getConfig } from "./config";
import { getDb } from "./db";

/**
 * The web process's pg-boss **producer** seam (`ADR-0004` shape P2). The web
 * server does not run the worker (that is `apps/worker`), but the async `202`
 * route enqueues into the same durable outbox; this module owns the one
 * process-wide boss and the queue-ensure its first `send` needs.
 *
 * Mirrors `lib/db.ts`: the handle is parked on `globalThis` so Next's hot reload
 * reuses one boss instead of leaking one per recompile. It is created lazily and
 * started once (its cached-promise `start()` runs the migrator-installed schema
 * check), so a missing `pgboss` schema fails the first request closed, not the
 * build. `stop()` is deliberately not wired: the process teardown is the
 * lifetime boundary.
 */
type WebBoss = ReturnType<typeof createBoss>;

const globalForJobs = globalThis as typeof globalThis & {
  __aquarelaWebBoss?: WebBoss;
  __aquarelaWebBossStart?: Promise<WebBoss>;
  __aquarelaWebBossQueues?: Map<string, Promise<void>>;
};

function createWebBoss(): WebBoss {
  const logger = createLogger({ name: "web-jobs" });
  const boss = createBoss(getConfig().DATABASE_URL);
  boss.on("error", (error) => logger.error({ err: error }, "pg-boss error"));
  boss.on("warning", (warning) => logger.warn({ warning }, "pg-boss warning"));
  return boss;
}

function getBoss(): WebBoss {
  globalForJobs.__aquarelaWebBoss ??= createWebBoss();
  return globalForJobs.__aquarelaWebBoss;
}

/**
 * Starts the boss once per process. `start()` with `migrate:false` /
 * `createSchema:false` runs the schema check instead of DDL. A failed start is
 * not cached, so a transient fault can be retried on the next request while the
 * current one still fails closed.
 */
function startBoss(boss: WebBoss): Promise<WebBoss> {
  const pending =
    globalForJobs.__aquarelaWebBossStart ??
    (globalForJobs.__aquarelaWebBossStart = boss.start().then(
      () => boss,
      (error: unknown) => {
        delete globalForJobs.__aquarelaWebBossStart;
        throw error;
      },
    ));
  return pending;
}

/**
 * Creates one outbox queue (and the shared dead-letter queue it targets) once
 * per queue per process. Memoised, so the web process does not rely on the
 * worker/scheduler boot order to have created the queue before the first send.
 */
function ensureOutboxQueue(boss: WebBoss, name: string): Promise<void> {
  const queues = (globalForJobs.__aquarelaWebBossQueues ??= new Map());
  const existing = queues.get(name);
  if (existing !== undefined) {
    return existing;
  }
  const pending = ensureQueues(boss, [name]).catch((error: unknown) => {
    queues.delete(name);
    throw error;
  });
  queues.set(name, pending);
  return pending;
}

export interface EnqueuePayrollReportGenerationInput {
  readonly organizationId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface EnqueuePayrollReportGenerationResult {
  readonly jobId: string;
}

/**
 * Enqueues the payroll-report generation event from the web process and returns
 * the `job` projection id the caller points a `202 + Location` at. The event,
 * projection, queue insert and audit commit in one transaction
 * (`enqueueJobWithDispatch`); the org id is the aggregate id, so the natural-key
 * dedup also applies across the scheduler and the web route.
 */
export async function enqueuePayrollReportGeneration(
  input: EnqueuePayrollReportGenerationInput,
): Promise<EnqueuePayrollReportGenerationResult> {
  const eventType = PAYROLL_REPORT_GENERATE_EVENT_TYPE;
  const boss = await startBoss(getBoss());
  await ensureOutboxQueue(boss, outboxQueueName(eventType));
  const { jobId } = await enqueueJobWithDispatch(boss, getDb().db, {
    organizationId: input.organizationId,
    eventType,
    aggregateType: "payroll_report",
    aggregateId: input.organizationId,
    payload: { periodStart: input.periodStart, periodEnd: input.periodEnd },
    queue: eventType,
  });
  return { jobId };
}
