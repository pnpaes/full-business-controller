import {
  createPostgresJobStore,
  enqueueOutboxEvent,
  JOB_AUDIT_ACTIONS,
  type EnqueueOutboxEventInput,
} from "@aquarela/application";
import {
  createOutboxConsumer,
  createPgBossDispatcher,
  ensureQueues,
  outboxQueueName,
  PLATFORM_SMOKE_AUDIT_ACTION,
  PLATFORM_SMOKE_EVENT_TYPE,
  platformSmokeHandler,
  replayUnpublishedOutbox,
  type OutboxJobHandler,
  type OutboxJobPayload,
} from "@aquarela/jobs-runtime";
import { createDb, listAuditEvents, organization, type DbClient } from "@aquarela/persistence";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { getConstructionPlans, PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * `ADR-0004` shape P2 acceptance evidence (`DEC-139` first slice), against the
 * real pg-boss 12.33.2 and a real PostgreSQL 16.
 *
 * Isolation differs from the rest of the Postgres suites on purpose: pg-boss
 * commits its own rows on its own connections, so the repo's rollback pattern
 * cannot be used. The pgboss tables live in a **disposable schema**
 * (`pgboss_test_<rand12>`) built from the pinned package's construction plans and
 * dropped in `afterAll`. The application rows under test (`outbox_event`, `job`,
 * `audit_event`, `organization`) are committed for real, so they are removed in
 * `afterAll`; `audit_event` is append-only (its triggers reject DELETE), so the
 * cleanup runs under `session_replication_role = replica` to remove only this
 * test's organization-scoped facts.
 */

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const SCHEMA = `pgboss_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const QUEUE = outboxQueueName(PLATFORM_SMOKE_EVENT_TYPE);
const TEST_SCHEMA_PREFIX = "pgboss_test_";
const SCHEMA_COMMENT_PREFIX = "aquarela_pgboss_test_created:";
const STALE_AFTER_MS = 60 * 60 * 1000;

/** Sentinel thrown to force a rollback after the queue dispatch has happened. */
class RollbackSignal extends Error {}

interface QueuedJobRow {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly data: unknown;
}

/**
 * A bounded wait, not a sleep: the real `boss.work` round-trip resolves the
 * promise as soon as the consumer has run, and this only guards a hung poll.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
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
 * Removes the committed application rows this suite created. `audit_event` is
 * append-only by trigger, so the delete runs with `session_replication_role =
 * replica` (the local role is a superuser) to delete only the rows scoped to the
 * test organizations; the fallback removes the mutable rows if that privilege is
 * unavailable.
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
    console.warn(
      `jobs-runtime postgres test cleanup left append-only rows behind: ${String(error)}`,
    );
  }
}

describe.skipIf(!databaseUrl)("ADR-0004 P2 jobs runtime against PostgreSQL + pg-boss", () => {
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
      .values({ legalName: `jobs-runtime-${suffix}-${organizationIds.length}` })
      .returning();
    const id = rows[0]!.id;
    organizationIds.push(id);
    return id;
  }

  function smokeInput(
    organizationId: string,
    overrides: Partial<EnqueueOutboxEventInput> = {},
  ): EnqueueOutboxEventInput {
    return {
      organizationId,
      eventType: PLATFORM_SMOKE_EVENT_TYPE,
      aggregateType: "smoke",
      aggregateId: randomUUID(),
      payload: { note: `smoke-${suffix}` },
      ...overrides,
    };
  }

  /** The production enqueue path: store + dispatcher bound to one real transaction. */
  async function enqueueCommitted(
    input: EnqueueOutboxEventInput,
  ): Promise<{ outboxEventId: string; jobId: string }> {
    return client.db.transaction(async (tx) => {
      const store = createPostgresJobStore(tx);
      const dispatcher = createPgBossDispatcher(boss, tx, sql);
      return enqueueOutboxEvent(store, input, dispatcher);
    });
  }

  async function queuedJobRows(id: string): Promise<QueuedJobRow[]> {
    const result = await raw.query<QueuedJobRow>(
      `SELECT id, name, state, data FROM "${SCHEMA}".job WHERE id = $1`,
      [id],
    );
    return result.rows;
  }

  it("claim 1: commits the outbox row, job projection and pg-boss queue job in one transaction", async () => {
    const organizationId = await createOrganization();
    const result = await enqueueCommitted(smokeInput(organizationId));

    const outbox = await raw.query<{ id: string; published_at: Date | null }>(
      "SELECT id, published_at FROM outbox_event WHERE id = $1",
      [result.outboxEventId],
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]!.published_at).toBeNull();

    const store = createPostgresJobStore(client.db);
    const projection = await store.findJobById(organizationId, result.jobId);
    expect(projection?.status).toBe("pending");
    expect(projection?.attempts).toBe(0);
    expect(projection?.outboxEventId).toBe(result.outboxEventId);
    expect(projection?.queue).toBe(PLATFORM_SMOKE_EVENT_TYPE);

    const queued = await queuedJobRows(result.outboxEventId);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.id).toBe(result.outboxEventId);
    expect(queued[0]!.name).toBe(QUEUE);
    expect(queued[0]!.state).toBe("created");

    // Drain the queued copy so the worker/fetch claims below start from a clean
    // queue; the durable outbox row stays for the leftover assertions.
    await boss.deleteJob(QUEUE, result.outboxEventId);
  });

  it("claim 2: rolls the outbox row, projection and pg-boss queue job back together", async () => {
    const organizationId = await createOrganization();
    const input = smokeInput(organizationId);
    let outboxEventId: string | undefined;

    await expect(
      client.db.transaction(async (tx) => {
        const store = createPostgresJobStore(tx);
        const dispatcher = createPgBossDispatcher(boss, tx, sql);
        const result = await enqueueOutboxEvent(store, input, dispatcher);
        outboxEventId = result.outboxEventId;

        // Same-transaction read: the queue insert is visible here, so the throw
        // below really does roll back a dispatched job, not a skipped one.
        const inTransaction = await tx.execute<{ id: string }>(
          `SELECT id FROM "${SCHEMA}".job WHERE id = '${result.outboxEventId}'`,
        );
        expect(inTransaction.rows).toHaveLength(1);

        throw new RollbackSignal("forced rollback after dispatch");
      }),
    ).rejects.toThrow("forced rollback after dispatch");

    expect(outboxEventId).toBeDefined();
    const id = outboxEventId!;

    const outbox = await raw.query("SELECT id FROM outbox_event WHERE id = $1", [id]);
    expect(outbox.rows).toHaveLength(0);

    const store = createPostgresJobStore(client.db);
    expect(await store.findJobByOutboxEventId(organizationId, id)).toBeUndefined();
    expect(await queuedJobRows(id)).toHaveLength(0);
  });

  it("claim 3: consumes a queued delivery through a real pg-boss worker", async () => {
    const organizationId = await createOrganization();
    const result = await enqueueCommitted(smokeInput(organizationId));

    let handlerCalls = 0;
    const countingHandler: OutboxJobHandler = async (context) => {
      handlerCalls += 1;
      await platformSmokeHandler(context);
    };
    const consumer = createOutboxConsumer({
      store: createPostgresJobStore(client.db),
      handlers: { [PLATFORM_SMOKE_EVENT_TYPE]: countingHandler },
    });

    let release!: () => void;
    const processed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const workerId = await boss.work<OutboxJobPayload>(
      QUEUE,
      { pollingIntervalSeconds: 0.5 },
      async (jobs) => {
        await consumer(jobs);
        release();
      },
    );
    try {
      await withTimeout(processed, 5000, "pg-boss worker did not deliver the job within 5s");
    } finally {
      await boss.offWork(QUEUE, { id: workerId, wait: true });
    }

    expect(handlerCalls).toBe(1);

    const store = createPostgresJobStore(client.db);
    const projection = await store.findJobById(organizationId, result.jobId);
    expect(projection?.status).toBe("succeeded");
    expect(projection?.startedAt).toBeInstanceOf(Date);
    expect(projection?.finishedAt).toBeInstanceOf(Date);
    expect(projection!.finishedAt!.getTime()).toBeGreaterThanOrEqual(
      projection!.startedAt!.getTime(),
    );

    const outbox = await raw.query<{ published_at: Date | null }>(
      "SELECT published_at FROM outbox_event WHERE id = $1",
      [result.outboxEventId],
    );
    expect(outbox.rows[0]!.published_at).toBeInstanceOf(Date);

    const consumption = await listAuditEvents(client.db, {
      organizationId,
      action: JOB_AUDIT_ACTIONS.jobConsumed,
      entityId: result.jobId,
    });
    expect(consumption).toHaveLength(1);

    const handlerAudit = await listAuditEvents(client.db, {
      organizationId,
      action: PLATFORM_SMOKE_AUDIT_ACTION,
      entityId: result.outboxEventId,
    });
    expect(handlerAudit).toHaveLength(1);
  });

  it("claim 4: does not re-run the handler or duplicate the projection/audit on redelivery", async () => {
    const organizationId = await createOrganization();
    const result = await enqueueCommitted(smokeInput(organizationId));

    let handlerCalls = 0;
    const countingHandler: OutboxJobHandler = async (context) => {
      handlerCalls += 1;
      await platformSmokeHandler(context);
    };
    const consumer = createOutboxConsumer({
      store: createPostgresJobStore(client.db),
      handlers: { [PLATFORM_SMOKE_EVENT_TYPE]: countingHandler },
    });

    const jobs = await boss.fetch<OutboxJobPayload>(QUEUE, { batchSize: 10 });
    const delivery = jobs.filter((job) => job.data.id === result.outboxEventId);
    expect(delivery).toHaveLength(1);

    await consumer(delivery);
    await consumer(delivery);

    expect(handlerCalls).toBe(1);

    const projections = await raw.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM job WHERE organization_id = $1 AND outbox_event_id = $2",
      [organizationId, result.outboxEventId],
    );
    expect(projections.rows[0]!.n).toBe(1);

    const handlerAudit = await listAuditEvents(client.db, {
      organizationId,
      action: PLATFORM_SMOKE_AUDIT_ACTION,
      entityId: result.outboxEventId,
    });
    expect(handlerAudit).toHaveLength(1);

    const consumption = await listAuditEvents(client.db, {
      organizationId,
      action: JOB_AUDIT_ACTIONS.jobConsumed,
      entityId: result.jobId,
    });
    expect(consumption).toHaveLength(1);

    const outbox = await raw.query<{ published_at: Date | null; attempts: number }>(
      "SELECT published_at, attempts FROM outbox_event WHERE id = $1",
      [result.outboxEventId],
    );
    expect(outbox.rows[0]!.published_at).toBeInstanceOf(Date);
    expect(outbox.rows[0]!.attempts).toBe(0);
  });

  it("claim 5: replays an unpublished outbox row onto its queue id and is idempotent", async () => {
    const organizationId = await createOrganization();
    const result = await enqueueCommitted(smokeInput(organizationId));

    // Simulate a lost queue: drop the queued copy, keep the durable outbox row.
    await boss.deleteJob(QUEUE, result.outboxEventId);
    expect(await queuedJobRows(result.outboxEventId)).toHaveLength(0);

    const store = createPostgresJobStore(client.db);
    const firstReplay = await replayUnpublishedOutbox({
      boss,
      store,
      organizationId,
      limit: 10,
    });
    expect(firstReplay).toBe(1);

    const recreated = await queuedJobRows(result.outboxEventId);
    expect(recreated).toHaveLength(1);
    expect(recreated[0]!.id).toBe(result.outboxEventId);
    expect(recreated[0]!.name).toBe(QUEUE);

    const secondReplay = await replayUnpublishedOutbox({
      boss,
      store,
      organizationId,
      limit: 10,
    });
    expect(secondReplay).toBe(0);
    expect(await queuedJobRows(result.outboxEventId)).toHaveLength(1);

    const duplicate = await boss.send(
      QUEUE,
      { id: result.outboxEventId },
      {
        id: result.outboxEventId,
      },
    );
    expect(duplicate).toBeNull();
  });
});
