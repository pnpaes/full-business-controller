import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import { asJsonObject } from "./json";
import type {
  PriceScenarioRecord,
  PriceScenarioStore,
  PriceVersionRecord,
} from "./price-scenario-types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/**
 * The relational `query` API is present on both the pool database and a
 * transaction (a transaction extends the base database), so this narrows the
 * union for the product-variant lookup that has no repository function.
 */
function relational(db: Database): NodeDatabase {
  return db as NodeDatabase;
}

function toPriceScenario(row: repo.PriceScenario): PriceScenarioRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    productVariantId: row.productVariantId,
    locationId: row.locationId,
    channelId: row.channelId,
    grossPrice: row.grossPrice,
    netPrice: row.netPrice,
    targetContributionPct: row.targetContributionPct,
    volumeAssumption: row.volumeAssumption,
    feeBreakdown: asJsonObject(row.feeBreakdown),
    outcome: asJsonObject(row.outcome),
    state: row.state,
    createdAt: row.createdAt.toISOString(),
  };
}

function toPriceVersion(row: repo.PriceVersion): PriceVersionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    productVariantId: row.productVariantId,
    locationId: row.locationId,
    channelId: row.channelId,
    grossPrice: row.grossPrice,
    netPrice: row.netPrice,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo === null ? null : row.effectiveTo.toISOString(),
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt.toISOString(),
    sourceScenarioId: row.sourceScenarioId,
  };
}

/** Adapts the persistence repositories to the `PriceScenarioStore` port. */
export function createPostgresPriceScenarioStore(db: Database): PriceScenarioStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresPriceScenarioStore(db));
      }
      return db.transaction((tx) => fn(createPostgresPriceScenarioStore(tx)));
    },
    findProductVariant: async (productVariantId) => {
      const row = await relational(db).query.productVariant.findFirst({
        where: (table, { eq }) => eq(table.id, productVariantId),
      });
      return row === undefined ? undefined : { id: row.id, organizationId: row.organizationId };
    },
    findLocation: async (locationId) => {
      const row = await relational(db).query.location.findFirst({
        where: (table, { eq }) => eq(table.id, locationId),
        columns: { id: true, organizationId: true },
      });
      return row === undefined ? undefined : { id: row.id, organizationId: row.organizationId };
    },
    findChannel: async (channelId) => {
      const row = await relational(db).query.channel.findFirst({
        where: (table, { eq }) => eq(table.id, channelId),
        columns: { id: true, organizationId: true },
      });
      return row === undefined ? undefined : { id: row.id, organizationId: row.organizationId };
    },
    createPriceScenario: async (input) =>
      toPriceScenario(await repo.createPriceScenario(db, input)),
    findPriceScenario: async (priceScenarioId) => {
      const row = await repo.findPriceScenario(db, priceScenarioId);
      return row === undefined ? undefined : toPriceScenario(row);
    },
    updatePriceScenario: async (priceScenarioId, patch) =>
      toPriceScenario(await repo.updatePriceScenario(db, priceScenarioId, patch)),
    markPriceScenarioApproved: async (query) => {
      const row = await repo.approvePriceScenarioIfApprovable(db, query);
      return row === undefined ? undefined : toPriceScenario(row);
    },
    createCalculationSnapshot: async (input) => {
      const row = await repo.createCalculationSnapshot(db, input);
      return { id: row.id };
    },
    createPriceVersion: async (input) =>
      toPriceVersion(
        await repo.createPriceVersion(db, {
          organizationId: input.organizationId,
          productVariantId: input.productVariantId,
          locationId: input.locationId,
          channelId: input.channelId,
          grossPrice: input.grossPrice,
          netPrice: input.netPrice,
          effectiveFrom: new Date(input.effectiveFrom),
          effectiveTo: input.effectiveTo === null ? null : new Date(input.effectiveTo),
          approvedBy: input.approvedBy,
          approvedAt: new Date(input.approvedAt),
          sourceScenarioId: input.sourceScenarioId,
        }),
      ),
    findPriceVersion: async (query) => {
      const row = await repo.findPriceVersion(db, query);
      return row === undefined ? undefined : toPriceVersion(row);
    },
    listPriceVersions: async (query) =>
      (await repo.listPriceVersions(db, query)).map(toPriceVersion),
    listPriceVersionsForScope: async (query) =>
      (await repo.listPriceVersionsForScope(db, query)).map(toPriceVersion),
    findEffectivePriceVersion: async (query) => {
      const row = await repo.findEffectivePriceVersion(db, query);
      return row === undefined ? undefined : toPriceVersion(row);
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
  };
}
