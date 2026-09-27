import { createPostgresJobStore, createPostgresSchedulingStore } from "@aquarela/application";
import {
  createOutboxConsumer,
  currentUtcPayrollPeriod,
  enqueuePayrollReportGeneration,
  ensureQueues,
  evaluatePayrollSchedule,
  outboxQueueName,
  PAYROLL_REPORT_GENERATE_EVENT_TYPE,
  payrollReportGenerateHandler,
  type OutboxJobPayload,
} from "@aquarela/jobs-runtime";
import { createDb, createPayrollReport, organization, type DbClient } from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { getConstructionPlans, PgBoss, type Job } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Acceptance evidence for the `DEC-139` first real scheduled **producer** (the
 * payroll-report cron) and its **consumer** (the payroll-report generation
 * handler), run end to end against real pg-boss 12.33.2 and a real PostgreSQL.
 *
 * The harness is copied from `jobs-runtime.postgres.test.ts`: pg-boss commits its
 * own rows on its own connections, so instead of the repo's rollback pattern the
 * `pgboss` tables live in a **disposable schema** (`pgboss_test_<rand12>`) built
 * from the pinned package's construction plans and dropped in `afterAll`. The
 * application rows under test (`outbox_event`, `job`, `payroll_report`,
 * `audit_event`, `organization`) are committed for real, so they are removed in
 * `afterAll`; `audit_event` is append-only (its triggers reject DELETE), so the
 * cleanup runs under `session_replication_role = replica` to remove only this
 * suite's organization-scoped facts.
 */

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const SCHEMA = `pgboss_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const QUEUE = outboxQueueName(PAYROLL_REPORT_GENERATE_EVENT_TYPE);
const TEST_SCHEMA_PREFIX = "pgboss_test_";
const SCHEMA_COMMENT_PREFIX = "aquarela_pgboss_test_created:";
const STALE_AFTER_MS = 60 * 60 * 1000;

/** A fixed July 2026 payroll period (31 days, so the lead window opens day 28). */
const JULY = { periodStart: "2026-07-01", periodEnd: "2026-07-31" } as const;
/** Inside the last 3 days of July 2026 → the schedule is due. */
const DUE_NOW = new Date("2026-07-29T12:00:00.000Z");
/** Before `lastDay - 3` (July 31 − 3 = 28) → the schedule skips. */
const BEFORE_LEAD_NOW = new Date("2026-07-25T12:00:00.000Z");
/** Still inside the lead window, after a live report exists → the schedule skips. */
const AFTER_LIVE_NOW = new Date("2026-07-30T12:00:00.000Z");

interface QueuedJobRow {
  readonly id: string;
  readonly name: string;
  readonly state: string;
}

interface PayrollReportRow {
  readonly id: string;
  readonly status: string;
  readonly period_end: string;
  readonly generated_by: string | null;
  readonly updated_at: Date | null;
}

interface OutboxRow {
  readonly id: string;
  readonly event_type: string;
  readonly aggregate_type: string;
  readonly published_at: Date | null;
  readonly attempts: number;
  readonly dead_lettered_at: Date | null;
}

/**
 * Drops any `pgboss_test_%` schema older than an hour, so a crashed run cannot
 * leak a schema and a parallel run (whose schema was just created) cannot lose
 * one. Only schemas carrying this suite's creation comment are considered.
 */
async function dropStaleTestSchemas(raw: pg.Client): Promise<void> {
  const result = await raw.query<{ nspname: string; comment: string | null }>(
    "SELECT nspname, obj_description(oid, 'pg_namespace') AS comment FROM pg_namespace WHERE nspname LIKE $1",
    [`${TEST_SCHEMA_PREFIX}%`],
  );
  const cutoff = Date.now() - STALE_AFTER_MS;
  for (const row of result.rows) {
    const comment = row.comment;
    if (comment === null || !comment.startsWith(SCHEMA_COMMENT_PREFIX)) {
      continue;
    }
    const createdAt = Date.parse(comment.slice(SCHEMA_COMMENT_PREFIX.length));
    if (Number.isNaN(createdAt) || createdAt > cutoff) {
      continue;
    }
    await raw.query(`DROP SCHEMA IF EXISTS "${row.nspname}" CASCADE`);
  }
}

/**
 * Removes the committed application rows this suite created. `payroll_report`
 * references `organization`, so it is deleted before the organization; the
 * `audit_event` delete runs with `session_replication_role = replica` (the local
 * role is a superuser) because its triggers reject DELETE. The fallback removes
 * the mutable rows if that privilege is unavailable.
 */
async function cleanupOrganizations(
  raw: pg.Client,
  organizationIds: readonly string[],
): Promise<void> {
  if (organizationIds.length === 0) {
    return;
  }
  try {
    await raw.query("BEGIN");
    await raw.query("SET LOCAL session_replication_role = replica");
    await raw.query("DELETE FROM audit_event WHERE organization_id = ANY($1::uuid[])", [
      organizationIds,
    ]);
    await raw.query("DELETE FROM job WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
    await raw.query("DELETE FROM outbox_event WHERE organization_id = ANY($1::uuid[])", [
      organizationIds,
    ]);
    await raw.query("DELETE FROM payroll_report WHERE organization_id = ANY($1::uuid[])", [
      organizationIds,
    ]);
    await raw.query("DELETE FROM organization WHERE id = ANY($1::uuid[])", [organizationIds]);
    await raw.query("COMMIT");
  } catch (error) {
    await raw.query("ROLLBACK").catch(() => undefined);
    await raw
      .query("DELETE FROM job WHERE organization_id = ANY($1::uuid[])", [organizationIds])
      .catch(() => undefined);
    await raw
      .query("DELETE FROM outbox_event WHERE organization_id = ANY($1::uuid[])", [organizationIds])
      .catch(() => undefined);
    await raw
      .query("DELETE FROM payroll_report WHERE organization_id = ANY($1::uuid[])", [
        organizationIds,
      ])
      .catch(() => undefined);
    console.warn(
      `payroll-schedule postgres test cleanup left append-only rows behind: ${String(error)}`,
    );
  }
}

describe("currentUtcPayrollPeriod", () => {
  it("returns the current UTC month's [first, last] for a February and a 31-day month", () => {
    expect(currentUtcPayrollPeriod(new Date("2026-02-15T00:00:00.000Z"))).toEqual({
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
    });
    expect(currentUtcPayrollPeriod(new Date("2026-07-29T12:00:00.000Z"))).toEqual({
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    // A leap February as well, so "last day of month" is not a fixed table.
    expect(currentUtcPayrollPeriod(new Date("2024-02-10T00:00:00.000Z"))).toEqual({
      periodStart: "2024-02-01",
      periodEnd: "2024-02-29",
    });
  });
});

describe.skipIf(!databaseUrl)(
  "payroll schedule producer/consumer against PostgreSQL + pg-boss",
  () => {
    let client: DbClient;
    let raw: pg.Client;
    let boss: PgBoss;
    const organizationIds: string[] = [];

    beforeAll(async () => {
      client = createDb(databaseUrl!);
      raw = new pg.Client({ connectionString: databaseUrl! });
      await raw.connect();
      await raw.query(getConstructionPlans(SCHEMA));
      await raw.query(
        `COMMENT ON SCHEMA "${SCHEMA}" IS '${SCHEMA_COMMENT_PREFIX}${new Date().toISOString()}'`,
      );

      boss = new PgBoss({
        connectionString: databaseUrl!,
        schema: SCHEMA,
        migrate: false,
        createSchema: false,
        useListenNotify: false,
        // Background maintenance/cron is off so nothing touches the schema while
        // the suite drops it; the contractor schema check on start() still runs.
        supervise: false,
        schedule: false,
      });
      await boss.start();
      await ensureQueues(boss, [QUEUE]);
    });

    afterAll(async () => {
      try {
        if (boss !== undefined) {
          await boss.stop({ graceful: false });
        }
      } finally {
        try {
          if (raw !== undefined) {
            await raw.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
            await cleanupOrganizations(raw, organizationIds);
            await dropStaleTestSchemas(raw);
          }
        } finally {
          if (raw !== undefined) {
            await raw.end();
          }
          if (client !== undefined) {
            await client.close();
          }
        }
      }
    });

    async function createOrganization(): Promise<string> {
      const rows = await client.db
        .insert(organization)
        .values({ legalName: `payroll-sched-${suffix}-${organizationIds.length}` })
        .returning();
      const id = rows[0]!.id;
      organizationIds.push(id);
      return id;
    }

    async function queuedJobRows(id: string): Promise<QueuedJobRow[]> {
      const result = await raw.query<QueuedJobRow>(
        `SELECT id, name, state FROM "${SCHEMA}".job WHERE id = $1`,
        [id],
      );
      return result.rows;
    }

    /**
     * A bounded wait for one queued delivery (not a bare sleep): it fetches until
     * the named outbox event shows up, and fails loudly after the deadline.
     */
    async function fetchTargetDelivery(outboxEventId: string): Promise<Job<OutboxJobPayload>[]> {
      const deadline = Date.now() + 5000;
      for (;;) {
        const jobs = await boss.fetch<OutboxJobPayload>(QUEUE, { batchSize: 10 });
        const match = jobs.filter((job) => job.data.id === outboxEventId);
        if (match.length > 0) {
          return match;
        }
        if (Date.now() > deadline) {
          throw new Error(`pg-boss did not deliver ${outboxEventId} within 5s`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    function realConsumer(): ReturnType<typeof createOutboxConsumer> {
      return createOutboxConsumer({
        store: createPostgresJobStore(client.db),
        handlers: { [PAYROLL_REPORT_GENERATE_EVENT_TYPE]: payrollReportGenerateHandler },
        db: client.db,
      });
    }

    it("claim 1: a due schedule enqueues the outbox row, projection and pg-boss job in one commit", async () => {
      const organizationId = await createOrganization();
      const store = createPostgresSchedulingStore(client.db);

      const decision = await evaluatePayrollSchedule(store, organizationId, DUE_NOW);
      expect(decision).toEqual({
        enqueue: true,
        reason: "due",
        period: { periodStart: JULY.periodStart, periodEnd: JULY.periodEnd },
      });

      const result = await enqueuePayrollReportGeneration(
        client.db,
        boss,
        organizationId,
        decision.period,
      );

      const outbox = await raw.query<OutboxRow>(
        "SELECT id, event_type, aggregate_type, published_at, attempts, dead_lettered_at FROM outbox_event WHERE id = $1",
        [result.outboxEventId],
      );
      expect(outbox.rows).toHaveLength(1);
      expect(outbox.rows[0]!.event_type).toBe(PAYROLL_REPORT_GENERATE_EVENT_TYPE);
      expect(outbox.rows[0]!.aggregate_type).toBe("payroll_report");
      expect(outbox.rows[0]!.published_at).toBeNull();

      const projection = await createPostgresJobStore(client.db).findJobById(
        organizationId,
        result.jobId,
      );
      expect(projection).toMatchObject({
        status: "pending",
        attempts: 0,
        queue: PAYROLL_REPORT_GENERATE_EVENT_TYPE,
        kind: PAYROLL_REPORT_GENERATE_EVENT_TYPE,
        outboxEventId: result.outboxEventId,
        payload: { periodStart: JULY.periodStart, periodEnd: JULY.periodEnd },
      });

      const queued = await queuedJobRows(result.outboxEventId);
      expect(queued).toHaveLength(1);
      expect(queued[0]!.id).toBe(result.outboxEventId);
      expect(queued[0]!.name).toBe(QUEUE);
      expect(queued[0]!.state).toBe("created");

      // Drain the queued copy so later fetches start from a clean queue.
      await boss.deleteJob(QUEUE, result.outboxEventId);
    });

    it("claim 2: skips before the lead window and on a live report, and a re-enqueue dedups", async () => {
      const organizationId = await createOrganization();
      const store = createPostgresSchedulingStore(client.db);

      const early = await evaluatePayrollSchedule(store, organizationId, BEFORE_LEAD_NOW);
      expect(early).toMatchObject({
        enqueue: false,
        reason: "before-lead-window",
        period: { periodStart: JULY.periodStart, periodEnd: JULY.periodEnd },
      });

      const first = await enqueuePayrollReportGeneration(client.db, boss, organizationId, JULY);

      await createPayrollReport(client.db, {
        organizationId,
        periodStart: JULY.periodStart,
        periodEnd: JULY.periodEnd,
        status: "generated",
        snapshot: {},
      });

      const live = await evaluatePayrollSchedule(store, organizationId, AFTER_LIVE_NOW);
      expect(live).toMatchObject({
        enqueue: false,
        reason: "report-already-exists",
        period: { periodStart: JULY.periodStart, periodEnd: JULY.periodEnd },
      });

      const second = await enqueuePayrollReportGeneration(client.db, boss, organizationId, JULY);
      expect(second.outboxEventId).toBe(first.outboxEventId);
      expect(second.jobId).toBe(first.jobId);

      const outboxCount = await raw.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM outbox_event WHERE organization_id = $1 AND event_type = $2",
        [organizationId, PAYROLL_REPORT_GENERATE_EVENT_TYPE],
      );
      expect(outboxCount.rows[0]!.n).toBe(1);
      const jobCount = await raw.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM job WHERE organization_id = $1 AND outbox_event_id = $2",
        [organizationId, first.outboxEventId],
      );
      expect(jobCount.rows[0]!.n).toBe(1);

      await boss.deleteJob(QUEUE, first.outboxEventId);
    });

    it("claim 3: the real consumer generates the report with a system actor", async () => {
      const organizationId = await createOrganization();
      const result = await enqueuePayrollReportGeneration(client.db, boss, organizationId, JULY);

      const delivery = await fetchTargetDelivery(result.outboxEventId);
      expect(delivery).toHaveLength(1);
      await realConsumer()(delivery);

      const projection = await createPostgresJobStore(client.db).findJobById(
        organizationId,
        result.jobId,
      );
      expect(projection?.status).toBe("succeeded");
      expect(projection?.startedAt).toBeInstanceOf(Date);
      expect(projection?.finishedAt).toBeInstanceOf(Date);
      expect(projection!.finishedAt!.getTime()).toBeGreaterThanOrEqual(
        projection!.startedAt!.getTime(),
      );

      const outbox = await raw.query<OutboxRow>(
        "SELECT id, event_type, aggregate_type, published_at, attempts, dead_lettered_at FROM outbox_event WHERE id = $1",
        [result.outboxEventId],
      );
      expect(outbox.rows[0]!.published_at).toBeInstanceOf(Date);

      const reports = await raw.query<PayrollReportRow>(
        "SELECT id, status, period_end::text AS period_end, generated_by, updated_at FROM payroll_report WHERE organization_id = $1 AND period_start = $2",
        [organizationId, JULY.periodStart],
      );
      expect(reports.rows).toHaveLength(1);
      expect(reports.rows[0]!.status).toBe("generated");
      expect(reports.rows[0]!.period_end).toBe(JULY.periodEnd);
      expect(reports.rows[0]!.generated_by).toBeNull();
    });

    it("claim 4: the handler refuses to supersede an exported report and the job fails", async () => {
      const organizationId = await createOrganization();

      const seeded = await createPayrollReport(client.db, {
        organizationId,
        periodStart: JULY.periodStart,
        periodEnd: JULY.periodEnd,
        status: "exported",
        snapshot: {},
      });

      const before = await raw.query<PayrollReportRow>(
        "SELECT id, status, period_end::text AS period_end, generated_by, updated_at FROM payroll_report WHERE organization_id = $1 AND period_start = $2",
        [organizationId, JULY.periodStart],
      );
      expect(before.rows).toHaveLength(1);

      const result = await enqueuePayrollReportGeneration(client.db, boss, organizationId, JULY);
      const delivery = await fetchTargetDelivery(result.outboxEventId);

      await expect(realConsumer()(delivery)).rejects.toThrow(/already exported/);

      // The runtime outcome observed here: the application projection is `failed`
      // (attempt 1 of `maxAttempts` 5, so not yet dead-lettered), and the outbox
      // row stays unpublished with `attempts = 1` and no `dead_lettered_at` — it is
      // back in the replay set, not mislabelled as delivered.
      const projection = await createPostgresJobStore(client.db).findJobById(
        organizationId,
        result.jobId,
      );
      expect(projection?.status).toBe("failed");
      expect(projection?.status).not.toBe("dead_lettered");
      expect(projection?.error).toMatch(/already exported/);
      expect(projection?.startedAt).toBeInstanceOf(Date);
      expect(projection?.finishedAt).toBeInstanceOf(Date);

      const outbox = await raw.query<OutboxRow>(
        "SELECT id, event_type, aggregate_type, published_at, attempts, dead_lettered_at FROM outbox_event WHERE id = $1",
        [result.outboxEventId],
      );
      expect(outbox.rows[0]!.published_at).toBeNull();
      expect(outbox.rows[0]!.attempts).toBe(1);
      expect(outbox.rows[0]!.dead_lettered_at).toBeNull();

      // The exported report is untouched: no new row, no supersede, no update.
      const after = await raw.query<PayrollReportRow>(
        "SELECT id, status, period_end::text AS period_end, generated_by, updated_at FROM payroll_report WHERE organization_id = $1 AND period_start = $2",
        [organizationId, JULY.periodStart],
      );
      expect(after.rows).toHaveLength(1);
      expect(after.rows[0]!.id).toBe(seeded.id);
      expect(after.rows[0]!.status).toBe("exported");
      expect(after.rows[0]!.updated_at).toBeNull();
      expect(before.rows[0]!.updated_at).toBeNull();
    });
  },
);
