import { createPostgresTaskStore, createTask, listTasks } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { withMutationGuards } from "../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../lib/http";
import { resolveOrganization } from "../../../../lib/organization";
import { readJsonObject } from "../../../../lib/request";
import { getServerSession } from "../../../../lib/server-session";

import { isTaskAuthorized, loadTaskAccess, TASK_READ_ROLES, TASK_WRITE_ROLES } from "./access";
import { taskLimiters } from "./limiters";
import { parseCreateTaskBody, parseTaskListQuery, toTaskRow, toTaskRows } from "./task-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The task register for the served organization (`DEC-122`).
 *
 * Query: optional `status` (one of the domain statuses), `ownerId` (uuid) and
 * `dueBefore` (`YYYY-MM-DD`) plus `limit`/`offset`. Response:
 * `{ ok: true, limit, offset, tasks }`. Signed out → 401; a role outside the
 * read set → 403 (every authenticated role reads, `TASK_READ_ROLES`); a
 * malformed filter → 400. Never returns another organization's tasks
 * (`DEC-061`).
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadTaskAccess(session.userId);
    if (!isTaskAuthorized(access, TASK_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseTaskListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresTaskStore(getDb().db);
    const tasks = await listTasks(store, {
      organizationId,
      ...(parsed.query.status === undefined ? {} : { status: parsed.query.status }),
      ...(parsed.query.ownerId === undefined ? {} : { ownerId: parsed.query.ownerId }),
      ...(parsed.query.dueBefore === undefined ? {} : { dueBefore: parsed.query.dueBefore }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      tasks: toTaskRows(organizationId, tasks),
    });
  });
}

/**
 * Creates one task (`DEC-122`) — a write action, so `TASK_WRITE_ROLES` (owner /
 * general_manager / admin / location_manager). The actor is the session user and
 * the organization the served tenant; the task always opens with status `open`.
 * A malformed body (blank `type`/`priority`, a bad date/uuid, a half link) is a
 * 400 from the parser or a `DomainError` from the command.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, taskLimiters.createTask, async () => {
    const { session } = await requireSession(request);
    const access = await loadTaskAccess(session.userId);
    if (!isTaskAuthorized(access, TASK_WRITE_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseCreateTaskBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresTaskStore(getDb().db);

    let task;
    try {
      task = await createTask(store, {
        organizationId,
        actorId: session.userId,
        type: parsed.input.type,
        priority: parsed.input.priority,
        dueDate: parsed.input.dueDate,
        ownerId: parsed.input.ownerId,
        linkedEntityType: parsed.input.linkedEntityType,
        linkedEntityId: parsed.input.linkedEntityId,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ task: toTaskRow(organizationId, task) });
  });
}
