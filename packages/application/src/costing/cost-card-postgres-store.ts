import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type {
  CalculationSnapshotRecord,
  CostCardRecord,
  CostCardStore,
  SnapshotComponentRecord,
} from "./cost-card-types";
import { asJsonObject } from "./json";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/**
 * The relational `query` API is present on both the pool database and a
 * transaction (a transaction extends the base database), so this narrows the
 * union for the id lookups that have no repository function yet.
 */
function relational(db: Database): NodeDatabase {
  return db as NodeDatabase;
}

function toCostCard(row: repo.CostCard): CostCardRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    productVariantId: row.productVariantId,
    locationId: row.locationId,
    channelId: row.channelId,
    recipeVersionId: row.recipeVersionId,
    state: row.state,
    costSelectionPolicy: row.costSelectionPolicy,
    calculatedAt: row.calculatedAt.toISOString(),
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt === null ? null : row.approvedAt.toISOString(),
    snapshotId: row.snapshotId,
  };
}

function toSnapshot(row: repo.CalculationSnapshot): CalculationSnapshotRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    costCardId: row.costCardId,
    priceScenarioId: row.priceScenarioId,
    costSelectionPolicy: row.costSelectionPolicy,
    asOf: row.asOf.toISOString(),
    taxRuleSnapshot: asJsonObject(row.taxRuleSnapshot),
    fxRateId: row.fxRateId,
    roundingMethod: row.roundingMethod,
    roundingScales: asJsonObject(row.roundingScales),
    ruleVersion: row.ruleVersion,
    totals: asJsonObject(row.totals),
    createdAt: row.createdAt.toISOString(),
  };
}

function toComponent(row: repo.SnapshotComponent): SnapshotComponentRecord {
  return {
    id: row.id,
    snapshotId: row.snapshotId,
    componentKind: row.componentKind,
    itemId: row.itemId,
    quantity: row.quantity,
    unitId: row.unitId,
    unitCost: row.unitCost,
    amount: row.amount,
    roundingBoundary: row.roundingBoundary,
    provenance: asJsonObject(row.provenance),
  };
}

/** Adapts the persistence repositories to the `CostCardStore` port. */
export function createPostgresCostCardStore(db: Database): CostCardStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresCostCardStore(db));
      }
      return db.transaction((tx) => fn(createPostgresCostCardStore(tx)));
    },
    findProductVariant: async (productVariantId) => {
      const row = await relational(db).query.productVariant.findFirst({
        where: (table, { eq }) => eq(table.id, productVariantId),
        columns: { id: true, organizationId: true },
      });
      return row === undefined ? undefined : { id: row.id, organizationId: row.organizationId };
    },
    createCostCard: async (input) => toCostCard(await repo.createCostCard(db, input)),
    findCostCard: async (costCardId) => {
      const row = await repo.findCostCard(db, costCardId);
      return row === undefined ? undefined : toCostCard(row);
    },
    listApprovedCostCardsForScope: async (query) =>
      (await repo.listApprovedCostCardsForScope(db, query)).map(toCostCard),
    updateCostCard: async (costCardId, patch) =>
      toCostCard(await repo.updateCostCard(db, costCardId, patch)),
    createCalculationSnapshot: async (input) =>
      toSnapshot(await repo.createCalculationSnapshot(db, input)),
    createSnapshotComponents: async (inputs) =>
      (await repo.createSnapshotComponents(db, inputs)).map(toComponent),
    listSnapshotComponents: async (snapshotId) =>
      (await repo.listSnapshotComponents(db, snapshotId)).map(toComponent),
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
  };
}
