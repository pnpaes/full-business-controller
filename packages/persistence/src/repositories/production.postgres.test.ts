import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import {
  item,
  location,
  organization,
  productionBatch,
  productionBatchInput,
  productionBatchOutput,
  recipe,
  recipeVersion,
  storageArea,
  unit,
  wasteEvent,
} from "../schema";
import {
  createProductionBatch,
  createProductionBatchOutput,
  createProductionPlan,
  findProductionBatch,
  findProductionPlan,
  listProductionBatchInputs,
  listProductionBatchOutputs,
  listProductionBatches,
  listProductionPlans,
  updateProductionBatch,
} from "./production";
import {
  createTestItem,
  createTestLocation,
  createTestOrganization,
  createTestProductionBatch,
  createTestProductionBatchInput,
  createTestProductionBatchOutput,
  createTestProductionPlan,
  createTestRecipe,
  createTestRecipeVersion,
  createTestStockMovement,
  createTestStorageArea,
  createTestUnit,
  createTestWasteEvent,
  inRollback,
  rejectionCause,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

const at = (iso: string): Date => new Date(iso);

describe.skipIf(!databaseUrl)("production repository", () => {
  let client: DbClient;
  let orgId: string;
  let locationId: string;
  let unitId: string;
  let itemId: string;
  let storageAreaId: string;
  let recipeVersionId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
    const loc = await createTestLocation(client.db, orgId);
    locationId = loc.id;
    const baseUnit = await createTestUnit(client.db, orgId);
    unitId = baseUnit.id;
    const testItem = await createTestItem(client.db, orgId, baseUnit.id);
    itemId = testItem.id;
    const area = await createTestStorageArea(client.db, orgId, locationId);
    storageAreaId = area.id;
    const testRecipe = await createTestRecipe(client.db, orgId);
    const version = await createTestRecipeVersion(client.db, testRecipe.id);
    recipeVersionId = version.id;
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(recipeVersion).where(eq(recipeVersion.id, recipeVersionId));
      await client.db.delete(recipe).where(and(eq(recipe.organizationId, orgId)));
      await client.db.delete(item).where(eq(item.id, itemId));
      await client.db.delete(unit).where(eq(unit.id, unitId));
      await client.db.delete(storageArea).where(eq(storageArea.id, storageAreaId));
      await client.db.delete(location).where(eq(location.id, locationId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates a plan and finds/lists it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createProductionPlan(tx, {
        organizationId: orgId,
        locationId,
        productionDate: "2026-03-01",
      });
      expect(created.status).toBe("planned");

      expect(
        (await findProductionPlan(tx, { organizationId: orgId, productionPlanId: created.id }))?.id,
      ).toBe(created.id);

      const january = await createTestProductionPlan(tx, orgId, locationId, {
        productionDate: "2026-01-01",
      });
      const february = await createTestProductionPlan(tx, orgId, locationId, {
        productionDate: "2026-02-01",
        status: "released",
      });

      const all = await listProductionPlans(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([created.id, february.id, january.id]);

      const released = await listProductionPlans(tx, { organizationId: orgId, status: "released" });
      expect(released.map((row) => row.id)).toEqual([february.id]);

      const paged = await listProductionPlans(tx, {
        organizationId: orgId,
        locationId,
        limit: 1,
        offset: 1,
      });
      expect(paged.map((row) => row.id)).toEqual([february.id]);

      // A plan in another organization is invisible at this scope.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocation = await createTestLocation(tx, otherOrgId);
      const other = await createTestProductionPlan(tx, otherOrgId, otherLocation.id);
      expect(
        await findProductionPlan(tx, { organizationId: orgId, productionPlanId: other.id }),
      ).toBeUndefined();
    });
  });

  it("creates a batch, finds it and lists it with filters", async () => {
    await inRollback(client.db, async (tx) => {
      const plan = await createTestProductionPlan(tx, orgId, locationId);
      const created = await createProductionBatch(tx, {
        organizationId: orgId,
        locationId,
        recipeVersionId,
        planId: plan.id,
        workstation: "hot-line",
      });
      expect(created.status).toBe("planned");

      expect(
        (await findProductionBatch(tx, { organizationId: orgId, productionBatchId: created.id }))
          ?.id,
      ).toBe(created.id);

      const elsewhere = await createTestProductionBatch(
        tx,
        orgId,
        { locationId, recipeVersionId },
        { status: "in_progress", workstation: "bakery" },
      );

      const byStatus = await listProductionBatches(tx, {
        organizationId: orgId,
        status: "in_progress",
      });
      expect(byStatus.map((row) => row.id)).toEqual([elsewhere.id]);

      const byPlan = await listProductionBatches(tx, { organizationId: orgId, planId: plan.id });
      expect(byPlan.map((row) => row.id)).toEqual([created.id]);

      const byWorkstation = await listProductionBatches(tx, {
        organizationId: orgId,
        workstation: "bakery",
      });
      expect(byWorkstation.map((row) => row.id)).toEqual([elsewhere.id]);

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocation = await createTestLocation(tx, otherOrgId);
      const otherOrgBatch = await createTestProductionBatch(tx, otherOrgId, {
        locationId: otherLocation.id,
        recipeVersionId,
      });
      expect(
        await findProductionBatch(tx, {
          organizationId: orgId,
          productionBatchId: otherOrgBatch.id,
        }),
      ).toBeUndefined();
    });
  });

  it("updates a batch additively (status, timestamps, actuals)", async () => {
    await inRollback(client.db, async (tx) => {
      const batch = await createTestProductionBatch(tx, orgId, { locationId, recipeVersionId });

      const running = await updateProductionBatch(tx, batch.id, {
        status: "in_progress",
        actualStart: at("2026-03-01T08:00:00.000Z"),
      });
      expect(running?.status).toBe("in_progress");
      expect(running?.actualStart).toEqual(at("2026-03-01T08:00:00.000Z"));

      const completed = await updateProductionBatch(tx, batch.id, {
        status: "completed",
        actualFinish: at("2026-03-01T09:00:00.000Z"),
        actualOutputQty: "9.5",
        yieldVariancePct: "-0.05",
        operatorId: "00000000-0000-0000-0000-0000000000b0",
        destinationStorageAreaId: storageAreaId,
      });
      expect(completed?.status).toBe("completed");
      expect(completed?.actualOutputQty).toBe("9.500000");
      expect(completed?.yieldVariancePct).toBe("-0.050000");
      expect(completed?.destinationStorageAreaId).toBe(storageAreaId);
      // The patch is additive: the earlier actual_start is preserved.
      expect(completed?.actualStart).toEqual(at("2026-03-01T08:00:00.000Z"));

      expect(
        await updateProductionBatch(tx, "00000000-0000-0000-0000-000000000000", {
          status: "released",
        }),
      ).toBeUndefined();
    });
  });

  it("rejects an out-of-vocabulary batch status", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createProductionBatch(tx, {
          organizationId: orgId,
          locationId,
          recipeVersionId,
          status: "finished",
        }),
      );
      expect(cause.message).toMatch(/production_batch_status_check/);
    });
  });

  it("rejects an actual finish before the actual start", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createProductionBatch(tx, {
          organizationId: orgId,
          locationId,
          recipeVersionId,
          actualStart: at("2026-03-01T09:00:00.000Z"),
          actualFinish: at("2026-03-01T08:00:00.000Z"),
        }),
      );
      expect(cause.message).toMatch(/production_batch_actual_range_check/);
    });
  });

  it("rejects an out-of-vocabulary output kind", async () => {
    await inRollback(client.db, async (tx) => {
      const batch = await createTestProductionBatch(tx, orgId, { locationId, recipeVersionId });
      const cause = await rejectionCause(
        createProductionBatchOutput(tx, {
          productionBatchId: batch.id,
          itemId,
          unitId,
          kind: "saleable",
          plannedQty: "1",
        }),
      );
      expect(cause.message).toMatch(/production_batch_output_kind_check/);
    });
  });

  it("cascades batch-line deletes from the parent batch", async () => {
    await inRollback(client.db, async (tx) => {
      const batch = await createTestProductionBatch(tx, orgId, { locationId, recipeVersionId });
      await createTestProductionBatchInput(tx, batch.id, { itemId, unitId });
      await createTestProductionBatchOutput(tx, batch.id, { itemId, unitId });

      await tx.delete(productionBatch).where(eq(productionBatch.id, batch.id));

      const inputs = await tx
        .select()
        .from(productionBatchInput)
        .where(eq(productionBatchInput.productionBatchId, batch.id));
      const outputs = await tx
        .select()
        .from(productionBatchOutput)
        .where(eq(productionBatchOutput.productionBatchId, batch.id));
      expect(inputs).toHaveLength(0);
      expect(outputs).toHaveLength(0);
    });
  });

  it("lists batch inputs and outputs organization-scoped through the parent", async () => {
    await inRollback(client.db, async (tx) => {
      const batch = await createTestProductionBatch(tx, orgId, { locationId, recipeVersionId });
      await createTestProductionBatchInput(tx, batch.id, { itemId, unitId }, { plannedQty: "5" });
      await createTestProductionBatchOutput(tx, batch.id, { itemId, unitId }, { kind: "finished" });
      // A second batch of another org must not leak through the org-scoped reads.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocation = await createTestLocation(tx, otherOrgId);
      const otherBatch = await createTestProductionBatch(tx, otherOrgId, {
        locationId: otherLocation.id,
        recipeVersionId,
      });
      await createTestProductionBatchInput(tx, otherBatch.id, { itemId, unitId });

      const inputs = await listProductionBatchInputs(tx, {
        organizationId: orgId,
        productionBatchId: batch.id,
      });
      const outputs = await listProductionBatchOutputs(tx, {
        organizationId: orgId,
        productionBatchId: batch.id,
      });
      expect(inputs).toHaveLength(1);
      expect(outputs).toHaveLength(1);

      // Reading the other org's batch under this org resolves to nothing.
      expect(
        await listProductionBatchInputs(tx, {
          organizationId: orgId,
          productionBatchId: otherBatch.id,
        }),
      ).toHaveLength(0);
    });
  });

  it("validates a production_batch source and rejects an orphan source_id", async () => {
    await inRollback(client.db, async (tx) => {
      const batch = await createTestProductionBatch(tx, orgId, { locationId, recipeVersionId });

      const posted = await createTestStockMovement(
        tx,
        orgId,
        { itemId, locationId, storageAreaId, unitId },
        {
          movementType: "production_consumption",
          sourceType: "production_batch",
          sourceId: batch.id,
        },
      );
      expect(posted.sourceId).toBe(batch.id);

      const cause = await rejectionCause(
        createTestStockMovement(
          tx,
          orgId,
          { itemId, locationId, storageAreaId, unitId },
          {
            movementType: "production_output",
            sourceType: "production_batch",
            sourceId: "00000000-0000-0000-0000-000000000000",
          },
        ),
      );
      expect(cause.message).toMatch(/stock_movement\.source_id/);
    });
  });

  it("rejects a production_batch source from another organization", async () => {
    await inRollback(client.db, async (tx) => {
      const batch = await createTestProductionBatch(tx, orgId, { locationId, recipeVersionId });
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());

      // Same id, different organization: rejected by the same-org guard.
      const cause = await rejectionCause(
        createTestStockMovement(
          tx,
          otherOrgId,
          { itemId, locationId, storageAreaId, unitId },
          {
            movementType: "production_consumption",
            sourceType: "production_batch",
            sourceId: batch.id,
          },
        ),
      );
      expect(cause.message).toMatch(/stock_movement\.source_id/);
    });
  });

  it("enforces the deferred waste_event.production_batch_id FK", async () => {
    await inRollback(client.db, async (tx) => {
      const batch = await createTestProductionBatch(tx, orgId, { locationId, recipeVersionId });

      const linked = await createTestWasteEvent(
        tx,
        orgId,
        { locationId, storageAreaId, itemId, unitId },
        { productionBatchId: batch.id },
      );
      expect(linked.productionBatchId).toBe(batch.id);

      const cause = await rejectionCause(
        createTestWasteEvent(
          tx,
          orgId,
          { locationId, storageAreaId, itemId, unitId },
          { productionBatchId: "00000000-0000-0000-0000-000000000000" },
        ),
      );
      expect(cause.message).toMatch(/waste_event_production_batch_id_production_batch_id_fk/);
    });
  });

  it("exposes the production tables", () => {
    expect(productionBatchInput).toBeDefined();
    expect(productionBatchOutput).toBeDefined();
    expect(wasteEvent).toBeDefined();
  });
});
