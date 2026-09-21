import type { ChecklistTemplateRecord, HmsStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_CHECKLIST_TEMPLATE_LIMIT = 50;

export interface ListChecklistTemplatesQuery {
  readonly organizationId: string;
  readonly category?: string;
  readonly active?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Checklist templates for one organization, name then id, with optional
 * category and active filters. The organization filter is never optional, so a
 * caller cannot read another tenant's templates (`DEC-061`); `limit` defaults to
 * `DEFAULT_CHECKLIST_TEMPLATE_LIMIT` so a caller cannot ask for the whole
 * register unbounded.
 */
export async function listChecklistTemplates(
  store: HmsStore,
  query: ListChecklistTemplatesQuery,
): Promise<readonly ChecklistTemplateRecord[]> {
  return store.listChecklistTemplates({
    organizationId: query.organizationId,
    ...(query.category === undefined ? {} : { category: query.category }),
    ...(query.active === undefined ? {} : { active: query.active }),
    limit: query.limit ?? DEFAULT_CHECKLIST_TEMPLATE_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
}
