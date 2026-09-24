import {
  appUser,
  createDb,
  task,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
  type UserStatus,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assignTask } from "./assign-task";
import { createTask } from "./create-task";
import { findTask } from "./find-task";
import { listAssignableUsers } from "./list-assignable-users";
import { listTasks } from "./list-tasks";
import { createPostgresTaskStore } from "./postgres-store";
import { transitionTask } from "./transition-task";

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

async function seedUser(
  tx: DatabaseTransaction,
  orgId: string,
  overrides: { displayName: string; username: string; status?: UserStatus },
): Promise<string> {
  const rows = await tx
    .insert(appUser)
    .values({
      organizationId: orgId,
      displayName: overrides.displayName,
      username: overrides.username,
      passwordHash: "not-a-real-hash",
      ...(overrides.status === undefined ? {} : { status: overrides.status }),
    })
    .returning();
  return rows[0]!.id;
}

describe.skipIf(!databaseUrl)("task store against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Task IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("creates, reads, transitions and assigns a task, storing the schema vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const activeUserId = await seedUser(tx, orgId, {
        displayName: "Active Alpha",
        username: `active_${suffix}`,
      });
      await seedUser(tx, orgId, {
        displayName: "Disabled Beta",
        username: `disabled_${suffix}`,
        status: "disabled",
      });
      const store = createPostgresTaskStore(tx);
      const actorId = randomUUID();

      const created = await createTask(store, {
        organizationId: orgId,
        actorId,
        type: "follow_up",
        priority: "high",
        dueDate: "2026-10-01",
      });
      expect(created).toMatchObject({ status: "open", ownerId: null, dueDate: "2026-10-01" });

      await assignTask(store, {
        organizationId: orgId,
        actorId,
        taskId: created.id,
        ownerId: activeUserId,
      });

      const started = await transitionTask(store, {
        organizationId: orgId,
        actorId,
        taskId: created.id,
        status: "in_progress",
      });
      expect(started.status).toBe("in_progress");

      const resolved = await transitionTask(store, {
        organizationId: orgId,
        actorId,
        taskId: created.id,
        status: "resolved",
      });
      expect(resolved.status).toBe("resolved");

      // The stored column carries the same value the domain speaks.
      const stored = await tx.select({ id: task.id, status: task.status }).from(task);
      expect(stored.find((row) => row.id === created.id)?.status).toBe("resolved");

      // A round-trip read returns the stored value unchanged.
      await expect(
        findTask(store, { organizationId: orgId, taskId: created.id }),
      ).resolves.toMatchObject({ status: "resolved" });

      const resolvedTasks = await listTasks(store, { organizationId: orgId, status: "resolved" });
      expect(resolvedTasks.map((row) => row.id)).toEqual([created.id]);

      // Only the active user is offered by the assignee picker.
      const assignable = await listAssignableUsers(store, { organizationId: orgId });
      expect(assignable.map((user) => user.id)).toEqual([activeUserId]);
    });
  });

  it("stores dismissed verbatim", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresTaskStore(tx);
      const actorId = randomUUID();
      const created = await createTask(store, {
        organizationId: orgId,
        actorId,
        type: "follow_up",
        priority: "normal",
      });

      const dismissed = await transitionTask(store, {
        organizationId: orgId,
        actorId,
        taskId: created.id,
        status: "dismissed",
      });
      expect(dismissed.status).toBe("dismissed");

      const stored = await tx.select({ id: task.id, status: task.status }).from(task);
      expect(stored.find((row) => row.id === created.id)?.status).toBe("dismissed");
    });
  });

  it("keeps another organization's task invisible (DEC-061)", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresTaskStore(tx);
      const created = await createTask(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        type: "follow_up",
        priority: "normal",
      });

      await expect(
        findTask(store, { organizationId: randomUUID(), taskId: created.id }),
      ).resolves.toBeUndefined();
    });
  });
});
