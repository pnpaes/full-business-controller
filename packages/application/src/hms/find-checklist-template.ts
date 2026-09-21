import type { ChecklistTemplateRecord, HmsStore } from "./types";

export interface FindChecklistTemplateQuery {
  readonly organizationId: string;
  readonly templateId: string;
}

/**
 * One checklist template by id, organization-scoped (`DEC-061`), or
 * `undefined`. A missing id and another tenant's id are indistinguishable, so a
 * caller cannot probe for the existence of a template outside its organization.
 */
export async function findChecklistTemplate(
  store: HmsStore,
  query: FindChecklistTemplateQuery,
): Promise<ChecklistTemplateRecord | undefined> {
  return store.findChecklistTemplate({
    organizationId: query.organizationId,
    templateId: query.templateId,
  });
}
