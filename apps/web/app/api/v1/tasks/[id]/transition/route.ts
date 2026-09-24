import { createPostgresTaskStore, findTask, transitionTask } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";

import { isTaskAuthorized, loadTaskAccess, TASK_WRITE_ROLES } from "../../access";
import { taskLimiters } from "../../limiters";
import { isUuid, parseTransitionTaskBody, toTaskRow } from "../../task-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Transitions one task's status (`DEC-122`): `open → in_progress → resolved` or
 * `open`/`in_progress → dismissed`, with `blocked` re-entering `in_progress`, and
 * `resolved`/`dismissed` terminal. The actor is the session user.
 *
 * A write action (`TASK_WRITE_ROLES`). A non-UUID id or a malformed body is a
 * 400. The task is resolved organization-scoped **before** the command, so an
 * unknown or cross-organization id is a 404 and cannot leak; an illegal or
 * unknown transition is a message-only `DomainError` → 400.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, taskLimiters.transitionTask, async () => {
    const { session } = await requireSession(request);
    const access = await loadTaskAccess(session.userId);
    if (!isTaskAuthorized(access, TASK_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseTransitionTaskBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresTaskStore(getDb().db);

    const existing = await findTask(store, { organizationId, taskId: id });
    if (existing === undefined) {
      return jsonError(404);
    }

    let task;
    try {
      task = await transitionTask(store, {
        organizationId,
        actorId: session.userId,
        taskId: id,
        status: parsed.input.status,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ task: toTaskRow(organizationId, task) });
  });
}
