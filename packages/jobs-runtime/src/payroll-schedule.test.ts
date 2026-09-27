import type { JobStore, SchedulingStore } from "@aquarela/application";
import type { NodeDatabase } from "@aquarela/persistence";
import type { Job } from "pg-boss";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { FakeJobStore } from "../../application/src/jobs/test-support";
import { FakeSchedulingStore } from "../../application/src/scheduling/test-support";
import type { RuntimeLogger } from "./logging";
import {
  currentUtcPayrollPeriod,
  enqueuePayrollReportGeneration,
  evaluatePayrollSchedule,
  previousUtcPayrollPeriod,
  registerPayrollSchedule,
  type PayrollScheduleJobData,
} from "./payroll-schedule";
import {
  outboxQueueName,
  PAYROLL_REPORT_GENERATE_EVENT_TYPE,
  PAYROLL_SCHEDULE_QUEUE,
} from "./queues";
import { FakeBoss } from "./test-support";

/** The stores the mocked Postgres adapters hand back. */
const holder = vi.hoisted(() => ({
  jobStore: undefined as unknown as JobStore,
  schedulingStore: undefined as unknown as SchedulingStore,
}));

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresJobStore: () => holder.jobStore,
    createPostgresSchedulingStore: () => holder.schedulingStore,
  };
});

const ORGANIZATION_ID = randomUUID();
const OTHER_ORGANIZATION_ID = randomUUID();

/** A `NodeDatabase` whose transaction runs the callback inline (unit seam). */
function fakeDb(): NodeDatabase {
  const fakeTx = { execute: () => Promise.resolve({ rows: [] }) };
  return {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
  } as unknown as NodeDatabase;
}

/** A logger that records its calls, for asserting the mismatch warning. */
function recordingLogger(): { logger: RuntimeLogger; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  const info = vi.fn();
  const logger = { warn, info, error: vi.fn() } as unknown as RuntimeLogger;
  return { logger, warn };
}

