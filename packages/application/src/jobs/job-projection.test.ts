import { DomainError } from "@aquarela/domain";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { markJobFailed, markJobRunning, markJobSucceeded } from "./job-projection";
import { FakeJobStore } from "./test-support";
import type { JobRecord } from "./types";

const ORGANIZATION_ID = randomUUID();

function seedJob(store: FakeJobStore, maxAttempts = 5): Promise<JobRecord> {
  return store.createScheduledJob({
    organizationId: ORGANIZATION_ID,
    queue: "sales-import",
    kind: "sales.import.completed",
    payload: { runId: randomUUID() },
    maxAttempts,
  });
}

describe("markJobRunning", () => {
  it("marks a pending job running and audits the attempt", async () => {
    const store = new FakeJobStore();
    const job = await seedJob(store);

    const updated = await markJobRunning(store, job.id, 1, { organizationId: ORGANIZATION_ID });

    expect(updated).toMatchObject({ status: "running", attempts: 1 });
    expect(updated.startedAt).toBeInstanceOf(Date);
    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({
      action: "jobs.job.running",
      entityType: "job",
      entityId: job.id,
    });
  });

  it("rejects an unknown job and a non-positive attempt", async () => {
    const store = new FakeJobStore();
    await expect(
      markJobRunning(store, randomUUID(), 1, { organizationId: ORGANIZATION_ID }),
    ).rejects.toThrow(DomainError);

    const job = await seedJob(store);
    await expect(
      markJobRunning(store, job.id, 0, { organizationId: ORGANIZATION_ID }),
    ).rejects.toThrow(DomainError);
    expect(store.audits).toHaveLength(0);
  });
});

describe("markJobSucceeded", () => {
  it("succeeds a running job", async () => {
    const store = new FakeJobStore();
    const job = await seedJob(store);
    await markJobRunning(store, job.id, 1, { organizationId: ORGANIZATION_ID });

    const updated = await markJobSucceeded(store, job.id, { organizationId: ORGANIZATION_ID });

    expect(updated).toMatchObject({ status: "succeeded", error: null });
    expect(updated.finishedAt).toBeInstanceOf(Date);
    expect(store.audits.at(-1)).toMatchObject({ action: "jobs.job.succeeded" });
  });

  it("refuses to succeed a job that never ran (no partial write)", async () => {
    const store = new FakeJobStore();
    const job = await seedJob(store);

    await expect(
      markJobSucceeded(store, job.id, { organizationId: ORGANIZATION_ID }),
    ).rejects.toThrow(DomainError);

    expect(store.jobs[0]!.status).toBe("pending");
    expect(store.audits).toHaveLength(0);
  });
});

describe("markJobFailed", () => {
  it("fails a running job below the attempt threshold", async () => {
    const store = new FakeJobStore();
    const job = await seedJob(store);
    await markJobRunning(store, job.id, 1, { organizationId: ORGANIZATION_ID });

    const updated = await markJobFailed(store, job.id, "boom", {
      deadLetter: false,
      organizationId: ORGANIZATION_ID,
    });

    expect(updated).toMatchObject({ status: "failed", error: "boom" });
    expect(store.audits.at(-1)).toMatchObject({ action: "jobs.job.failed" });
  });

  it("dead-letters at the attempt threshold even when the caller does not ask", async () => {
    const store = new FakeJobStore();
    const job = await seedJob(store, 2);
    await markJobRunning(store, job.id, 2, { organizationId: ORGANIZATION_ID });

    const updated = await markJobFailed(store, job.id, "final failure", {
      deadLetter: false,
      organizationId: ORGANIZATION_ID,
    });

    expect(updated).toMatchObject({ status: "dead_lettered", attempts: 2, maxAttempts: 2 });
    expect(store.audits.at(-1)).toMatchObject({ action: "jobs.job.dead_lettered" });
  });

  it("honours an explicit deadLetter flag before the threshold", async () => {
    const store = new FakeJobStore();
    const job = await seedJob(store);
    await markJobRunning(store, job.id, 1, { organizationId: ORGANIZATION_ID });

    const updated = await markJobFailed(store, job.id, "permanent", {
      deadLetter: true,
      organizationId: ORGANIZATION_ID,
    });

    expect(updated.status).toBe("dead_lettered");
  });

  it("requires a non-blank error message", async () => {
    const store = new FakeJobStore();
    const job = await seedJob(store);
    await markJobRunning(store, job.id, 1, { organizationId: ORGANIZATION_ID });

    await expect(
      markJobFailed(store, job.id, "   ", { deadLetter: false, organizationId: ORGANIZATION_ID }),
    ).rejects.toThrow(DomainError);
    expect(store.jobs[0]!.status).toBe("running");
  });
});
