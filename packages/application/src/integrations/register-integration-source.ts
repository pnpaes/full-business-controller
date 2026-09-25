import { DomainError } from "@aquarela/domain";
import {
  ALLOWED_OPERATION,
  INTEGRATION_DIRECTION,
  INTEGRATION_SYSTEM_TYPE,
  INTEGRATION_TERMS_STATUS,
} from "@aquarela/persistence";

import { INTEGRATION_AUDIT_ACTIONS, INTEGRATION_SOURCE_ENTITY_TYPE } from "./actions";
import type { IntegrationSourceWriteStore } from "./write-types";

const SYSTEM_TYPES: readonly string[] = INTEGRATION_SYSTEM_TYPE;
const DIRECTIONS: readonly string[] = INTEGRATION_DIRECTION;
const TERMS_STATUSES: readonly string[] = INTEGRATION_TERMS_STATUS;
const ALLOWED_OPERATIONS: readonly string[] = ALLOWED_OPERATION;
/** The write operations the `DEC-015` gate covers; a read is always allowed. */
const WRITE_OPERATIONS: readonly string[] = [
  "write_price",
  "write_menu_product",
  "write_stock",
  "write_accounting",
];

/** The editable fields of a registry row, after normalisation. */
export interface NormalizedIntegrationSourceFields {
  readonly name: string;
  readonly systemType: string;
  readonly direction: string;
  readonly allowedOperations: readonly string[];
  readonly credentialsOwner: string;
  readonly rateLimitNote: string | null;
  readonly termsStatus: string;
  readonly active: boolean;
}

export interface IntegrationSourceFieldsInput {
  readonly name: string;
  readonly systemType: string;
  readonly direction?: string;
  readonly allowedOperations?: readonly string[];
  readonly credentialsOwner: string;
  readonly rateLimitNote?: string | null;
  readonly termsStatus?: string;
  readonly active?: boolean;
}

/**
 * Validates and canonicalises the editable fields of a source, raising a
 * message-only `DomainError` for the first offending field. Every value the DB
 * constrains is checked here — the system-type/direction/terms vocabularies, the
 * `ALLOWED_OPERATION` subset, a non-empty name and credentials owner — plus the
 * `DEC-015` invariant that a write operation requires `terms_status =
 * 'approved'`, mirrored by the database check so a direct insert cannot bypass
 * it. Shared by `registerIntegrationSource` and `updateIntegrationSource`.
 *
 * Defaults: `direction` `read` (the read-only posture), no allowed operations,
 * `termsStatus` `pending` and `active` true.
 */
export function normalizeIntegrationSourceFields(
  input: IntegrationSourceFieldsInput,
): NormalizedIntegrationSourceFields {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new DomainError("name must not be empty");
  }
  if (!SYSTEM_TYPES.includes(input.systemType)) {
    throw new DomainError(`systemType must be one of ${SYSTEM_TYPES.join(", ")}`);
  }
  const direction = input.direction ?? "read";
  if (!DIRECTIONS.includes(direction)) {
    throw new DomainError(`direction must be one of ${DIRECTIONS.join(", ")}`);
  }

  const allowedOperations = [...(input.allowedOperations ?? [])];
  for (const operation of allowedOperations) {
    if (!ALLOWED_OPERATIONS.includes(operation)) {
      throw new DomainError(`allowedOperations must only contain ${ALLOWED_OPERATIONS.join(", ")}`);
    }
  }

  const credentialsOwner = input.credentialsOwner.trim();
  if (credentialsOwner.length === 0) {
    throw new DomainError("credentialsOwner must not be empty");
  }

  const termsStatus = input.termsStatus ?? "pending";
  if (!TERMS_STATUSES.includes(termsStatus)) {
    throw new DomainError(`termsStatus must be one of ${TERMS_STATUSES.join(", ")}`);
  }

  const hasWriteOperation = allowedOperations.some((operation) =>
    WRITE_OPERATIONS.includes(operation),
  );
  if (hasWriteOperation && termsStatus !== "approved") {
    throw new DomainError(
      'allowedOperations may include a write operation only when termsStatus is "approved" (DEC-015)',
    );
  }

  return {
    name,
    systemType: input.systemType,
    direction,
    allowedOperations,
    credentialsOwner,
    rateLimitNote: input.rateLimitNote ?? null,
    termsStatus,
    active: input.active ?? true,
  };
}

export interface RegisterIntegrationSourceInput extends IntegrationSourceFieldsInput {
  readonly organizationId: string;
  readonly actorId: string;
}

export interface RegisterIntegrationSourceResult {
  readonly integrationSourceId: string;
}

/**
 * Registers one `integration_source` (`INTG-001`, `DEC-137`). The name is
 * unique per organization, so a duplicate is refused by name before the write.
 * Every registration is audited with the created row as `after`; no secrets are
 * ever written (the credentials owner is a name, not a credential). `ADR-0011`
 * is read-only, so the caller cannot enable a write operation until the source's
 * terms are approved — the DB check is the backstop.
 */
export async function registerIntegrationSource(
  store: IntegrationSourceWriteStore,
  input: RegisterIntegrationSourceInput,
): Promise<RegisterIntegrationSourceResult> {
  const fields = normalizeIntegrationSourceFields(input);

  return store.withTransaction(async (tx) => {
    const duplicate = await tx.findIntegrationSourceByName(input.organizationId, fields.name);
    if (duplicate !== undefined) {
      throw new DomainError(
        `integration source name "${fields.name}" already exists in this organization`,
      );
    }

    const created = await tx.createIntegrationSource({
      organizationId: input.organizationId,
      ...fields,
      actorId: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: INTEGRATION_AUDIT_ACTIONS.integrationSourceCreated,
      entityType: INTEGRATION_SOURCE_ENTITY_TYPE,
      entityId: created.id,
      after: {
        name: fields.name,
        system_type: fields.systemType,
        direction: fields.direction,
        allowed_operations: fields.allowedOperations,
        credentials_owner: fields.credentialsOwner,
        rate_limit_note: fields.rateLimitNote,
        terms_status: fields.termsStatus,
        active: fields.active,
      },
    });

    return { integrationSourceId: created.id };
  });
}
