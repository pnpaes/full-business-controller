import {
  createDb,
  organization,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EnqueueOutboxEventInput } from "./enqueue-outbox-event";
import { enqueueOutboxEvent } from "./enqueue-outbox-event";
import { markJobFailed, markJobRunning, markJobSucceeded } from "./job-projection";
import { createPostgresJobStore } from "./postgres-store";
import { FakeOutboxJobDispatcher } from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

class RollbackSignal extends Error {}

/** Runs `fn` in a transaction and always rolls it back (append-only audits stay clean). */
async function inRollback(
  db: NodeDatabase,
  fn: (tx: DatabaseTransaction) => Promise<void>,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new RollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) {
      throw error;
    }
  }
}

function enqueueInput(organizationId: string): EnqueueOutboxEventInput {
  return {
    organizationId,
    eventType: "sales.import.completed",
    aggregateType: "import_run",
    aggregateId: randomUUID(),
    payload: { runId: randomUUID() },
  };
}

describe.skipIf(!databaseUrl)("jobs/outbox store against PostgreSQL", () => {
  let client: DbClient;

  beforeAll(() => {
    client = createDb(databaseUrl!);
  });

  afterAll(async () => {
    await client.close();
  });

  it("round-trips an enqueue into outbox + job + dispatch", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = (
        await tx
          .insert(organization)
          .values({ legalName: `job-enqueue-${suffix}` })
          .returning()
      )[0]!.id;
      const store = createPostgresJobStore(tx);
      const dispatcher = new FakeOutboxJobDispatcher();

      const result = await enqueueOutboxEvent(store, enqueueInput(orgId), dispatcher);

      const job = await store.findJobById(orgId, result.jobId);
      expect(job?.status).toBe("pending");
      expect(job?.outboxEventId).toBe(result.outboxEventId);

      const byEvent = await store.findJobByOutboxEventId(orgId, result.outboxEventId);
      expect(byEvent?.id).toBe(result.jobId);

      const unpublished = await store.listUnpublished(orgId, 10);
      expect(unpublished.map((event) => event.id)).toContain(result.outboxEventId);

      expect(dispatcher.dispatched.map((event) => event.id)).toContain(result.outboxEventId);
    });
  });

  it("dedups a repeat enqueue at the database", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = (
        await tx
          .insert(organization)
          .values({ legalName: `job-dedup-${suffix}` })
          .returning()
      )[0]!.id;
      const store = createPostgresJobStore(tx);
      const dispatcher = new FakeOutboxJobDispatcher();
      const input = enqueueInput(orgId);

      const first = await enqueueOutboxEvent(store, input, dispatcher);
      const second = await enqueueOutboxEvent(store, input, dispatcher);

      expect(second).toEqual(first);
      expect(await store.listUnpublished(orgId, 10)).toHaveLength(1);
      expect(await store.listJobs({ organizationId: orgId, limit: 10, offset: 0 })).toHaveLength(1);
      expect(dispatcher.dispatched).toHaveLength(1);
    });
  });

  it("rolls the outbox row back when dispatch fails", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = (
        await tx
          .insert(organization)
          .values({ legalName: `job-rollback-${suffix}` })
          .returning()
      )[0]!.id;
      const store = createPostgresJobStore(tx);
      const dispatcher = new FakeOutboxJobDispatcher();
      dispatcher.failNext = new Error("queue unavailable");

      await expect(enqueueOutboxEvent(store, enqueueInput(orgId), dispatcher)).rejects.toThrow(
        "queue unavailable",
      );

      expect(await store.listUnpublished(orgId, 10)).toHaveLength(0);
      expect(await store.listJobs({ organizationId: orgId, limit: 10, offset: 0 })).toHaveLength(0);
    });
  });

  it("advances a job through running -> succeeded and running -> dead_lettered", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = (
        await tx
          .insert(organization)
          .values({ legalName: `job-transition-${suffix}` })
          .returning()
      )[0]!.id;
      const store = createPostgresJobStore(tx);
      const dispatcher = new FakeOutboxJobDispatcher();

      const ok = await enqueueOutboxEvent(store, enqueueInput(orgId), dispatcher);
      await markJobRunning(store, ok.jobId, 1, { organizationId: orgId });
      const succeeded = await markJobSucceeded(store, ok.jobId, { organizationId: orgId });
      expect(succeeded.status).toBe("succeeded");

      const dead = await enqueueOutboxEvent(
        store,
        { ...enqueueInput(orgId), payload: { runId: randomUUID() } },
        dispatcher,
      );
      await markJobRunning(store, dead.jobId, 5, { organizationId: orgId });
      const deadLettered = await markJobFailed(store, dead.jobId, "gave up", {
        deadLetter: true,
        organizationId: orgId,
      });
      expect(deadLettered.status).toBe("dead_lettered");

      const published = await store.markPublished(ok.outboxEventId);
      expect(published).toBeUndefined();
      await store.recordAttempt(ok.outboxEventId);
      const replay = await store.listUnpublished(orgId, 10);
      expect(replay.map((event) => event.id)).not.toContain(ok.outboxEventId);
    });
  });
});
