import type { TaskRecord, TaskStore } from "./types";

export interface FindTaskQuery {
  readonly organizationId: string;
  readonly taskId: string;
}

/**
 * One task by id, organization-scoped (`DEC-061`), or `undefined`. A missing id
 * and another tenant's id are indistinguishable, so a caller cannot probe for
 * the existence of a task outside its organization.
 */
export async function findTask(
  store: TaskStore,
  query: FindTaskQuery,
): Promise<TaskRecord | undefined> {
  return store.findTask({ organizationId: query.organizationId, taskId: query.taskId });
}
