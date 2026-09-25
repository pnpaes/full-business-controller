import { DomainError } from "@aquarela/domain";
import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type { IntegrationSourceReadStore, IntegrationSourceRecord } from "./read-types";
import type { IntegrationSourceWriteStore } from "./write-types";

/** The organization-unique name constraint (`integration_source_organization_id_name_key`). */
const INTEGRATION_SOURCE_NAME_CONSTRAINT = "integration_source_organization_id_name_key";

/**
 * Walks the `DrizzleQueryError` chain to the driver error: `drizzle-orm` wraps
 * the pg error, so the SQLSTATE lives on `.cause`, not on the caught object.
 */
function driverError(error: unknown): { code?: string; constraint?: string } | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      return current as { code: string; constraint?: string };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

function toRecord(row: repo.IntegrationSource): IntegrationSourceRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    systemType: row.systemType,
    direction: row.direction,
    allowedOperations: row.allowedOperations,
    credentialsOwner: row.credentialsOwner,
    rateLimitNote: row.rateLimitNote,
    termsStatus: row.termsStatus,
    active: row.active,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

/**
 * Adapts the `integration_source` table (through the persistence repository) to
 * both the read and write ports. Two concurrent creates with one name both pass
 * `findIntegrationSourceByName`, so the unique constraint is the concurrency
 * authority and its violation is mapped to the same domain failure the serial
 * path raises (400).
 */
export function createPostgresIntegrationSourceStore(
  db: Database,
): IntegrationSourceWriteStore & IntegrationSourceReadStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresIntegrationSourceStore(db));
      }
      return db.transaction((tx) => fn(createPostgresIntegrationSourceStore(tx)));
    },
    listIntegrationSources: async (query) => {
      const rows = await repo.listIntegrationSources(db, query);
      return rows.map(toRecord);
    },
    findIntegrationSourceByName: async (organizationId, name) => {
      const row = await repo.findIntegrationSourceByName(db, { organizationId, name });
      return row === undefined ? undefined : toRecord(row);
    },
    findIntegrationSourceById: async (organizationId, integrationSourceId) => {
      const row = await repo.findIntegrationSourceById(db, { organizationId, integrationSourceId });
      return row === undefined ? undefined : toRecord(row);
    },
    createIntegrationSource: async (input) => {
      try {
        const row = await repo.createIntegrationSource(db, {
          organizationId: input.organizationId,
          name: input.name,
          systemType: input.systemType,
          direction: input.direction,
          allowedOperations: input.allowedOperations,
          credentialsOwner: input.credentialsOwner,
          rateLimitNote: input.rateLimitNote,
          termsStatus: input.termsStatus,
          active: input.active,
          actorId: input.actorId,
        });
        return toRecord(row);
      } catch (error) {
        const driver = driverError(error);
        if (
          driver?.code === "23505" &&
          (driver.constraint === undefined ||
            driver.constraint === INTEGRATION_SOURCE_NAME_CONSTRAINT)
        ) {
          throw new DomainError(
            `integration source name "${input.name}" already exists in this organization`,
          );
        }
        throw error;
      }
    },
    updateIntegrationSource: async (input) => {
      const row = await repo.updateIntegrationSource(db, input);
      return row === undefined ? undefined : toRecord(row);
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
  };
}
