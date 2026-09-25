import { DomainError } from "@aquarela/domain";
import {
  createDb,
  organization,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresIntegrationSourceStore } from "./postgres-store";
import type { NewIntegrationSourceRecord } from "./write-types";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

class RollbackSignal extends Error {}

/** Runs `fn` in a transaction and always rolls it back (append-only audits stay clean). */
async function inRollback(
  db: NodeDatabase,
  fn: (tx: DatabaseTransaction) => Promise<void>,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new RollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) {
      throw error;
    }
  }
}

/** The full pg error chain, so a wrapped driver message is still visible. */
function errorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    parts.push(current instanceof Error ? current.message : String(current));
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

function sourceInput(organizationId: string, name: string): NewIntegrationSourceRecord {
  return {
    organizationId,
    name,
    systemType: "other",
    direction: "read",
    allowedOperations: [],
    credentialsOwner: "TECH",
    rateLimitNote: null,
    termsStatus: "pending",
    active: true,
    actorId: randomUUID(),
  };
}

describe.skipIf(!databaseUrl)("integrations store against PostgreSQL", () => {
  let client: DbClient;

  beforeAll(() => {
    client = createDb(databaseUrl!);
  });

  afterAll(async () => {
    await client.close();
  });

  it("maps the duplicate-name unique violation to a DomainError", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = (
        await tx
          .insert(organization)
          .values({ legalName: `intg-dup-${suffix}` })
          .returning()
      )[0]!.id;
      const store = createPostgresIntegrationSourceStore(tx);
      await store.createIntegrationSource(sourceInput(orgId, `DUP-${suffix}`));

      await expect(
        store.createIntegrationSource(sourceInput(orgId, `DUP-${suffix}`)),
      ).rejects.toThrow(DomainError);
    });
  });

  it("scopes the update by id and organization (DEC-061)", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = (
        await tx
          .insert(organization)
          .values({ legalName: `intg-scope-${suffix}` })
          .returning()
      )[0]!.id;
      const otherOrgId = (
        await tx
          .insert(organization)
          .values({ legalName: `intg-scope-b-${suffix}` })
          .returning()
      )[0]!.id;
      const store = createPostgresIntegrationSourceStore(tx);
      const created = await store.createIntegrationSource(sourceInput(orgId, `SCOPE-${suffix}`));

      // A foreign organization sees neither the row nor the update.
      expect(await store.findIntegrationSourceById(otherOrgId, created.id)).toBeUndefined();
      const foreign = await store.updateIntegrationSource({
        ...sourceInput(otherOrgId, `SCOPE-${suffix}`),
        integrationSourceId: created.id,
        name: `CHANGED-${suffix}`,
      });
      expect(foreign).toBeUndefined();

      const updated = await store.updateIntegrationSource({
        organizationId: orgId,
        integrationSourceId: created.id,
        name: `CHANGED-${suffix}`,
        systemType: "other",
        direction: "read",
        allowedOperations: [],
        credentialsOwner: "TECH",
        rateLimitNote: "30 req/min",
        termsStatus: "pending",
        active: false,
        actorId: randomUUID(),
      });
      expect(updated?.name).toBe(`CHANGED-${suffix}`);
      expect(updated?.updatedBy).toBeDefined();
    });
  });

  it("enforces the DEC-015 write-requires-approved-terms check at the database", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = (
        await tx
          .insert(organization)
          .values({ legalName: `intg-dec015-${suffix}` })
          .returning()
      )[0]!.id;
      // A nested transaction (savepoint) so the failed insert does not abort the
      // outer rollback transaction, which the follow-up read still needs.
      let caught: unknown;
      try {
        await tx.transaction(async (inner) => {
          await createPostgresIntegrationSourceStore(inner).createIntegrationSource({
            ...sourceInput(orgId, `WRITE-${suffix}`),
            allowedOperations: ["read", "write_stock"],
            termsStatus: "pending",
          });
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeDefined();
      expect(errorChain(caught)).toContain(
        "integration_source_write_requires_approved_terms_check",
      );

      const remaining = await createPostgresIntegrationSourceStore(tx).listIntegrationSources({
        organizationId: orgId,
        limit: 50,
        offset: 0,
      });
      expect(remaining).toHaveLength(0);
    });
  });
});
