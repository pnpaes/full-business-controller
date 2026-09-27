import { NotFoundError } from "@aquarela/domain";
import {
  createDb,
  findOutboxEventById,
  job,
  organization,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { discardDeadLetteredJob, retryDeadLetteredJob } from "./dead-letter";
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

  it("prunes only old terminal rows, org-scoped and batched", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = (
        await tx
          .insert(organization)
          .values({ legalName: `job-prune-${suffix}` })
          .returning()
      )[0]!.id;
      const otherOrgId = (
        await tx
          .insert(organization)
          .values({ legalName: `job-prune-other-${suffix}` })
          .returning()
      )[0]!.id;
      const now = Date.now();
      const old = new Date(now - 10 * 24 * 60 * 60 * 1000);
      const recent = new Date(now - 1 * 24 * 60 * 60 * 1000);
      const cutoff = new Date(now - 5 * 24 * 60 * 60 * 1000);

      await tx.insert(job).values([
        {
          organizationId: orgId,
          queue: "outbox.platform.smoke",
          kind: "k",
          status: "succeeded",
          createdAt: old,
        },
        {
          organizationId: orgId,
          queue: "outbox.platform.smoke",
          kind: "k",
          status: "failed",
          createdAt: old,
        },
        {
          organizationId: orgId,
          queue: "outbox.platform.smoke",
          kind: "k",
          status: "dead_lettered",
          createdAt: old,
        },
        {
          organizationId: orgId,
          queue: "outbox.platform.smoke",
          kind: "k",
          status: "succeeded",
          createdAt: recent,
        },
        {
          organizationId: orgId,
          queue: "outbox.platform.smoke",
          kind: "k",
          status: "pending",
          createdAt: old,
        },
        {
          organizationId: otherOrgId,
          queue: "outbox.platform.smoke",
          kind: "k",
          status: "succeeded",
          createdAt: old,
        },
      ]);

      const store = createPostgresJobStore(tx);

      expect(await store.deleteExpiredJobs(orgId, cutoff, 2)).toBe(2);
      expect(await store.deleteExpiredJobs(orgId, cutoff, 2)).toBe(1);
      expect(await store.deleteExpiredJobs(orgId, cutoff, 2)).toBe(0);

      const remaining = await store.listJobs({ organizationId: orgId, limit: 100, offset: 0 });
      expect(remaining.map((row) => row.status).sort()).toEqual(["pending", "succeeded"]);
      expect(remaining.find((row) => row.status === "pending")?.createdAt.getTime()).toBe(
        old.getTime(),
      );

      const other = await store.listJobs({ organizationId: otherOrgId, limit: 100, offset: 0 });
      expect(other).toHaveLength(1);
      expect(other[0]!.status).toBe("succeeded");
    });
  });

  it("counts only old non-terminal rows, org-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = (
        await tx
          .insert(organization)
          .values({ legalName: `job-stuck-${suffix}` })
          .returning()
      )[0]!.id;
      const otherOrgId = (
        await tx
          .insert(organization)
          .values({ legalName: `job-stuck-other-${suffix}` })
          .returning()
      )[0]!.id;
      const now = Date.now();
      const old = new Date(now - 10 * 24 * 60 * 60 * 1000);
      const recent = new Date(now - 1 * 24 * 60 * 60 * 1000);
      const cutoff = new Date(now - 5 * 24 * 60 * 60 * 1000);

      await tx.insert(job).values([
        {
          organizationId: orgId,
          queue: "outbox.platform.smoke",
          kind: "k",
          status: "pending",
          createdAt: old,
        },
        {
          organizationId: orgId,
          queue: "outbox.platform.smoke",
          kind: "k",
          status: "running",
          createdAt: old,
        },
        {
          organizationId: orgId,
          queue: "outbox.platform.smoke",
          kind: "k",
          status: "pending",
          createdAt: recent,
        },
        {
          organizationId: orgId,
          queue: "outbox.platform.smoke",
          kind: "k",
          status: "succeeded",
          createdAt: old,
        },
        {
          organizationId: otherOrgId,
          queue: "outbox.platform.smoke",
          kind: "k",
          status: "pending",
          createdAt: old,
        },
      ]);

      const store = createPostgresJobStore(tx);

      // Old pending + old running count; fresh pending and old terminal do not.
      expect(await store.countStuckJobs(orgId, cutoff)).toBe(2);
      // Org filter: the other organization's stuck row is invisible.
      expect(await store.countStuckJobs(otherOrgId, cutoff)).toBe(1);
    });
  });

  it("retries and discards dead-lettered jobs, org-scoped, clearing the outbox on retry", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = (
        await tx
          .insert(organization)
          .values({ legalName: `job-dlq-${suffix}` })
          .returning()
      )[0]!.id;
      const otherOrgId = (
        await tx
          .insert(organization)
          .values({ legalName: `job-dlq-other-${suffix}` })
          .returning()
      )[0]!.id;
      const store = createPostgresJobStore(tx);
      const dispatcher = new FakeOutboxJobDispatcher();

      // Retry path: dead-letter a job and simulate the consumer's terminal outbox marks.
      const retryTarget = await enqueueOutboxEvent(store, enqueueInput(orgId), dispatcher);
      await markJobRunning(store, retryTarget.jobId, 1, { organizationId: orgId });
      await markJobFailed(store, retryTarget.jobId, "gave up", {
        deadLetter: true,
        organizationId: orgId,
      });
      await store.markPublished(retryTarget.outboxEventId);
      await store.deadLetter(retryTarget.outboxEventId);

      // Org scoping: another organization cannot retry it.
      await expect(
        retryDeadLetteredJob(store, { organizationId: otherOrgId, jobId: retryTarget.jobId }),
      ).rejects.toThrow(NotFoundError);

      const retried = await retryDeadLetteredJob(store, {
        organizationId: orgId,
        jobId: retryTarget.jobId,
      });
      expect(retried).toMatchObject({
        status: "pending",
        attempts: 0,
        error: null,
        startedAt: null,
        finishedAt: null,
      });

      const cleared = await findOutboxEventById(tx, {
        organizationId: orgId,
        outboxEventId: retryTarget.outboxEventId,
      });
      expect(cleared?.deadLetteredAt).toBeNull();
      expect(cleared?.publishedAt).toBeNull();
      // The event is replayable again, so the maintenance replay is the safety net.
      expect((await store.listUnpublished(orgId, 10)).map((event) => event.id)).toContain(
        retryTarget.outboxEventId,
      );
      // Org filter: another organization's clear is a no-op.
      expect(await store.clearDeadLetter(otherOrgId, retryTarget.outboxEventId)).toBe(false);

      // Discard path: keeps the outbox dead-letter marker, stamps it published.
      const discardTarget = await enqueueOutboxEvent(
        store,
        { ...enqueueInput(orgId), payload: { runId: randomUUID() } },
        dispatcher,
      );
      await markJobRunning(store, discardTarget.jobId, 1, { organizationId: orgId });
      await markJobFailed(store, discardTarget.jobId, "gave up", {
        deadLetter: true,
        organizationId: orgId,
      });
      await store.deadLetter(discardTarget.outboxEventId);

      await expect(
        discardDeadLetteredJob(store, { organizationId: otherOrgId, jobId: discardTarget.jobId }),
      ).rejects.toThrow(NotFoundError);

      const discarded = await discardDeadLetteredJob(store, {
        organizationId: orgId,
        jobId: discardTarget.jobId,
      });
      expect(discarded.status).toBe("failed");

      const kept = await findOutboxEventById(tx, {
        organizationId: orgId,
        outboxEventId: discardTarget.outboxEventId,
      });
      expect(kept?.deadLetteredAt).not.toBeNull();
      expect(kept?.publishedAt).not.toBeNull();
    });
  });
});
