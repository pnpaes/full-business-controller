import {
  createDb,
  externalMapping,
  item,
  product,
  productVariant,
  unit,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createImportRun } from "./create-import-run";
import { disposeStagingRow } from "./dispose-staging-row";
import { getImportRun } from "./get-import-run";
import { mapImportRows } from "./map-import-rows";
import { createPostgresImportStore } from "./postgres-store";
import { previewImportRun } from "./preview-import-run";
import { stageImportRows } from "./stage-import-rows";
import { validateImportRun } from "./validate-import-run";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const PERIOD_START = "2026-01-01";
const PERIOD_END = "2026-02-01";

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

async function seedItem(tx: DatabaseTransaction, orgId: string, sku: string): Promise<string> {
  const base = await tx
    .insert(unit)
    .values({ organizationId: orgId, code: `u_${suffix}`, dimension: "count", isBase: true })
    .returning();
  const stocked = await tx
    .insert(item)
    .values({
      organizationId: orgId,
      code: `item_${suffix}`,
      sku,
      name: "Import IT item",
      itemType: "finished_good",
      baseUnitId: base[0]!.id,
    })
    .returning();
  return stocked[0]!.id;
}

async function seedProductVariant(
  tx: DatabaseTransaction,
  orgId: string,
  sku: string,
): Promise<string> {
  const created = await tx
    .insert(product)
    .values({ organizationId: orgId, code: `prod_${suffix}`, name: "Import variant product" })
    .returning();
  const variant = await tx
    .insert(productVariant)
    .values({
      organizationId: orgId,
      productId: created[0]!.id,
      code: `variant_${suffix}`,
      sku,
      name: "Import variant",
    })
    .returning();
  return variant[0]!.id;
}