describe("currentUtcPayrollPeriod", () => {
  it("resolves the first and last day of the current UTC month", () => {
    expect(currentUtcPayrollPeriod(new Date("2026-07-15T00:00:00.000Z"))).toEqual({
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    expect(currentUtcPayrollPeriod(new Date("2026-12-31T23:00:00.000Z"))).toEqual({
      periodStart: "2026-12-01",
      periodEnd: "2026-12-31",
    });
  });

  it("handles a leap February", () => {
    expect(currentUtcPayrollPeriod(new Date("2024-02-10T00:00:00.000Z"))).toEqual({
      periodStart: "2024-02-01",
      periodEnd: "2024-02-29",
    });
  });
});

describe("previousUtcPayrollPeriod", () => {
  it("resolves the previous UTC month, crossing the year in January", () => {
    expect(previousUtcPayrollPeriod(new Date("2026-07-03T00:00:00.000Z"))).toEqual({
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });
    expect(previousUtcPayrollPeriod(new Date("2026-01-03T00:00:00.000Z"))).toEqual({
      periodStart: "2025-12-01",
      periodEnd: "2025-12-31",
    });
  });

  it("resolves a leap February as the previous month", () => {
    expect(previousUtcPayrollPeriod(new Date("2024-03-02T00:00:00.000Z"))).toEqual({
      periodStart: "2024-02-01",
      periodEnd: "2024-02-29",
    });
  });
});

describe("evaluatePayrollSchedule", () => {
  it("skips before the lastDay - 3 window opens", async () => {
    const store = new FakeSchedulingStore();

    const decision = await evaluatePayrollSchedule(
      store,
      ORGANIZATION_ID,
      new Date("2026-07-25T00:00:00.000Z"),
    );

    expect(decision.enqueue).toBe(false);
    expect(decision.reason).toBe("before-lead-window");
    expect(decision.period).toEqual({ periodStart: "2026-07-01", periodEnd: "2026-07-31" });
  });

  it("enqueues once the day reaches lastDay - 3", async () => {
    const store = new FakeSchedulingStore();

    const decision = await evaluatePayrollSchedule(
      store,
      ORGANIZATION_ID,
      new Date("2026-07-28T00:00:00.000Z"),
    );

    expect(decision).toMatchObject({ enqueue: true, reason: "due" });
  });

  it("skips when a live report already exists for the period", async () => {
    const store = new FakeSchedulingStore();
    await store.createPayrollReport({
      organizationId: ORGANIZATION_ID,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      generatedBy: null,
      status: "generated",
      snapshot: {},
      createdBy: null,
    });

    const decision = await evaluatePayrollSchedule(
      store,
      ORGANIZATION_ID,
      new Date("2026-07-30T00:00:00.000Z"),
    );

    expect(decision).toMatchObject({ enqueue: false, reason: "report-already-exists" });
  });

  it("ignores a superseded-only row and enqueues", async () => {
    const store = new FakeSchedulingStore();
    await store.createPayrollReport({
      organizationId: ORGANIZATION_ID,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      generatedBy: null,
      status: "superseded",
      snapshot: {},
      createdBy: null,
    });

    const decision = await evaluatePayrollSchedule(
      store,
      ORGANIZATION_ID,
      new Date("2026-07-30T00:00:00.000Z"),
    );

    expect(decision).toMatchObject({ enqueue: true, reason: "due" });
  });
});

describe("evaluatePayrollSchedule catch-up", () => {
  it("on day 1-5 with no previous-month report, enqueues the previous month", async () => {
    const store = new FakeSchedulingStore();

    const decision = await evaluatePayrollSchedule(
      store,
      ORGANIZATION_ID,
      new Date("2026-07-03T00:00:00.000Z"),
    );

    expect(decision).toEqual({
      enqueue: true,
      reason: "due",
      period: { periodStart: "2026-06-01", periodEnd: "2026-06-30" },
    });
  });

  it("on day 1-5 with a live previous-month report, skips", async () => {
    const store = new FakeSchedulingStore();
    await store.createPayrollReport({
      organizationId: ORGANIZATION_ID,
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      generatedBy: null,
      status: "generated",
      snapshot: {},
      createdBy: null,
    });

    const decision = await evaluatePayrollSchedule(
      store,
      ORGANIZATION_ID,
      new Date("2026-07-03T00:00:00.000Z"),
    );

    expect(decision).toEqual({
      enqueue: false,
      reason: "report-already-exists",
      period: { periodStart: "2026-06-01", periodEnd: "2026-06-30" },
    });
  });

  it("on day 10 (outside both windows), skips the current month as before the lead window", async () => {
    const store = new FakeSchedulingStore();

    const decision = await evaluatePayrollSchedule(
      store,
      ORGANIZATION_ID,
      new Date("2026-07-10T00:00:00.000Z"),
    );

    expect(decision).toEqual({
      enqueue: false,
      reason: "before-lead-window",
      period: { periodStart: "2026-07-01", periodEnd: "2026-07-31" },
    });
  });

  it("in January, catches up the previous December", async () => {
    const store = new FakeSchedulingStore();

    const decision = await evaluatePayrollSchedule(
      store,
      ORGANIZATION_ID,
      new Date("2026-01-02T00:00:00.000Z"),
    );

    expect(decision).toEqual({
      enqueue: true,
      reason: "due",
      period: { periodStart: "2025-12-01", periodEnd: "2025-12-31" },
    });
  });
});

describe("registerPayrollSchedule", () => {
  it("registers the cron worker and the missed-once schedule", async () => {
    const boss = new FakeBoss();

    await registerPayrollSchedule(boss, {} as NodeDatabase, {
      organizationId: ORGANIZATION_ID,
      cron: "0 5 * * *",
    });

    expect(boss.worked.map((call) => call.name)).toContain(PAYROLL_SCHEDULE_QUEUE);
    expect(boss.scheduled).toHaveLength(1);
    expect(boss.scheduled[0]).toMatchObject({
      name: PAYROLL_SCHEDULE_QUEUE,
      cron: "0 5 * * *",
      data: { organizationId: ORGANIZATION_ID },
      options: { missed: "once" },
    });
  });

  it("uses the configured organization and warns when the stored job data differs", async () => {
    // A fixed instant inside the month-end lead window, so the run is due and
    // enqueues regardless of the day the suite is executed.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
    try {
      const boss = new FakeBoss();
      holder.schedulingStore = new FakeSchedulingStore();
      const jobStore = new FakeJobStore();
      holder.jobStore = jobStore;
      const { logger, warn } = recordingLogger();

      await registerPayrollSchedule(boss, fakeDb(), {
        organizationId: ORGANIZATION_ID,
        cron: "0 5 * * *",
        logger,
      });

      const registered = boss.worked.find((call) => call.name === PAYROLL_SCHEDULE_QUEUE);
      const handler = registered!.handler as (jobs: Job<PayrollScheduleJobData>[]) => Promise<void>;
      await handler([
        {
          id: randomUUID(),
          name: PAYROLL_SCHEDULE_QUEUE,
          // The stored routing data points at another organization; the
          // handler must ignore it.
          data: { organizationId: OTHER_ORGANIZATION_ID },
          expireInSeconds: 300,
          heartbeatSeconds: null,
          signal: new AbortController().signal,
        },
      ]);

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORGANIZATION_ID,
          storedOrganizationId: OTHER_ORGANIZATION_ID,
        }),
        expect.stringContaining("differs"),
      );
      expect(boss.sent).toHaveLength(1);
      expect(boss.sent[0]!.data).toMatchObject({ organizationId: ORGANIZATION_ID });
      expect(jobStore.outboxEvents[0]).toMatchObject({ organizationId: ORGANIZATION_ID });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("enqueuePayrollReportGeneration", () => {
  it("enqueues the generation event on the right queue with the organization as aggregateId", async () => {
    const jobStore = new FakeJobStore();
    holder.jobStore = jobStore;
    const boss = new FakeBoss();

    const result = await enqueuePayrollReportGeneration(fakeDb(), boss, ORGANIZATION_ID, {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });

    expect(result.outboxEventId).toBeDefined();
    expect(boss.sent).toHaveLength(1);
    expect(boss.sent[0]!.name).toBe(outboxQueueName(PAYROLL_REPORT_GENERATE_EVENT_TYPE));
    expect(boss.sent[0]!.options?.id).toBe(result.outboxEventId);
    expect(boss.sent[0]!.data).toMatchObject({
      id: result.outboxEventId,
      organizationId: ORGANIZATION_ID,
      eventType: PAYROLL_REPORT_GENERATE_EVENT_TYPE,
      aggregateType: "payroll_report",
      aggregateId: ORGANIZATION_ID,
    });

    const [event] = jobStore.outboxEvents;
    expect(event).toMatchObject({
      eventType: PAYROLL_REPORT_GENERATE_EVENT_TYPE,
      aggregateType: "payroll_report",
      aggregateId: ORGANIZATION_ID,
      payload: { periodStart: "2026-07-01", periodEnd: "2026-07-31" },
    });
  });

  it("enqueues once: a repeat is the application-level dedup no-op", async () => {
    const jobStore = new FakeJobStore();
    holder.jobStore = jobStore;
    const boss = new FakeBoss();
    const period = { periodStart: "2026-07-01", periodEnd: "2026-07-31" };

    const first = await enqueuePayrollReportGeneration(fakeDb(), boss, ORGANIZATION_ID, period);
    const second = await enqueuePayrollReportGeneration(fakeDb(), boss, ORGANIZATION_ID, period);

    expect(second.outboxEventId).toBe(first.outboxEventId);
    expect(jobStore.outboxEvents).toHaveLength(1);
    expect(boss.sent).toHaveLength(1);
  });

  it("tolerates a duplicate queue id (null send result)", async () => {
    holder.jobStore = new FakeJobStore();
    const boss = new FakeBoss();
    boss.sendResult = () => null;

    await expect(
      enqueuePayrollReportGeneration(fakeDb(), boss, ORGANIZATION_ID, {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      }),
    ).resolves.toMatchObject({ outboxEventId: expect.any(String) });
    expect(boss.sent).toHaveLength(1);
  });
});
