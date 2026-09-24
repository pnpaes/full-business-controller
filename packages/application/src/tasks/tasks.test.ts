import { DomainError, NotFoundError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { TASK_AUDIT_ACTIONS } from "./actions";
import { assignTask } from "./assign-task";
import { createTask } from "./create-task";
import { findTask } from "./find-task";
import { listAssignableUsers } from "./list-assignable-users";
import { listTasks } from "./list-tasks";
import { createInMemoryTaskStore, taskRecord } from "./test-support";
import { transitionTask } from "./transition-task";

const ORG = "org-1";

describe("createTask (DEC-122)", () => {
  it("creates an open task and records one audit fact", async () => {
    const store = createInMemoryTaskStore();

    const task = await createTask(store, {
      organizationId: ORG,
      actorId: "user-1",
      type: "follow_up",
      priority: "high",
      dueDate: "2026-10-01",
      ownerId: "user-2",
    });

    expect(task).toMatchObject({
      organizationId: ORG,
      type: "follow_up",
      priority: "high",
      dueDate: "2026-10-01",
      ownerId: "user-2",
      status: "open",
      resolution: null,
    });
    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({
      action: TASK_AUDIT_ACTIONS.taskCreated,
      entityType: "task",
      entityId: task.id,
      actorId: "user-1",
    });
  });

  it("trims the type and priority and defaults the optional fields", async () => {
    const store = createInMemoryTaskStore();

    const task = await createTask(store, {
      organizationId: ORG,
      actorId: "user-1",
      type: "  follow_up  ",
      priority: "  normal  ",
    });

    expect(task.type).toBe("follow_up");
    expect(task.priority).toBe("normal");
    expect(task.ownerId).toBeNull();
    expect(task.dueDate).toBeNull();
  });

  it.each([
    { type: "   ", priority: "normal" },
    { type: "follow_up", priority: "  " },
  ])("rejects a blank required field %j", async (input) => {
    const store = createInMemoryTaskStore();
    await expect(
      createTask(store, { organizationId: ORG, actorId: "user-1", ...input }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.audits).toHaveLength(0);
  });

  it("rejects a half-set polymorphic link", async () => {
    const store = createInMemoryTaskStore();
    await expect(
      createTask(store, {
        organizationId: ORG,
        actorId: "user-1",
        type: "follow_up",
        priority: "normal",
        linkedEntityType: "hms_incident",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.audits).toHaveLength(0);
  });
});

describe("findTask / listTasks", () => {
  it("scopes a find to the organization", async () => {
    const task = taskRecord({ organizationId: ORG });
    const store = createInMemoryTaskStore({ tasks: [task] });

    await expect(findTask(store, { organizationId: ORG, taskId: task.id })).resolves.toMatchObject({
      id: task.id,
    });
    await expect(
      findTask(store, { organizationId: "other-org", taskId: task.id }),
    ).resolves.toBeUndefined();
  });

  it("filters by status and owner, and orders by due date then id", async () => {
    const later = taskRecord({ organizationId: ORG, dueDate: "2026-10-02" });
    const earlier = taskRecord({ organizationId: ORG, dueDate: "2026-10-01", ownerId: "user-9" });
    const undated = taskRecord({ organizationId: ORG, dueDate: null });
    const otherOrg = taskRecord({ organizationId: "other-org", dueDate: "2026-09-01" });
    const store = createInMemoryTaskStore({ tasks: [later, earlier, undated, otherOrg] });

    const all = await listTasks(store, { organizationId: ORG });
    expect(all.map((task) => task.id)).toEqual([earlier.id, later.id, undated.id]);

    const owned = await listTasks(store, { organizationId: ORG, ownerId: "user-9" });
    expect(owned.map((task) => task.id)).toEqual([earlier.id]);
  });

  it("rejects a status filter outside the schema vocabulary", async () => {
    const store = createInMemoryTaskStore();
    await expect(listTasks(store, { organizationId: ORG, status: "done" })).rejects.toBeInstanceOf(
      DomainError,
    );
  });

  it("applies the default limit so an unbounded read cannot happen", async () => {
    const store = createInMemoryTaskStore({ tasks: [taskRecord({ organizationId: ORG })] });
    const seen: number[] = [];
    store.listTasks = async (query) => {
      seen.push(query.limit ?? -1);
      return [];
    };
    await listTasks(store, { organizationId: ORG });
    expect(seen).toEqual([100]);
  });
});

describe("transitionTask (DEC-122)", () => {
  it("walks open -> in_progress -> blocked -> in_progress -> resolved and audits each step", async () => {
    const task = taskRecord({ organizationId: ORG, status: "open" });
    const store = createInMemoryTaskStore({ tasks: [task] });

    const started = await transitionTask(store, {
      organizationId: ORG,
      actorId: "user-1",
      taskId: task.id,
      status: "in_progress",
    });
    expect(started.status).toBe("in_progress");

    const blocked = await transitionTask(store, {
      organizationId: ORG,
      actorId: "user-1",
      taskId: task.id,
      status: "blocked",
    });
    expect(blocked.status).toBe("blocked");

    const unblocked = await transitionTask(store, {
      organizationId: ORG,
      actorId: "user-1",
      taskId: task.id,
      status: "in_progress",
    });
    expect(unblocked.status).toBe("in_progress");

    const resolved = await transitionTask(store, {
      organizationId: ORG,
      actorId: "user-1",
      taskId: task.id,
      status: "resolved",
    });
    expect(resolved.status).toBe("resolved");

    expect(store.audits.map((audit) => audit.action)).toEqual([
      TASK_AUDIT_ACTIONS.taskTransitioned,
      TASK_AUDIT_ACTIONS.taskTransitioned,
      TASK_AUDIT_ACTIONS.taskTransitioned,
      TASK_AUDIT_ACTIONS.taskTransitioned,
    ]);
    expect(store.audits[0]).toMatchObject({
      before: { status: "open" },
      after: { status: "in_progress" },
    });
    expect(store.audits[3]).toMatchObject({
      before: { status: "in_progress" },
      after: { status: "resolved" },
    });
  });

  it("dismisses from open and from in_progress", async () => {
    for (const status of ["open", "in_progress"] as const) {
      const task = taskRecord({ organizationId: ORG, status });
      const store = createInMemoryTaskStore({ tasks: [task] });
      await expect(
        transitionTask(store, {
          organizationId: ORG,
          actorId: "user-1",
          taskId: task.id,
          status: "dismissed",
        }),
      ).resolves.toMatchObject({ status: "dismissed" });
    }
  });

  it("rejects an unlisted transition with a message-only DomainError", async () => {
    const task = taskRecord({ organizationId: ORG, status: "open" });
    const store = createInMemoryTaskStore({ tasks: [task] });

    await expect(
      transitionTask(store, {
        organizationId: ORG,
        actorId: "user-1",
        taskId: task.id,
        status: "resolved",
      }),
    ).rejects.toThrow(DomainError);
    expect(store.audits).toHaveLength(0);
  });

  it("rejects a transition from an unknown current status", async () => {
    const task = taskRecord({ organizationId: ORG, status: "done" });
    const store = createInMemoryTaskStore({ tasks: [task] });

    await expect(
      transitionTask(store, {
        organizationId: ORG,
        actorId: "user-1",
        taskId: task.id,
        status: "in_progress",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("treats resolved/dismissed as terminal", async () => {
    for (const status of ["resolved", "dismissed"] as const) {
      const task = taskRecord({ organizationId: ORG, status });
      const store = createInMemoryTaskStore({ tasks: [task] });
      await expect(
        transitionTask(store, {
          organizationId: ORG,
          actorId: "user-1",
          taskId: task.id,
          status: "in_progress",
        }),
      ).rejects.toBeInstanceOf(DomainError);
    }
  });

  it("throws a typed NotFoundError for a missing or cross-organization task", async () => {
    const store = createInMemoryTaskStore();
    await expect(
      transitionTask(store, {
        organizationId: ORG,
        actorId: "user-1",
        taskId: "11111111-1111-4111-8111-111111111111",
        status: "in_progress",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects a concurrent move that changed the status after the guard", async () => {
    const task = taskRecord({ organizationId: ORG, status: "open" });
    const store = createInMemoryTaskStore({ tasks: [task] });
    store.transitionTaskStatus = async () => undefined;

    await expect(
      transitionTask(store, {
        organizationId: ORG,
        actorId: "user-1",
        taskId: task.id,
        status: "in_progress",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.audits).toHaveLength(0);
  });
});

describe("assignTask (DEC-122)", () => {
  it("sets the assignee and audits the before/after", async () => {
    const task = taskRecord({ organizationId: ORG, ownerId: null });
    const store = createInMemoryTaskStore({ tasks: [task] });

    const assigned = await assignTask(store, {
      organizationId: ORG,
      actorId: "user-1",
      taskId: task.id,
      ownerId: "user-2",
    });

    expect(assigned.ownerId).toBe("user-2");
    expect(store.audits[0]).toMatchObject({
      action: TASK_AUDIT_ACTIONS.taskAssigned,
      before: { owner_id: null },
      after: { owner_id: "user-2" },
    });
  });

  it("clears the assignee with an explicit null", async () => {
    const task = taskRecord({ organizationId: ORG, ownerId: "user-2" });
    const store = createInMemoryTaskStore({ tasks: [task] });

    const cleared = await assignTask(store, {
      organizationId: ORG,
      actorId: "user-1",
      taskId: task.id,
      ownerId: null,
    });
    expect(cleared.ownerId).toBeNull();
  });

  it("refuses to reassign a terminal task", async () => {
    const task = taskRecord({ organizationId: ORG, status: "resolved" });
    const store = createInMemoryTaskStore({ tasks: [task] });

    await expect(
      assignTask(store, {
        organizationId: ORG,
        actorId: "user-1",
        taskId: task.id,
        ownerId: "user-2",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.audits).toHaveLength(0);
  });

  it("throws a typed NotFoundError for a missing task", async () => {
    const store = createInMemoryTaskStore();
    await expect(
      assignTask(store, {
        organizationId: ORG,
        actorId: "user-1",
        taskId: "11111111-1111-4111-8111-111111111111",
        ownerId: "user-2",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("listAssignableUsers", () => {
  it("returns the store's active users", async () => {
    const store = createInMemoryTaskStore({
      users: [{ id: "user-2", displayName: "Bo", username: "bo" }],
    });

    await expect(listAssignableUsers(store, { organizationId: ORG })).resolves.toEqual([
      { id: "user-2", displayName: "Bo", username: "bo" },
    ]);
  });
});
