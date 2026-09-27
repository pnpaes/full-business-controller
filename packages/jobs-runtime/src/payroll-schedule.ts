import { createPostgresSchedulingStore } from "@aquarela/application";
import type { EnqueueOutboxEventResult, SchedulingStore } from "@aquarela/application";
import { lastDayOfUtcMonth } from "@aquarela/domain";
import type { NodeDatabase } from "@aquarela/persistence";

import type { JobsBoss } from "./boss";
import type { RuntimeLogger } from "./logging";
import { enqueueJobWithDispatch } from "./producer";
import { PAYROLL_REPORT_GENERATE_EVENT_TYPE, PAYROLL_SCHEDULE_QUEUE } from "./queues";

/**
 * `ADR-0004`/`DEC-139` first real async **producer**: a daily cron that generates
 * the monthly payroll report a few days before month-end by enqueuing the
 * `PAYROLL_REPORT_GENERATE_EVENT_TYPE` outbox event (which the worker consumes).
 *
 * The period is the **current** UTC month, so the report is provisional and
 * under-counts the remaining days (`DEC-104`: remaining planned shifts are not
 * assumed). Do not "fix" that here.
 *
 * The job payload is only the routing metadata, so timing comes from the cron:
 * this producer passes no `scheduledAt`, so the queued event is delivered as soon
 * as it is enqueued (the dispatcher's `startAfter` support is not used here).
 */
export interface PayrollScheduleOptions {
  readonly organizationId: string;
  readonly cron: string;
  readonly logger?: RuntimeLogger;
}

/** The routing data the cron queue carries (`boss.work` / `boss.schedule`). */
export interface PayrollScheduleJobData {
  readonly organizationId: string;
}

/** The `[first day, last day]` of one UTC calendar month, as `YYYY-MM-DD`. */
export interface PayrollPeriod {
  readonly periodStart: string;
  readonly periodEnd: string;
}

/** How many days before month-end the daily cron starts generating. */
export const PAYROLL_SCHEDULE_LEAD_DAYS = 3;

/** The trailing day-of-month through which the previous month is caught up. */
export const PAYROLL_SCHEDULE_CATCH_UP_DAYS = 5;

/** The current UTC calendar month's window, from an instant. */
export function currentUtcPayrollPeriod(now: Date): PayrollPeriod {
  const periodStart = `${now.toISOString().slice(0, 7)}-01`;
  return { periodStart, periodEnd: lastDayOfUtcMonth(periodStart) };
}

/** The previous UTC calendar month's window, from an instant (UTC only). */
export function previousUtcPayrollPeriod(now: Date): PayrollPeriod {
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const periodStart = previous.toISOString().slice(0, 10);
  return { periodStart, periodEnd: lastDayOfUtcMonth(periodStart) };
}

/** The guard's outcome: whether to enqueue, why, and the period it evaluated. */
export interface PayrollScheduleDecision {
  readonly enqueue: boolean;
  readonly reason: "due" | "before-lead-window" | "report-already-exists";
  readonly period: PayrollPeriod;
}

/**
 * The idempotency guard. Skip when today's UTC day-of-month is more than
 * {@link PAYROLL_SCHEDULE_LEAD_DAYS} days before month-end and outside the
 * catch-up window, so the daily cron otherwise generates once the window opens.
 * Skip when a live report (`findPayrollReportForPeriod` excludes `superseded`
 * rows) already exists for the candidate period, so cron re-runs do not enqueue
 * a second generation.
 *
 * **Candidate period.** Once within `lastDay - 3` of month-end the candidate is
 * the current UTC month. Otherwise, on days 1–`PAYROLL_SCHEDULE_CATCH_UP_DAYS`
 * the candidate is the **previous** UTC month: a scheduler that was down for the
 * whole lead window (its `missed: "once"` catch-up run lands in the next month)
 * still generates that month's report from complete data instead of skipping it
 * forever. Every other day is `before-lead-window`. The live-report guard is
 * applied to whichever period the candidate resolves to.
 */
