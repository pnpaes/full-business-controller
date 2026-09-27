import {
  OUTBOX_EVENT_ENTITY_TYPE,
  createPostgresSchedulingStore,
  generatePayrollReport,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import type { OutboxHandlerRegistry, OutboxJobHandler } from "./consumer";
import { PAYROLL_REPORT_GENERATE_EVENT_TYPE } from "./queues";

/**
 * The first-slice proof consumer. It is deliberately non-external: its only
 * effect is appending an append-only, organization-scoped audit row through the
 * store's `writeAudit`. It makes no network call and changes no business fact.
 */
export const PLATFORM_SMOKE_EVENT_TYPE = "platform.smoke";
export const PLATFORM_SMOKE_AUDIT_ACTION = "platform.smoke.consumed";

export const platformSmokeHandler: OutboxJobHandler = async ({
  store,
  organizationId,
  outboxEventId,
  eventType,
  payload,
}) => {
  await store.writeAudit({
    organizationId,
    actorId: null,
    action: PLATFORM_SMOKE_AUDIT_ACTION,
    entityType: OUTBOX_EVENT_ENTITY_TYPE,
    entityId: outboxEventId,
    after: {
      handler: PLATFORM_SMOKE_EVENT_TYPE,
      event_type: eventType,
      aggregate_type: payload.aggregateType,
      aggregate_id: payload.aggregateId,
    },
  });
};

/** A `YYYY-MM-DD` calendar date, validated by a clock round-trip. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertCalendarDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    throw new DomainError(`payroll_report.${field} must be a date (YYYY-MM-DD)`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new DomainError(`payroll_report.${field} must be a date (YYYY-MM-DD)`);
  }
  return value;
}

function readPayrollPeriod(payload: unknown): { periodStart: string; periodEnd: string } {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new DomainError("payroll_report event payload must be an object");
  }
  const record = payload as Record<string, unknown>;
  const periodStart = assertCalendarDate(record["periodStart"], "periodStart");
  const periodEnd = assertCalendarDate(record["periodEnd"], "periodEnd");
  return { periodStart, periodEnd };
}

/**
 * The first **real** async consumer (`ADR-0004`/`DEC-139`): generates the
 * monthly payroll report for the period named by the event, reusing the
 * `generatePayrollReport` command with a system actor (`actorId: null`).
 *
 * The pg-boss delivery carries only routing metadata, so the domain payload is
 * resolved from the durable `job` projection (`payload = { periodStart,
 * periodEnd }`) rather than bounced through the queue.
 *
 * **Exported-supersede guard:** a live report already `exported` for the same
 * `(organizationId, periodStart)` refuses the regeneration (`DomainError`), so
 * the job fails and dead-letters to human review. `DEC-104` items 5/9/10
 * (whether/when an exported report may be superseded) stay open; silently
 * superseding one would resolve them by accident. A live `generated`/`draft`
 * report is regenerated normally — the idempotent redelivery outcome.
 *
 * The guard and the generation share **one** transaction: the row is read with
 * `lockPayrollReportForPeriod` (`SELECT … FOR UPDATE`) and held while
 * `generatePayrollReport` re-locks and supersedes it, so a concurrent export
 * cannot slip in between the check and the supersede (the TOCTOU that a
 * pre-transaction `findPayrollReportForPeriod` check left open).
 */
export const payrollReportGenerateHandler: OutboxJobHandler = async (context) => {
  const { db, organizationId, outboxEventId, store } = context;
  if (db === undefined) {
    throw new DomainError("payroll_report generation handler requires a database handle (ctx.db)");
  }

  const projection = await store.findJobByOutboxEventId(organizationId, outboxEventId);
  if (projection === undefined) {
    throw new DomainError(
      `payroll_report job projection is missing for outbox event ${outboxEventId}`,
    );
  }
  const { periodStart, periodEnd } = readPayrollPeriod(projection.payload);

  const schedulingStore = createPostgresSchedulingStore(db);
  await schedulingStore.withTransaction(async (tx) => {
    const locked = await tx.lockPayrollReportForPeriod({ organizationId, periodStart });
    if (locked?.status === "exported") {
      throw new DomainError(
        `payroll report for ${periodStart} is already exported and will not be superseded automatically (DEC-104)`,
      );
    }

    await generatePayrollReport(tx, {
      organizationId,
      periodStart,
      periodEnd,
      actorId: null,
    });
  });
};

/** The registry the worker and scheduler share; keys are event types. */
export const defaultOutboxHandlers: OutboxHandlerRegistry = {
  [PLATFORM_SMOKE_EVENT_TYPE]: platformSmokeHandler,
  [PAYROLL_REPORT_GENERATE_EVENT_TYPE]: payrollReportGenerateHandler,
};
