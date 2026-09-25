import { DomainError } from "@aquarela/domain";

import { INTEGRATION_AUDIT_ACTIONS, INTEGRATION_SOURCE_ENTITY_TYPE } from "./actions";
import {
  normalizeIntegrationSourceFields,
  type IntegrationSourceFieldsInput,
} from "./register-integration-source";
import type { IntegrationSourceRecord } from "./read-types";
import type { IntegrationSourceWriteStore } from "./write-types";

export interface UpdateIntegrationSourceInput extends IntegrationSourceFieldsInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly integrationSourceId: string;
}

export interface UpdateIntegrationSourceResult {
  readonly integrationSourceId: string;
}

/** The audit-fact projection of a registry row (no secrets, `DEC-015`). */
function auditSnapshot(record: IntegrationSourceRecord) {
  return {
    name: record.name,
    system_type: record.systemType,
    direction: record.direction,
    allowed_operations: record.allowedOperations,
    credentials_owner: record.credentialsOwner,
    rate_limit_note: record.rateLimitNote,
    terms_status: record.termsStatus,
    active: record.active,
  };
}

/**
 * Updates one organization-owned `integration_source` (`INTG-001`, `DEC-137`).
 * The row is loaded first so a scoped miss fails with a message and so the audit
 * fact can carry the before/after diff. The same field validation as
 * registration applies — including the `DEC-015` write-requires-approved-terms
 * invariant — and a rename onto another source's name is refused before the
 * write. `INTG-002` publishing is not built here.
 */
export async function updateIntegrationSource(
  store: IntegrationSourceWriteStore,
  input: UpdateIntegrationSourceInput,
): Promise<UpdateIntegrationSourceResult> {
  const fields = normalizeIntegrationSourceFields(input);

  return store.withTransaction(async (tx) => {
    const current = await tx.findIntegrationSourceById(
      input.organizationId,
      input.integrationSourceId,
    );
    if (current === undefined) {
      throw new DomainError("integration source not found in organization");
    }

    if (fields.name !== current.name) {
      const duplicate = await tx.findIntegrationSourceByName(input.organizationId, fields.name);
      if (duplicate !== undefined && duplicate.id !== current.id) {
        throw new DomainError(
          `integration source name "${fields.name}" already exists in this organization`,
        );
      }
    }

    const updated = await tx.updateIntegrationSource({
      organizationId: input.organizationId,
      integrationSourceId: input.integrationSourceId,
      ...fields,
      actorId: input.actorId,
    });
    if (updated === undefined) {
      throw new DomainError("integration source not found in organization");
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: INTEGRATION_AUDIT_ACTIONS.integrationSourceUpdated,
      entityType: INTEGRATION_SOURCE_ENTITY_TYPE,
      entityId: updated.id,
      before: auditSnapshot(current),
      after: auditSnapshot(updated),
    });

    return { integrationSourceId: updated.id };
  });
}