describe.skipIf(!databaseUrl)("imports against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Imports IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      // Every integration test rolls back, so only the org persists.
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("runs upload → parse → validate → map → preview through the real adapter", async () => {
    await inRollback(client.db, async (tx) => {
      const sku = `IMP_SKU_${suffix}`;
      const itemId = await seedItem(tx, orgId, sku);
      const store = createPostgresImportStore(tx);
      const actorId = randomUUID();

      const run = await createImportRun(store, {
        organizationId: orgId,
        actorId,
        source: "frontline-export",
        profileVersion: "profile-v1",
        fileHash: `hash-${suffix}`,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      });
      expect(run.status).toBe("uploaded");

      await stageImportRows(store, {
        organizationId: orgId,
        actorId,
        importRunId: run.importRunId,
        rows: [
          {
            sourceRowNo: 1,
            raw: { sku },
            normalized: { sku, currency: "NOK", gross_amount: "10.0000" },
          },
          {
            sourceRowNo: 2,
            raw: { sku: "UNKNOWN" },
            normalized: { sku: "UNKNOWN", currency: "NOK", gross_amount: "5.0000" },
          },
        ],
      });

      const validated = await validateImportRun(store, {
        organizationId: orgId,
        actorId,
        importRunId: run.importRunId,
        rules: { expectedCurrency: "NOK", requireAmounts: true },
      });
      expect(validated).toMatchObject({ status: "validated", errorCount: 0 });

      const mapped = await mapImportRows(store, {
        organizationId: orgId,
        actorId,
        importRunId: run.importRunId,
        sourceSystem: "frontline",
        entityType: "item",
      });
      expect(mapped).toMatchObject({ mappedCount: 1, unmappedCount: 1, status: "needs_review" });

      const detail = await getImportRun(store, {
        organizationId: orgId,
        importRunId: run.importRunId,
      });
      expect(detail?.rows[0]?.normalized).toMatchObject({ mapped_internal_entity_id: itemId });

      const unmappedRowId = detail!.rows[1]!.id;
      await disposeStagingRow(store, {
        organizationId: orgId,
        actorId,
        importRunId: run.importRunId,
        stagingRowId: unmappedRowId,
        disposition: "unmapped",
        reason: "not a sellable product",
      });

      const preview = await previewImportRun(store, {
        organizationId: orgId,
        importRunId: run.importRunId,
      });
      expect(preview).toMatchObject({ mappedCount: 1, unmappedCount: 1, canClose: true });
      expect(preview.sourceTotals).toEqual({ NOK: "15.0000" });
      expect(preview.residualTotals).toEqual({ NOK: "10.0000" });
    });
  });

  it("resolves a run from the source's import_profile and applies its rules", async () => {
    await inRollback(client.db, async (tx) => {
      const source = `profiled-${suffix}`;
      const store = createPostgresImportStore(tx);
      const actorId = randomUUID();
      const profile = await store.createImportProfile({
        organizationId: orgId,
        source,
        profileVersion: "v7",
        postingPolicy: "all_or_nothing",
        validationRules: { expectedCurrency: "NOK", requireCurrency: true },
        createdBy: actorId,
      });

      const run = await createImportRun(store, {
        organizationId: orgId,
        actorId,
        source,
        fileHash: `hash-profiled-${suffix}`,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      });

      const detail = await getImportRun(store, {
        organizationId: orgId,
        importRunId: run.importRunId,
      });
      expect(detail?.run.importProfileId).toBe(profile.id);
      expect(detail?.run.profileVersion).toBe("v7");
      expect(detail?.run.diagnostics).toMatchObject({ posting_policy: "all_or_nothing" });

      await stageImportRows(store, {
        organizationId: orgId,
        actorId,
        importRunId: run.importRunId,
        rows: [
          {
            sourceRowNo: 1,
            raw: {},
            normalized: { sku: `IMP_PROFILED_SKU_${suffix}` },
          },
        ],
      });

      const validated = await validateImportRun(store, {
        organizationId: orgId,
        actorId,
        importRunId: run.importRunId,
      });
      expect(validated.status).toBe("needs_review");
      expect(validated.issues.map((issue) => issue.code)).toContain("missing_currency");
    });
  });

  it("stores a padded-source profile trimmed and finds it by the trimmed source", async () => {
    await inRollback(client.db, async (tx) => {
      const source = `padded-${suffix}`;
      const store = createPostgresImportStore(tx);

      const profile = await store.createImportProfile({
        organizationId: orgId,
        source: `  ${source}  `,
        profileVersion: "  v3  ",
        postingPolicy: "allow_partial",
        validationRules: {},
        createdBy: randomUUID(),
      });
      expect(profile.source).toBe(source);
      expect(profile.profileVersion).toBe("v3");

      const found = await store.findImportProfile({ organizationId: orgId, source });
      expect(found?.id).toBe(profile.id);
    });
  });

  it("maps a sales row to a product variant by SKU and writes product_variant_id (DEC-113)", async () => {
    await inRollback(client.db, async (tx) => {
      const sku = `IMP_VAR_SKU_${suffix}`;
      const variantId = await seedProductVariant(tx, orgId, sku);
      const store = createPostgresImportStore(tx);
      const actorId = randomUUID();

      const run = await createImportRun(store, {
        organizationId: orgId,
        actorId,
        source: "frontline-export",
        profileVersion: "profile-v1",
        fileHash: `hash-variant-${suffix}`,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      });

      await stageImportRows(store, {
        organizationId: orgId,
        actorId,
        importRunId: run.importRunId,
        rows: [
          {
            sourceRowNo: 1,
            raw: { sku },
            normalized: {
              sku,
              occurred_at: "2026-01-15T10:00:00.000Z",
              currency: "NOK",
              gross_amount: "12.0000",
            },
          },
        ],
      });

      await validateImportRun(store, {
        organizationId: orgId,
        actorId,
        importRunId: run.importRunId,
        rules: { expectedCurrency: "NOK" },
      });

      const mapped = await mapImportRows(store, {
        organizationId: orgId,
        actorId,
        importRunId: run.importRunId,
        internalEntityType: "product_variant",
      });
      expect(mapped).toMatchObject({ mappedCount: 1, unmappedCount: 0, status: "validated" });

      const detail = await getImportRun(store, {
        organizationId: orgId,
        importRunId: run.importRunId,
      });
      expect(detail?.rows[0]?.normalized).toMatchObject({
        mapped_internal_entity_id: variantId,
        product_variant_id: variantId,
      });
    });
  });

  it("resolves a variant through an effective external mapping inside the occurred_at window (DEC-113)", async () => {
    await inRollback(client.db, async (tx) => {
      const sku = `IMP_WIN_SKU_${suffix}`;
      const variantId = await seedProductVariant(tx, orgId, sku);
      const store = createPostgresImportStore(tx);
      const actorId = randomUUID();
      const occurredAt = "2026-01-15T10:00:00.000Z";

      await tx.insert(externalMapping).values([
        {
          organizationId: orgId,
          sourceSystem: "frontline",
          entityType: "product",
          externalId: `ext-var-in-${suffix}`,
          sku: null,
          internalEntityType: "product_variant",
          internalEntityId: variantId,
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          effectiveTo: null,
        },
        {
          organizationId: orgId,
          sourceSystem: "frontline",
          entityType: "product",
          externalId: `ext-var-out-${suffix}`,
          sku: null,
          internalEntityType: "product_variant",
          internalEntityId: variantId,
          effectiveFrom: new Date("2026-03-01T00:00:00.000Z"),
          effectiveTo: null,
        },
      ]);

      const run = await createImportRun(store, {
        organizationId: orgId,
        actorId,
        source: "frontline-export",
        profileVersion: "profile-v1",
        fileHash: `hash-variant-window-${suffix}`,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      });

      await stageImportRows(store, {
        organizationId: orgId,
        actorId,
        importRunId: run.importRunId,
        rows: [
          {
            sourceRowNo: 1,
            raw: {},
            normalized: {
              external_id: `ext-var-in-${suffix}`,
              occurred_at: occurredAt,
              currency: "NOK",
              gross_amount: "8.0000",
            },
          },
          {
            sourceRowNo: 2,
            raw: {},
            normalized: {
              external_id: `ext-var-out-${suffix}`,
              occurred_at: occurredAt,
              currency: "NOK",
              gross_amount: "3.0000",
            },
          },
        ],
      });

      await validateImportRun(store, {
        organizationId: orgId,
        actorId,
        importRunId: run.importRunId,
        rules: { expectedCurrency: "NOK" },
      });

      const mapped = await mapImportRows(store, {
        organizationId: orgId,
        actorId,
        importRunId: run.importRunId,
        internalEntityType: "product_variant",
      });
      expect(mapped).toMatchObject({ mappedCount: 1, unmappedCount: 1, status: "needs_review" });

      const detail = await getImportRun(store, {
        organizationId: orgId,
        importRunId: run.importRunId,
      });
      expect(detail?.rows[0]?.mappingState).toBe("mapped");
      expect(detail?.rows[0]?.normalized).toMatchObject({
        mapped_internal_entity_id: variantId,
        product_variant_id: variantId,
      });
      expect(detail?.rows[1]?.mappingState).toBe("unmapped");
      expect(detail?.rows[1]?.normalized).not.toHaveProperty("product_variant_id");
    });
  });
});
