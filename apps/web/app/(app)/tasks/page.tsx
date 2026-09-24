import {
  TASK_STATUSES,
  createPostgresTaskStore,
  listAssignableUsers,
  listTasks,
  type TaskStatus,
} from "@aquarela/application";
import {
  Alert,
  DataTable,
  type DataTableColumn,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusPill,
  spacing,
} from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getAuthStore } from "../../../lib/auth";
import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";
import { getServerSession } from "../../../lib/server-session";

import {
  canWriteTasks,
  isTaskAuthorized,
  loadTaskAccess,
  TASK_READ_ROLES,
} from "../../api/v1/tasks/access";
import { isUuid } from "../../api/v1/tasks/task-rows";

import { NewTaskForm } from "./new-task-form";
import { TaskFilters } from "./task-filters";
import { TaskRowControls } from "./task-row-controls";
import {
  formatTaskDay,
  isTerminalTaskStatus,
  taskAllowedTargets,
  taskDueView,
  taskPriorityView,
  taskStatusView,
} from "./task-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tasks — Aquarela Business Control" };

/** The register shows a bounded working set; the read API pages beyond it. */
const REGISTER_LIMIT = 200;

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  width: "100%",
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The task register (`DEC-122`): the operational list of tasks with status,
 * priority, assignee and due date, a status/assignee/due filter bar, the
 * create form and the per-row assign/transition controls. Reads the same
 * application service and row shape as `GET /api/v1/tasks`, so the screen and the
 * API cannot drift.
 *
 * Access is provisional (`DEC-122`, owner confirmation required): every
 * authenticated role reads, and owner / general manager / admin / location
 * manager write. Because `task` has no `location_id`, a location manager's write
 * authority is **organization-wide** — stated on the page rather than hidden.
 * The `task`↔`approval` link stays open (the recorded `HMS-001` conflict), so the
 * page does not surface approvals.
 */
export default async function TasksPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly status?: string;
    readonly ownerId?: string;
    readonly dueBefore?: string;
  }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadTaskAccess(session.userId);
  if (!isTaskAuthorized(access, TASK_READ_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader
          title="Tasks"
          scope="Tasks"
          description="Operational follow-up work: assign, progress and close tasks."
        />
        <EmptyState title="Not available for your role">
          The task register is limited to authenticated roles (DEC-122). Ask an owner or
          administrator for a role.
        </EmptyState>
      </div>
    );
  }

  const params = await searchParams;
  const status =
    params.status !== undefined && TASK_STATUSES.includes(params.status as TaskStatus)
      ? params.status
      : undefined;
  const ownerId =
    params.ownerId !== undefined && isUuid(params.ownerId) ? params.ownerId : undefined;
  const dueBefore =
    params.dueBefore !== undefined && DATE.test(params.dueBefore) ? params.dueBefore : undefined;

  const organizationId = resolveOrganization();
  const store = createPostgresTaskStore(getDb().db);
  const tasks = await listTasks(store, {
    organizationId,
    ...(status === undefined ? {} : { status }),
    ...(ownerId === undefined ? {} : { ownerId }),
    ...(dueBefore === undefined ? {} : { dueBefore }),
    limit: REGISTER_LIMIT,
  });

  const canWrite = canWriteTasks(access);
  const assignableUsers = await listAssignableUsers(store, { organizationId });
  const userOptions = assignableUsers.map((user) => ({
    id: user.id,
    label: user.username === null ? user.displayName : `${user.displayName} · ${user.username}`,
  }));

  // Resolve assignees to a profile label. The active-user read supplies a display
  // name; an id outside it (a disabled user) falls back to the auth profile, then
  // to the id itself — never invent a name (the app-shell convention).
  const ownerLabelById = new Map(
    assignableUsers.map((user) => [user.id, user.displayName] as const),
  );
  const unresolvedOwnerIds = [
    ...new Set(
      tasks.flatMap((task) =>
        task.ownerId === null || ownerLabelById.has(task.ownerId) ? [] : [task.ownerId],
      ),
    ),
  ];
  const profiles = await Promise.all(
    unresolvedOwnerIds.map((id) => getAuthStore().findUserById(id)),
  );
  unresolvedOwnerIds.forEach((id, index) => {
    const profile = profiles[index];
    ownerLabelById.set(id, profile === undefined ? id : (profile.username ?? profile.email ?? id));
  });

  const today = new Date().toISOString().slice(0, 10);

  const columns: readonly DataTableColumn[] = [
    { key: "type", header: "Task" },
    { key: "priority", header: "Priority" },
    { key: "status", header: "Status" },
    { key: "assignee", header: "Assignee" },
    { key: "due", header: "Due" },
    ...(canWrite ? [{ key: "actions", header: "Actions" } as DataTableColumn] : []),
  ];

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Tasks"
        scope="Tasks"
        description="Operational follow-up work: create, assign and progress tasks. Status moves open → in progress → resolved, open/in progress → dismissed, with blocked re-entering in progress (DEC-122)."
      />

      <Alert tone="warning" title="Access is provisional (DEC-122)">
        Every authenticated role reads tasks; owner, general manager, admin and location manager may
        create, assign and transition them. A location manager&apos;s authority is{" "}
        <strong>organization-wide</strong>, because <code>task</code> has no location column. The{" "}
        <code>task</code>↔<code>approval</code> link is not built (the recorded HMS-001 conflict
        stays open), so approvals are not shown here.
      </Alert>

      <SectionCard title="Filters" meta="status · assignee · due date">
        <TaskFilters
          owners={userOptions}
          status={status ?? ""}
          ownerId={ownerId ?? ""}
          dueBefore={dueBefore ?? ""}
        />
      </SectionCard>

      <SectionCard
        title="Tasks"
        meta={`${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} · by due date`}
      >
        <DataTable
          caption="Tasks by type, priority, status, assignee and due date"
          columns={columns}
          rows={tasks.map((task) => {
            const due = taskDueView(task.dueDate, today, task.status);
            return {
              type: task.type,
              priority: (
                <StatusPill tone={taskPriorityView(task.priority).tone}>
                  {taskPriorityView(task.priority).label}
                </StatusPill>
              ),
              status: (
                <StatusPill tone={taskStatusView(task.status).tone}>
                  {taskStatusView(task.status).label}
                </StatusPill>
              ),
              assignee:
                task.ownerId === null ? "—" : (ownerLabelById.get(task.ownerId) ?? task.ownerId),
              due: (
                <span>
                  {formatTaskDay(task.dueDate)}
                  {due === null ? null : (
                    <>
                      {" "}
                      <StatusPill tone={due.tone}>{due.label}</StatusPill>
                    </>
                  )}
                </span>
              ),
              ...(canWrite
                ? {
                    actions: isTerminalTaskStatus(task.status) ? (
                      "—"
                    ) : (
                      <TaskRowControls
                        taskId={task.id}
                        ownerId={task.ownerId}
                        users={userOptions}
                        allowedTargets={taskAllowedTargets(task.status)}
                      />
                    ),
                  }
                : {}),
            };
          })}
          emptyMessage="No tasks match. Create one below, or clear the filters."
        />
      </SectionCard>

      {canWrite ? (
        <NewTaskForm users={userOptions} />
      ) : (
        <SectionCard title="Create a task" meta="write roles only">
          <EmptyState title="Creating is not available for your role">
            You can read and follow tasks, but creating, assigning and transitioning them needs
            owner, general manager, admin or location manager (DEC-122).
          </EmptyState>
        </SectionCard>
      )}
    </div>
  );
}
