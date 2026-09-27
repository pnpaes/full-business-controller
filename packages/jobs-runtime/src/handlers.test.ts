import type { SchedulingStore } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import type { Database } from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { FakeJobStore } from "../../application/src/jobs/test-support";
import { FakeSchedulingStore } from "../../application/src/scheduling/test-support";
import type { OutboxJobContext } from "./consumer";
import { payrollReportGenerateHandler } from "./handlers";
import { PAYROLL_REPORT_GENERATE_EVENT_TYPE } from "./queues";
import type { OutboxJobPayload } from "./queues";

/** The scheduling store the mocked Postgres adapter hands back. */
const holder = vi.hoisted(() => ({ store: undefined as unknown as SchedulingStore }));

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresSchedulingStore: () => holder.store,
  };
});

const ORGANIZATION_ID = randomUUID();
const PERIOD = { periodStart: "2026-07-01", periodEnd: "2026-07-31" } as const;

function routingPayload(outboxEventId: string): OutboxJobPayload {
  return {
    id: outboxEventId,
    organizationId: ORGANIZATION_ID,
    eventType: PAYROLL_REPORT_GENERATE_EVENT_TYPE,
    aggregateType: "payroll_report",
    aggregateId: ORGANIZATION_ID,
  };
}

async function makeContext(
  jobPayload: Record<string, unknown>,
  options: { withDb?: boolean } = {},
): Promise<{ context: OutboxJobContext; scheduling: FakeSchedulingStore }> {
  const scheduling = new FakeSchedulingStore();
  holder.store = scheduling;

  const jobStore = new FakeJobStore();
  const event = await jobStore.insertOutboxEvent({
    organizationId: ORGANIZATION_ID,
    eventType: PAYROLL_REPORT_GENERATE_EVENT_TYPE,
    aggregateType: "payroll_report",
    aggregateId: ORGANIZATION_ID,
    payload: jobPayload,
  });
  await jobStore.createScheduledJob({
    organizationId: ORGANIZATION_ID,
    queue: PAYROLL_REPORT_GENERATE_EVENT_TYPE,
    kind: PAYROLL_REPORT_GENERATE_EVENT_TYPE,
    payload: jobPayload,
    outboxEventId: event.id,
  });

  const context: OutboxJobContext = {
    organizationId: ORGANIZATION_ID,
    outboxEventId: event.id,
    eventType: PAYROLL_REPORT_GENERATE_EVENT_TYPE,
    payload: routingPayload(event.id),
    store: jobStore,
    ...(options.withDb === false ? {} : { db: {} as Database }),
  };
  return { context, scheduling };
}

describe("payrollReportGenerateHandler", () => {
  it("generates the report with a system actor on the happy path", async () => {
    const { context, scheduling } = await makeContext({ ...PERIOD });

    await payrollReportGenerateHandler(context);

    const [report] = [...scheduling.payrollReports.values()];
    expect(report).toMatchObject({
      organizationId: ORGANIZATION_ID,
      periodStart: PERIOD.periodStart,
      periodEnd: PERIOD.periodEnd,
      status: "generated",
      generatedBy: null,
    });
    expect(
      scheduling.audits.some((audit) => audit.action === "workforce.payroll_report.generated"),
    ).toBe(true);
  });

  it("regenerates over a live generated report (idempotent redelivery)", async () => {
    const { context, scheduling } = await makeContext({ ...PERIOD });
    const first = await scheduling.createPayrollReport({
      organizationId: ORGANIZATION_ID,
      periodStart: PERIOD.periodStart,
      periodEnd: PERIOD.periodEnd,
      generatedBy: null,
      status: "generated",
      snapshot: {},
      createdBy: null,
    });

    await payrollReportGenerateHandler(context);

    expect(scheduling.payrollReports.size).toBe(2);
    expect(scheduling.payrollReports.get(first.id)?.status).toBe("superseded");
    expect(
      await scheduling.findPayrollReportForPeriod({
        organizationId: ORGANIZATION_ID,
        periodStart: PERIOD.periodStart,
      }),
    ).toMatchObject({ status: "generated" });
  });

  it("refuses to supersede an exported report (dead-letters to human review)", async () => {
    const { context, scheduling } = await makeContext({ ...PERIOD });
    await scheduling.createPayrollReport({
      organizationId: ORGANIZATION_ID,
      periodStart: PERIOD.periodStart,
      periodEnd: PERIOD.periodEnd,
      generatedBy: null,
      status: "exported",
      snapshot: {},
      createdBy: null,
    });

    await expect(payrollReportGenerateHandler(context)).rejects.toThrow(DomainError);
    expect(scheduling.payrollReports.size).toBe(1);
    expect([...scheduling.payrollReports.values()][0]?.status).toBe("exported");
  });

  it("rejects a malformed period payload", async () => {
    const { context } = await makeContext({ periodStart: "2026-07-01" });

    await expect(payrollReportGenerateHandler(context)).rejects.toThrow(/periodEnd must be a date/);
  });

  it("rejects a non-calendar period payload", async () => {
    const { context } = await makeContext({ periodStart: "2026-07-32", periodEnd: "2026-08-01" });

    await expect(payrollReportGenerateHandler(context)).rejects.toThrow(
      /periodStart must be a date/,
    );
  });

  it("fails closed when the consumer was built without a database handle", async () => {
    const { context } = await makeContext({ ...PERIOD }, { withDb: false });

    await expect(payrollReportGenerateHandler(context)).rejects.toThrow(
      /requires a database handle/,
    );
  });

  it("fails with a distinct error when the job projection is missing", async () => {
    holder.store = new FakeSchedulingStore();
    const context: OutboxJobContext = {
      organizationId: ORGANIZATION_ID,
      outboxEventId: randomUUID(),
      eventType: PAYROLL_REPORT_GENERATE_EVENT_TYPE,
      payload: routingPayload(randomUUID()),
      store: new FakeJobStore(),
      db: {} as Database,
    };

    await expect(payrollReportGenerateHandler(context)).rejects.toThrow(/projection is missing/);
  });
});
