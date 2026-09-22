import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { approval, organization } from "../schema";
import {
  createApproval,
  createTask,
  decideApproval,
  findApproval,
  findTask,
  listApprovals,
  listTasks,
  updateTask,
} from "./workflow";
import {
  createTestApproval,
  createTestOrganization,
  createTestTask,
  inRollback,
  rejectionCause,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

/** The PostgreSQL error code of a rejection's cause (e.g. `23514`). */
const errorCode = (cause: Error): string | undefined => (cause as { code?: string }).code;

const ACTOR = "00000000-0000-0000-0000-0000000000aa";
const OWNER = "00000000-0000-0000-0000-0000000000bb";

describe.skipIf(!databaseUrl)("workflow repository", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
  });

  afterAll(async () => {
    if (client) {
      // Every task and approval is created inside a rolled-back transaction, so
      // the only committed fixture to unwind is the organization.
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates a task and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTask(tx, {
        organizationId: orgId,
        type: "review",
        priority: "high",
        ownerId: OWNER,
        dueDate: "2026-04-01",
        createdBy: ACTOR,
      });
      expect(created.type).toBe("review");
      expect(created.priority).toBe("high");
      expect(created.ownerId).toBe(OWNER);
      expect(created.dueDate).toBe("2026-04-01");
      expect(created.status).toBe("open");
      expect(created.resolution).toBeNull();
      expect(created.linkedEntityType).toBeNull();
      expect(created.linkedEntityId).toBeNull();
      expect(created.createdFromEventId).toBeNull();
      expect(created.createdBy).toBe(ACTOR);

      expect((await findTask(tx, { organizationId: orgId, taskId: created.id }))?.id).toBe(
        created.id,
      );

      // A task in another organization is invisible at this scope.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findTask(tx, { organizationId: otherOrgId, taskId: created.id }),
      ).toBeUndefined();
    });
  });

  it("updates a task's mutable fields, records the actor and clears with null", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestTask(tx, orgId, { ownerId: OWNER, dueDate: "2026-04-01" });
      const updated = await updateTask(tx, {
        organizationId: orgId,
        taskId: created.id,
        type: "follow_up",
        priority: "urgent",
        status: "in_progress",
        resolution: "in review",
        actorId: ACTOR,
      });
      expect(updated?.type).toBe("follow_up");
      expect(updated?.priority).toBe("urgent");
      expect(updated?.status).toBe("in_progress");
      expect(updated?.resolution).toBe("in review");
      expect(updated?.ownerId).toBe(OWNER);
      expect(updated?.updatedBy).toBe(ACTOR);
      expect(updated?.updatedAt).not.toBeNull();

      // An explicit null clears the owner; an omitted field is untouched.
      const cleared = await updateTask(tx, {
        organizationId: orgId,
        taskId: created.id,
        ownerId: null,
      });
      expect(cleared?.ownerId).toBeNull();
      expect(cleared?.type).toBe("follow_up");
    });
  });

  it("does not update a task through another organization's scope", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestTask(tx, orgId, { type: "original" });
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await updateTask(tx, {
          organizationId: otherOrgId,
          taskId: created.id,
          type: "hijacked",
        }),
      ).toBeUndefined();
      expect((await findTask(tx, { organizationId: orgId, taskId: created.id }))?.type).toBe(
        "original",
      );
    });
  });

  it("lists tasks by due_date (nulls last), with filters and paging", async () => {
    await inRollback(client.db, async (tx) => {
      const january = await createTestTask(tx, orgId, {
        dueDate: "2026-01-01",
        status: "open",
        ownerId: OWNER,
      });
      const february = await createTestTask(tx, orgId, {
        dueDate: "2026-02-01",
        status: "blocked",
        ownerId: ACTOR,
      });
      const march = await createTestTask(tx, orgId, {
        dueDate: "2026-03-01",
        status: "open",
        linkedEntityType: "hms_incident",
        linkedEntityId: randomUUID(),
      });
      const undated = await createTestTask(tx, orgId, { status: "resolved" });

      const all = await listTasks(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([january.id, february.id, march.id, undated.id]);

      const open = await listTasks(tx, { organizationId: orgId, status: "open" });
      expect(open.map((row) => row.id)).toEqual([january.id, march.id]);

      const mine = await listTasks(tx, { organizationId: orgId, ownerId: OWNER });
      expect(mine.map((row) => row.id)).toEqual([january.id]);

      const linked = await listTasks(tx, {
        organizationId: orgId,
        linkedEntityType: "hms_incident",
      });
      expect(linked.map((row) => row.id)).toEqual([march.id]);

      const linkedById = await listTasks(tx, {
        organizationId: orgId,
        linkedEntityId: march.linkedEntityId!,
      });
      expect(linkedById.map((row) => row.id)).toEqual([march.id]);

      const dueBefore = await listTasks(tx, { organizationId: orgId, dueBefore: "2026-02-15" });
      expect(dueBefore.map((row) => row.id)).toEqual([january.id, february.id]);

      const paged = await listTasks(tx, { organizationId: orgId, limit: 1, offset: 1 });
      expect(paged.map((row) => row.id)).toEqual([february.id]);

      // A second organization's tasks never leak in.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      await createTestTask(tx, otherOrgId, { dueDate: "2026-01-01" });
      expect((await listTasks(tx, { organizationId: orgId })).map((row) => row.id)).toEqual([
        january.id,
        february.id,
        march.id,
        undated.id,
      ]);
    });
  });

  it("rejects a task status outside its vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(createTestTask(tx, orgId, { status: "cancelled" }));
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/task_status_check/);
    });
  });

  it("rejects a half-linked task (only one of the linked-entity pair set)", async () => {
    await inRollback(client.db, async (tx) => {
      const typeOnly = await rejectionCause(
        createTestTask(tx, orgId, { linkedEntityType: "hms_incident" }),
      );
      expect(errorCode(typeOnly)).toBe("23514");
      expect(typeOnly.message).toMatch(/task_linked_entity_check/);
    });
    await inRollback(client.db, async (tx) => {
      const idOnly = await rejectionCause(
        createTestTask(tx, orgId, { linkedEntityId: randomUUID() }),
      );
      expect(errorCode(idOnly)).toBe("23514");
      expect(idOnly.message).toMatch(/task_linked_entity_check/);
    });
  });

  it("rejects a half-linked task on update, not just create", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestTask(tx, orgId, {
        linkedEntityType: "hms_incident",
        linkedEntityId: randomUUID(),
      });
      // Clearing only the id leaves the type set, so the all-or-nothing pair is
      // violated on the UPDATE path too.
      const cause = await rejectionCause(
        updateTask(tx, { organizationId: orgId, taskId: created.id, linkedEntityId: null }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/task_linked_entity_check/);
    });
  });

  it("creates a pending approval and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const entityId = randomUUID();
      const created = await createApproval(tx, {
        organizationId: orgId,
        entityType: "document",
        entityId,
        entityVersion: 3,
        requestedBy: OWNER,
        requestedAt: new Date("2026-05-01T09:00:00.000Z"),
        createdBy: ACTOR,
      });
      expect(created.entityType).toBe("document");
      expect(created.entityId).toBe(entityId);
      expect(created.entityVersion).toBe(3);
      expect(created.requestedBy).toBe(OWNER);
      expect(created.requestedAt.toISOString()).toBe("2026-05-01T09:00:00.000Z");
      expect(created.decidedBy).toBeNull();
      expect(created.decidedAt).toBeNull();
      expect(created.decision).toBeNull();
      expect(created.comment).toBeNull();
      expect(created.createdBy).toBe(ACTOR);

      expect((await findApproval(tx, { organizationId: orgId, approvalId: created.id }))?.id).toBe(
        created.id,
      );

      // An approval in another organization is invisible at this scope.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findApproval(tx, { organizationId: otherOrgId, approvalId: created.id }),
      ).toBeUndefined();
    });
  });

  it("decides an approval, writing the all-or-nothing decision triple", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestApproval(tx, orgId);
      const decided = await decideApproval(tx, {
        organizationId: orgId,
        approvalId: created.id,
        decision: "approved",
        decidedBy: OWNER,
        decidedAt: new Date("2026-05-02T10:00:00.000Z"),
        comment: "looks good",
        actorId: ACTOR,
      });
      expect(decided?.decision).toBe("approved");
      expect(decided?.decidedBy).toBe(OWNER);
      expect(decided?.decidedAt?.toISOString()).toBe("2026-05-02T10:00:00.000Z");
      expect(decided?.comment).toBe("looks good");
      expect(decided?.updatedBy).toBe(ACTOR);
      expect(decided?.updatedAt).not.toBeNull();

      // A cross-organization scope decides nothing.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await decideApproval(tx, {
          organizationId: otherOrgId,
          approvalId: created.id,
          decision: "rejected",
          decidedBy: OWNER,
          decidedAt: new Date("2026-05-03T10:00:00.000Z"),
        }),
      ).toBeUndefined();
    });
  });

  it("decides an approval only once; a second decide is a scoped miss", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestApproval(tx, orgId);
      const first = await decideApproval(tx, {
        organizationId: orgId,
        approvalId: created.id,
        decision: "approved",
        decidedBy: OWNER,
        decidedAt: new Date("2026-05-02T10:00:00.000Z"),
        comment: "first",
        actorId: ACTOR,
      });
      expect(first?.decision).toBe("approved");

      // A second decide updates nothing: the WHERE only matches a pending row.
      const second = await decideApproval(tx, {
        organizationId: orgId,
        approvalId: created.id,
        decision: "rejected",
        decidedBy: ACTOR,
        decidedAt: new Date("2026-05-03T10:00:00.000Z"),
      });
      expect(second).toBeUndefined();

      const found = await findApproval(tx, { organizationId: orgId, approvalId: created.id });
      expect(found?.decision).toBe("approved");
      expect(found?.decidedBy).toBe(OWNER);
      expect(found?.decidedAt?.toISOString()).toBe("2026-05-02T10:00:00.000Z");
    });
  });

  it("lists approvals newest requested_at first, with filters and paging", async () => {
    await inRollback(client.db, async (tx) => {
      const entityId = randomUUID();
      const january = await createTestApproval(tx, orgId, {
        requestedAt: new Date("2026-01-01T08:00:00.000Z"),
        entityType: "document",
        entityId,
      });
      const february = await createTestApproval(tx, orgId, {
        requestedAt: new Date("2026-02-01T08:00:00.000Z"),
        entityType: "document",
      });
      const march = await createTestApproval(tx, orgId, {
        requestedAt: new Date("2026-03-01T08:00:00.000Z"),
        entityType: "stock_count",
        decision: "approved",
        decidedBy: OWNER,
        decidedAt: new Date("2026-03-02T08:00:00.000Z"),
      });

      const all = await listApprovals(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([march.id, february.id, january.id]);

      const documents = await listApprovals(tx, { organizationId: orgId, entityType: "document" });
      expect(documents.map((row) => row.id)).toEqual([february.id, january.id]);

      const byEntity = await listApprovals(tx, { organizationId: orgId, entityId });
      expect(byEntity.map((row) => row.id)).toEqual([january.id]);

      const approved = await listApprovals(tx, { organizationId: orgId, decision: "approved" });
      expect(approved.map((row) => row.id)).toEqual([march.id]);

      const paged = await listApprovals(tx, { organizationId: orgId, limit: 1, offset: 1 });
      expect(paged.map((row) => row.id)).toEqual([february.id]);

      // A second organization's approvals never leak in.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      await createTestApproval(tx, otherOrgId);
      expect((await listApprovals(tx, { organizationId: orgId })).map((row) => row.id)).toEqual([
        march.id,
        february.id,
        january.id,
      ]);
    });
  });

  it("accepts a NULL decision (pending) but rejects a value outside the vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const pending = await createTestApproval(tx, orgId);
      expect(pending.decision).toBeNull();
    });
    await inRollback(client.db, async (tx) => {
      // Set the whole triple so only the vocabulary check can fire.
      const cause = await rejectionCause(
        createTestApproval(tx, orgId, {
          decision: "pending",
          decidedBy: OWNER,
          decidedAt: new Date("2026-05-02T10:00:00.000Z"),
        }),
      );
      expect(errorCode(cause)).toBe("23514");
      expect(cause.message).toMatch(/approval_decision_check/);
    });
  });

  it("rejects a half-decided approval", async () => {
    await inRollback(client.db, async (tx) => {
      const byOnly = await rejectionCause(createTestApproval(tx, orgId, { decidedBy: OWNER }));
      expect(errorCode(byOnly)).toBe("23514");
      expect(byOnly.message).toMatch(/approval_decided_check/);
    });
    await inRollback(client.db, async (tx) => {
      const atOnly = await rejectionCause(
        createTestApproval(tx, orgId, { decidedAt: new Date("2026-05-02T10:00:00.000Z") }),
      );
      expect(errorCode(atOnly)).toBe("23514");
      expect(atOnly.message).toMatch(/approval_decided_check/);
    });
  });

  it("is not append-only: task and approval rows are mutable in the database", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestTask(tx, orgId);
      const pending = await createTestApproval(tx, orgId);
      // `DEC-094` declares no append-only trigger, so an UPDATE succeeds inside
      // the rollback. The repository exposes the update/decide path rather than
      // deletes, and the amended value is what the row now carries.
      const amended = await updateTask(tx, {
        organizationId: orgId,
        taskId: created.id,
        status: "resolved",
        resolution: "amended in place",
      });
      expect(amended?.status).toBe("resolved");
      expect(amended?.resolution).toBe("amended in place");
      expect((await findTask(tx, { organizationId: orgId, taskId: created.id }))?.status).toBe(
        "resolved",
      );

      await tx
        .update(approval)
        .set({ comment: "amended in place" })
        .where(eq(approval.id, pending.id));
      expect(
        (await findApproval(tx, { organizationId: orgId, approvalId: pending.id }))?.comment,
      ).toBe("amended in place");
    });
  });
});
