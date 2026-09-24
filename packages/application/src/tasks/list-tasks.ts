import { DomainError } from "@aquarela/domain";

import { TASK_STATUSES, type TaskStatus } from "./status-machine";
import type { TaskRecord, TaskStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_TASK_LIMIT = 100;

export interface ListTasksQuery {
  readonly organizationId: string;
  /** One of `TASK_STATUSES`, exact match. */
  readonly status?: string;
  readonly ownerId?: string;
  /** Inclusive upper bound on `due_date`; `YYYY-MM-DD`. */
  readonly dueBefore?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Tasks for one organization, ordered by `due_date` then `id`, with optional
 * status/owner/due-before filters. The organization filter is never optional, so
 * a caller cannot read another tenant's tasks (`DEC-061`); a provided `status` is
 * checked against the domain vocabulary here so a bogus filter is a
 * `DomainError` rather than a silently empty page; `limit` defaults to
 * `DEFAULT_TASK_LIMIT` so a caller cannot ask for every task unbounded.
 */
export async function listTasks(
  store: TaskStore,
  query: ListTasksQuery,
): Promise<readonly TaskRecord[]> {
  if (query.status !== undefined && !TASK_STATUSES.includes(query.status as TaskStatus)) {
    throw new DomainError(`status must be one of ${TASK_STATUSES.join(", ")}`);
  }

  return store.listTasks({
    organizationId: query.organizationId,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.ownerId === undefined ? {} : { ownerId: query.ownerId }),
    ...(query.dueBefore === undefined ? {} : { dueBefore: query.dueBefore }),
    limit: query.limit ?? DEFAULT_TASK_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
