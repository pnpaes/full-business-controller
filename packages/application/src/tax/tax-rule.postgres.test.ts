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

import type { NewTaxRuleRecord } from "./write-types";
import { createPostgresTaxStore } from "./postgres-store";

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

function ruleInput(organizationId: string, code: string): NewTaxRuleRecord {
  return {
    organizationId,
    code,
    name: code,
    ratePct: "0.150000",
    taxTreatment: "channel_overridable",
    taxBasis: "inclusive",
    recoverable: false,
    appliesTo: "product",
    scopeType: "company_wide",
    locationId: null,
    channelId: null,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
  };
}

describe.skipIf(!databaseUrl)("tax store against PostgreSQL", () => {
  let client: DbClient;

  beforeAll(() => {
    client = createDb(databaseUrl!);
  });

  afterAll(async () => {
    await client.close();
  });

  it("maps the duplicate-code unique violation to a DomainError (m6)", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = (
        await tx
          .insert(organization)
          .values({ legalName: `tax-dup-${suffix}` })
          .returning()
      )[0]!.id;
      const store = createPostgresTaxStore(tx);
      await store.createTaxRule(ruleInput(orgId, `DUP-${suffix}`));

      await expect(store.createTaxRule(ruleInput(orgId, `DUP-${suffix}`))).rejects.toThrow(
        DomainError,
      );
    });
  });

  it("returns undefined for a second end of an already ended rule (M2)", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = (
        await tx
          .insert(organization)
          .values({ legalName: `tax-end-${suffix}` })
          .returning()
      )[0]!.id;
      const store = createPostgresTaxStore(tx);
      const created = await store.createTaxRule(ruleInput(orgId, `END-${suffix}`));

      const first = await store.endTaxRule(orgId, created.id, new Date("2026-06-01T00:00:00.000Z"));
      expect(first?.effectiveTo?.toISOString()).toBe("2026-06-01T00:00:00.000Z");

      // The conditional write matches zero rows, so the first end is intact.
      const second = await store.endTaxRule(
        orgId,
        created.id,
        new Date("2026-07-01T00:00:00.000Z"),
      );
      expect(second).toBeUndefined();
      const reread = await store.findTaxRuleById(created.id);
      expect(reread?.effectiveTo?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    });
  });
});
