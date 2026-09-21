import { DomainError, NotFoundError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { HMS_AUDIT_ACTIONS } from "./actions";
import { assertChecklistItems } from "./checklist-validation";
import { CHECKLIST_CATEGORIES, CHECKLIST_FREQUENCIES } from "./register-checklist-template";
import type { ChecklistTemplateRecord, HmsStore } from "./types";

export interface UpdateChecklistTemplateInput {
  readonly organizationId: string;
  readonly templateId: string;
  /** Non-empty; trimmed. Omitted leaves the name unchanged. */
  readonly name?: string;
  /** One of `CHECKLIST_CATEGORY`. */
  readonly category?: string;
  /** One of `CHECK_FREQUENCY`. */
  readonly frequency?: string;
  /** jsonb array; replaces the whole item list. */
  readonly items?: unknown;
  /** `false` retires the template without deleting it. */
  readonly active?: boolean;
  readonly actorId: string;
}

/** Patch field → audit payload key, so `before`/`after` share one shape. */
const AUDIT_FIELDS = {
  name: "name",
  category: "category",
  frequency: "frequency",
  items: "items",
  active: "active",
} as const;

/**
 * Amends one checklist template (`HMS-005`, `DEC-091`). The template is loaded
 * organization-scoped first (`DEC-061`; a missing or cross-organization id is a
 * typed `NotFoundError`), then the patch is validated: `name` must stay
 * non-empty, `category`/`frequency` are checked against their vocabularies and
 * `items` against the array shape. `supersedes_id` is immutable after creation —
 * a new revision is a new row (`HMS-005`), not a re-pointing of this one. The
 * update and its audit fact commit or roll back together.
 */
export async function updateChecklistTemplate(
  store: HmsStore,
  input: UpdateChecklistTemplateInput,
): Promise<ChecklistTemplateRecord> {
  if (isBlank(input.templateId)) {
    throw new DomainError("templateId is required");
  }

  return store.withTransaction(async (tx) => {
    const template = await tx.findChecklistTemplate({
      organizationId: input.organizationId,
      templateId: input.templateId,
    });
    if (template === undefined) {
      throw new NotFoundError("checklist template not found in organization");
    }

    const mutable: {
      name?: string;
      category?: string;
      frequency?: string;
      items?: unknown;
      active?: boolean;
    } = {};

    if (input.name !== undefined) {
      if (isBlank(input.name)) {
        throw new DomainError("name is required");
      }
      mutable.name = input.name.trim();
    }
    if (input.category !== undefined) {
      if (!CHECKLIST_CATEGORIES.includes(input.category)) {
        throw new DomainError(`category must be one of ${CHECKLIST_CATEGORIES.join(", ")}`);
      }
      mutable.category = input.category;
    }
    if (input.frequency !== undefined) {
      if (!CHECKLIST_FREQUENCIES.includes(input.frequency)) {
        throw new DomainError(`frequency must be one of ${CHECKLIST_FREQUENCIES.join(", ")}`);
      }
      mutable.frequency = input.frequency;
    }
    if (input.items !== undefined) {
      assertChecklistItems(input.items);
      mutable.items = input.items;
    }
    if (input.active !== undefined) {
      mutable.active = input.active;
    }

    if (Object.keys(mutable).length === 0) {
      throw new DomainError("no updatable fields provided");
    }

    const updated = await tx.updateChecklistTemplate({
      organizationId: input.organizationId,
      templateId: template.id,
      ...mutable,
      updatedBy: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("checklist template not found in organization");
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of Object.keys(AUDIT_FIELDS) as (keyof typeof AUDIT_FIELDS)[]) {
      if (mutable[field] === undefined) continue;
      before[AUDIT_FIELDS[field]] = template[field];
      after[AUDIT_FIELDS[field]] = updated[field];
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: HMS_AUDIT_ACTIONS.checklistTemplateUpdated,
      entityType: "checklist_template",
      entityId: updated.id,
      before,
      after,
    });

    return updated;
  });
}
