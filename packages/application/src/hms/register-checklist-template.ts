import { DomainError, NotFoundError } from "@aquarela/domain";
import { CHECKLIST_CATEGORY, CHECK_FREQUENCY } from "@aquarela/persistence";

import { isBlank } from "../inventory/validation";

import { HMS_AUDIT_ACTIONS } from "./actions";
import { assertChecklistItems } from "./checklist-validation";
import type { ChecklistTemplateRecord, HmsStore } from "./types";

/** The `category` vocabulary a template may hold (`CHECKLIST_CATEGORY`). */
export const CHECKLIST_CATEGORIES: readonly string[] = CHECKLIST_CATEGORY;
/** The `frequency` vocabulary (`CHECK_FREQUENCY`, reused per `DEC-096`). */
export const CHECKLIST_FREQUENCIES: readonly string[] = CHECK_FREQUENCY;

export interface RegisterChecklistTemplateInput {
  readonly organizationId: string;
  readonly name: string;
  /** One of `CHECKLIST_CATEGORY`. */
  readonly category: string;
  /** One of `CHECK_FREQUENCY` (the shared cadence vocabulary). */
  readonly frequency: string;
  /** jsonb array of `{ key, label, required? }` items. */
  readonly items: unknown;
  /** Defaults `true`; `false` archives a template without deleting it. */
  readonly active?: boolean;
  /** The template row this revision replaces (`HMS-005`); null for a first revision. */
  readonly supersedesId?: string | null;
  readonly actorId: string;
}

/**
 * Registers one checklist template (`HMS-005`, `DEC-091`): validates the
 * required name, the `category`/`frequency` vocabularies and the `items` array
 * shape, then creates the template (active by default) and its audit fact in one
 * transaction. The create is organization-scoped through `input.organizationId`
 * (`DEC-061`).
 *
 * A revision (`supersedesId`) replaces an active template (`DEC-096`): the
 * target is resolved organization-scoped (unknown/cross-organization → typed
 * `NotFoundError`; already retired → `DomainError`), then the new row is created
 * and the superseded row deactivated in the same transaction, each with its own
 * audit fact. `supersedes_id` is immutable after creation, so a revision cycle
 * is unreachable (`HMS-005`).
 *
 * `category`/`frequency` have database checks too
 * (`checklist_template_category_check`, `checklist_template_frequency_check`),
 * but they are enforced here so the fake-store unit suite and the API see one
 * error class (`DomainError`) with a readable message.
 */
export async function registerChecklistTemplate(
  store: HmsStore,
  input: RegisterChecklistTemplateInput,
): Promise<ChecklistTemplateRecord> {
  if (isBlank(input.name)) {
    throw new DomainError("name is required");
  }
  if (!CHECKLIST_CATEGORIES.includes(input.category)) {
    throw new DomainError(`category must be one of ${CHECKLIST_CATEGORIES.join(", ")}`);
  }
  if (!CHECKLIST_FREQUENCIES.includes(input.frequency)) {
    throw new DomainError(`frequency must be one of ${CHECKLIST_FREQUENCIES.join(", ")}`);
  }
  assertChecklistItems(input.items);

  return store.withTransaction(async (tx) => {
    // A revision replaces an *active* template: the target is resolved
    // organization-scoped (`DEC-061`) and a missing/cross-organization id is a
    // typed 404, while a target that is already retired cannot be superseded.
    // The new row and the deactivation of the old one commit or roll back
    // together (`DEC-096`: the superseded revision "is deactivated").
    const supersedesId = input.supersedesId ?? null;
    let superseded: ChecklistTemplateRecord | undefined;
    if (supersedesId !== null) {
      superseded = await tx.findChecklistTemplate({
        organizationId: input.organizationId,
        templateId: supersedesId,
      });
      if (superseded === undefined) {
        throw new NotFoundError("superseded checklist template not found in organization");
      }
      if (!superseded.active) {
        throw new DomainError("a superseded checklist template must be active");
      }
    }

    const template = await tx.createChecklistTemplate({
      organizationId: input.organizationId,
      name: input.name.trim(),
      category: input.category,
      frequency: input.frequency,
      items: input.items,
      active: input.active ?? true,
      supersedesId,
      createdBy: input.actorId,
    });

    if (superseded !== undefined) {
      await tx.updateChecklistTemplate({
        organizationId: input.organizationId,
        templateId: superseded.id,
        active: false,
        updatedBy: input.actorId,
      });
      await tx.writeAudit({
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: HMS_AUDIT_ACTIONS.checklistTemplateUpdated,
        entityType: "checklist_template",
        entityId: superseded.id,
        before: { active: superseded.active },
        after: { active: false },
      });
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: HMS_AUDIT_ACTIONS.checklistTemplateCreated,
      entityType: "checklist_template",
      entityId: template.id,
      after: {
        name: template.name,
        category: template.category,
        frequency: template.frequency,
        items: template.items,
        active: template.active,
        supersedes_id: template.supersedesId,
      },
    });

    return template;
  });
}