export async function evaluatePayrollSchedule(
  store: SchedulingStore,
  organizationId: string,
  now: Date,
): Promise<PayrollScheduleDecision> {
  const current = currentUtcPayrollPeriod(now);
  const lastDay = Number.parseInt(current.periodEnd.slice(8, 10), 10);
  const today = Number.parseInt(now.toISOString().slice(8, 10), 10);

  let period: PayrollPeriod;
  if (today >= lastDay - PAYROLL_SCHEDULE_LEAD_DAYS) {
    period = current;
  } else if (today <= PAYROLL_SCHEDULE_CATCH_UP_DAYS) {
    period = previousUtcPayrollPeriod(now);
  } else {
    return { enqueue: false, reason: "before-lead-window", period: current };
  }

  const live = await store.findPayrollReportForPeriod({
    organizationId,
    periodStart: period.periodStart,
  });
  if (live !== undefined) {
    return { enqueue: false, reason: "report-already-exists", period };
  }

  return { enqueue: true, reason: "due", period };
}

/**
 * Enqueues the payroll-report generation event atomically: the durable
 * `outbox_event`, the `job` projection, the pg-boss queue insert and the audit
 * fact commit or roll back together (the `ADR-0004` P2 seam). Delegates to the
 * shared {@link enqueueJobWithDispatch}; `aggregateId` is the organization id,
 * which is a uuid.
 */
export async function enqueuePayrollReportGeneration(
  db: NodeDatabase,
  boss: JobsBoss,
  organizationId: string,
  period: PayrollPeriod,
): Promise<EnqueueOutboxEventResult> {
  return enqueueJobWithDispatch(boss, db, {
    organizationId,
    eventType: PAYROLL_REPORT_GENERATE_EVENT_TYPE,
    aggregateType: "payroll_report",
    aggregateId: organizationId,
    payload: { periodStart: period.periodStart, periodEnd: period.periodEnd },
    // Bare event type: the dispatcher applies `outboxQueueName` itself, so
    // passing the already-prefixed name would double-prefix it.
    queue: PAYROLL_REPORT_GENERATE_EVENT_TYPE,
  });
}

/**
 * Registers the daily payroll-schedule cron on the scheduler. The cron queue
 * itself must exist before `boss.schedule` (the scheduler's `ensureQueues`
 * includes {@link PAYROLL_SCHEDULE_QUEUE}); the outbox queue the event routes to
 * is created from the worker's handler-derived queue list.
 *
 * `missed: "once"` catches up a single missed run (the guard then makes it
 * idempotent). A run missed inside the month-end lead window is caught up by the
 * early-next-month window in {@link evaluatePayrollSchedule}, not by this
 * option alone.
 */
export async function registerPayrollSchedule(
  boss: JobsBoss,
  db: NodeDatabase,
  options: PayrollScheduleOptions,
): Promise<void> {
  const { organizationId, cron, logger } = options;

  await boss.work<PayrollScheduleJobData>(PAYROLL_SCHEDULE_QUEUE, async (jobs) => {
    for (const job of jobs) {
      // The configured organization is the authority: the pg-boss-stored job
      // data is only routing metadata and must never redirect the run. It is
      // kept on the schedule for observability, so warn when it drifts.
      const storedOrganizationId = job.data.organizationId;
      if (storedOrganizationId !== undefined && storedOrganizationId !== organizationId) {
        logger?.warn(
          { organizationId, storedOrganizationId },
          "payroll schedule job data organizationId differs from the configured organization; using the configured one",
        );
      }

      const store = createPostgresSchedulingStore(db);
      const decision = await evaluatePayrollSchedule(store, organizationId, new Date());

      if (!decision.enqueue) {
        logger?.info(
          {
            organizationId,
            reason: decision.reason,
            periodStart: decision.period.periodStart,
          },
          "payroll schedule skipped",
        );
        continue;
      }

      const result = await enqueuePayrollReportGeneration(
        db,
        boss,
        organizationId,
        decision.period,
      );
      logger?.info(
        {
          organizationId,
          periodStart: decision.period.periodStart,
          periodEnd: decision.period.periodEnd,
          outboxEventId: result.outboxEventId,
        },
        "payroll schedule enqueued generation",
      );
    }
  });

  await boss.schedule(
    PAYROLL_SCHEDULE_QUEUE,
    cron,
    // Observability only: the handler uses the configured `options.organizationId`.
    { organizationId },
    { missed: "once" },
  );
}
