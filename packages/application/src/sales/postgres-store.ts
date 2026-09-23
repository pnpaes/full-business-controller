import { QUANTITY_SCALE, divideRoundHalfUp, formatDecimal, parseDecimal } from "@aquarela/domain";
import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import { createPostgresImportStore } from "../imports";
import { createPostgresInventoryStore, reverseStockMovement } from "../inventory";
import { createPostgresProductionStore, resolvePlannedSnapshot } from "../production";
import { createPostgresPeriodCloseStore } from "../close";
import { createPostgresReconciliationStore } from "../reconciliation";

import type {
  ConsumptionStore,
  CorrectSalesLineStore,
  NewSalesLineRecord,
  NewSalesTransactionRecord,
  SalesLineRecord,
  SalesStore,
  SalesTransactionRecord,
  VariantRecipeRecord,
} from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/** Rounding unit of the `numeric(9,6)`/`numeric(19,6)` scale. */
const RATE_ONE = 1_000_000n;

function toSalesTransaction(row: repo.SalesTransaction): SalesTransactionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    locationId: row.locationId,
    channelId: row.channelId,
    sourceSystem: row.sourceSystem,
    externalTransactionId: row.externalTransactionId,
    occurredAt: row.occurredAt.toISOString(),
    grossAmount: row.grossAmount,
    netAmount: row.netAmount,
    taxAmount: row.taxAmount,
    discountAmount: row.discountAmount,
    refundAmount: row.refundAmount,
    currency: row.currency,
    importRunId: row.importRunId,
  };
}

function toSalesLine(row: repo.SalesLine): SalesLineRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    salesTransactionId: row.salesTransactionId,
    productVariantId: row.productVariantId,
    externalProductRef: row.externalProductRef,
    sku: row.sku,
    externalLineId: row.externalLineId,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    grossAmount: row.grossAmount,
    netAmount: row.netAmount,
    taxAmount: row.taxAmount,
    appliedTaxRate: row.appliedTaxRate,
    discountAmount: row.discountAmount,
    refundAmount: row.refundAmount,
    channelId: row.channelId,
    taxRuleId: row.taxRuleId,
    parentLineId: row.parentLineId,
    optionKind: row.optionKind,
    channelFeeBasis: row.channelFeeBasis,
    mappingState: row.mappingState,
    reversalOfId: row.reversalOfId,
  };
}

function newTransactionValues(input: NewSalesTransactionRecord): repo.NewSalesTransaction {
  return {
    organizationId: input.organizationId,
    locationId: input.locationId,
    channelId: input.channelId,
    sourceSystem: input.sourceSystem,
    externalTransactionId: input.externalTransactionId,
    occurredAt: new Date(input.occurredAt),
    grossAmount: input.grossAmount,
    netAmount: input.netAmount,
    taxAmount: input.taxAmount,
    discountAmount: input.discountAmount,
    refundAmount: input.refundAmount,
    currency: input.currency,
    importRunId: input.importRunId,
  };
}

function newLineValues(input: NewSalesLineRecord): repo.NewSalesLine {
  return {
    organizationId: input.organizationId,
    salesTransactionId: input.salesTransactionId,
    productVariantId: input.productVariantId,
    externalProductRef: input.externalProductRef,
    sku: input.sku,
    externalLineId: input.externalLineId,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    grossAmount: input.grossAmount,
    netAmount: input.netAmount,
    taxAmount: input.taxAmount,
    appliedTaxRate: input.appliedTaxRate,
    discountAmount: input.discountAmount,
    refundAmount: input.refundAmount,
    channelId: input.channelId,
    taxRuleId: input.taxRuleId,
    parentLineId: input.parentLineId,
    optionKind: input.optionKind,
    channelFeeBasis: input.channelFeeBasis,
    mappingState: input.mappingState,
    reversalOfId: input.reversalOfId,
  };
}

/**
 * Adapts the persistence row-12 sales repositories to the `SalesStore` port. The
 * row-11 import adapter is composed in, so `postImportRun` reuses its reads and
 * writes; only the sales writes/reads are added.
 *
 * Repository gap bridged here (recorded, not resolved — this slice must not edit
 * persistence): there is no lookup by `(source_system, external_transaction_id)`,
 * so the replay match runs over the organization/source-system rows.
 */
export function createPostgresSalesStore(db: Database): SalesStore {
  const imports = createPostgresImportStore(db);
  return {
    ...imports,
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresSalesStore(db));
      }
      return db.transaction((tx) => fn(createPostgresSalesStore(tx)));
    },
    findSalesTransactionByExternalKey: async (query) => {
      const rows = await repo.listSalesTransactions(db, {
        organizationId: query.organizationId,
        sourceSystem: query.sourceSystem,
      });
      const match = rows.find((row) => row.externalTransactionId === query.externalTransactionId);
      return match === undefined ? undefined : toSalesTransaction(match);
    },
    findSalesTransaction: async (query) => {
      const row = await repo.findSalesTransaction(db, query);
      return row === undefined ? undefined : toSalesTransaction(row);
    },
    listSalesTransactions: async (query) =>
      (
        await repo.listSalesTransactions(db, {
          organizationId: query.organizationId,
          ...(query.sourceSystem === undefined ? {} : { sourceSystem: query.sourceSystem }),
          ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.offset === undefined ? {} : { offset: query.offset }),
        })
      ).map(toSalesTransaction),
    createSalesTransaction: async (input) =>
      toSalesTransaction(await repo.createSalesTransaction(db, newTransactionValues(input))),
    listSalesLines: async (query) =>
      (
        await repo.listSalesLines(db, {
          organizationId: query.organizationId,
          salesTransactionId: query.salesTransactionId,
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.offset === undefined ? {} : { offset: query.offset }),
        })
      ).map(toSalesLine),
    createSalesLine: async (input) =>
      toSalesLine(await repo.createSalesLine(db, newLineValues(input))),
    findSalesLine: async (query) => {
      const row = await repo.findSalesLine(db, query);
      return row === undefined ? undefined : toSalesLine(row);
    },
    findSalesLineReversal: async (query) => {
      const row = await repo.findSalesLineReversal(db, query);
      return row === undefined ? undefined : toSalesLine(row);
    },
  };
}

/**
 * Adapts the persistence row-12 sales reads plus the slice-8 inventory ledger to
 * the `ConsumptionStore` port. The inventory adapter is composed in, so
 * `postTheoreticalConsumption` reuses one ledger writer; only the daily sales
 * read and the variant→recipe resolution are added.
 *
 * Repository gaps bridged here (recorded, not resolved — this slice must not
 * edit persistence):
 * - there is no `sales_line` read by day/location, so the daily read lists the
 *   location's transactions and filters on the `occurred_at` date part;
 * - there is no repository accessor for `product_recipe_assignment`, so the
 *   effective assignment is read through the composed relational-query client
 *   (the waste slice's precedent) — no table or relationship is invented.
 */
export function createPostgresConsumptionStore(db: Database): ConsumptionStore {
  const inventory = createPostgresInventoryStore(db);
  const production = createPostgresProductionStore(db);
  return {
    ...inventory,
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresConsumptionStore(db));
      }
      return db.transaction((tx) => fn(createPostgresConsumptionStore(tx)));
    },
    listSalesLinesForDay: async (query) => {
      const transactions = await repo.listSalesTransactions(db, {
        organizationId: query.organizationId,
        locationId: query.locationId,
      });
      const result: Array<{
        id: string;
        organizationId: string;
        salesTransactionId: string;
        locationId: string | null;
        productVariantId: string | null;
        quantity: string;
        occurredAt: string;
      }> = [];
      for (const transaction of transactions) {
        if (transaction.occurredAt.toISOString().slice(0, 10) !== query.date) {
          continue;
        }
        const lines = await repo.listSalesLines(db, {
          organizationId: query.organizationId,
          salesTransactionId: transaction.id,
        });
        for (const line of lines) {
          let productVariantId = line.productVariantId;
          if (productVariantId === null && line.sku !== null) {
            // Row-11 mapping resolves `item` SKUs only (recorded open point), so
            // a sales line can carry a SKU without a variant id. Bridge it here
            // by the organization's variant SKU.
            const variant = await db.query.productVariant.findFirst({
              columns: { id: true, organizationId: true },
              where: (fields, { and: andOp, eq: eqOp }) =>
                andOp(
                  eqOp(fields.organizationId, query.organizationId),
                  eqOp(fields.sku, line.sku ?? ""),
                ),
            });
            productVariantId = variant?.id ?? null;
          }
          result.push({
            id: line.id,
            organizationId: query.organizationId,
            salesTransactionId: transaction.id,
            locationId: transaction.locationId,
            productVariantId,
            quantity: line.quantity,
            occurredAt: transaction.occurredAt.toISOString(),
          });
        }
      }
      return result;
    },
    findVariantRecipe: async (query): Promise<VariantRecipeRecord | undefined> => {
      const variant = await db.query.productVariant.findFirst({
        columns: { id: true, organizationId: true },
        where: (fields, { eq: eqOp }) => eqOp(fields.id, query.productVariantId),
      });
      if (variant === undefined || variant.organizationId !== query.organizationId) {
        return undefined;
      }
      const assignment = await db.query.productRecipeAssignment.findFirst({
        where: (fields, { and: andOp, eq: eqOp, gt: gtOp, isNull, lte, or }) =>
          andOp(
            eqOp(fields.productVariantId, query.productVariantId),
            eqOp(fields.locationId, query.locationId),
            lte(fields.effectiveFrom, query.asOf),
            or(isNull(fields.effectiveTo), gtOp(fields.effectiveTo, query.asOf)),
          ),
      });
      if (assignment === undefined) {
        return undefined;
      }
      const version = await production.findRecipeVersion(assignment.recipeVersionId);
      if (version === undefined) {
        return undefined;
      }
      const snapshot = await resolvePlannedSnapshot(production, {
        organizationId: query.organizationId,
        version,
        asOf: query.asOf,
      });
      // The recipe line loss factor is not in the planned snapshot (which only
      // carries base-unit quantities and resolves sub-recipes to their output
      // item); ingredient/packaging lines are matched by item id and a
      // sub-recipe-derived component falls back to `1` (recorded approximation).
      const lossByItem = new Map<string, string>();
      for (const line of await repo.listRecipeLines(db, version.id)) {
        if (line.itemId !== null) {
          lossByItem.set(line.itemId, line.lossFactor);
        }
      }
      const outputQty = parseDecimal(version.plannedOutputQty, QUANTITY_SCALE);
      if (outputQty <= 0n) {
        return undefined;
      }
      return {
        recipeVersionId: version.id,
        usableYieldRate: version.yieldRate,
        components: snapshot.inputs.map((input) => ({
          itemId: input.itemId,
          quantityPerOutput: formatDecimal(
            divideRoundHalfUp(parseDecimal(input.plannedQty, QUANTITY_SCALE) * RATE_ONE, outputQty),
            QUANTITY_SCALE,
          ),
          lossFactor: lossByItem.get(input.itemId) ?? "1.000000",
        })),
      };
    },
  };
}

/**
 * Adapts the row-12 sales writes plus the slice-8 inventory ledger to the
 * `CorrectSalesLineStore` port (`DEC-116`), and composes the reconciliation and
 * period-close stores for the `DEC-117` reversal gate. The sales adapter is
 * composed in for the line reversal; the inventory adapter supplies the
 * source-scoped movement read and the reversal primitive. `withTransaction` is
 * the single runner that binds every composed store to one transaction, so
 * `correctSalesLine`'s gate reads, line reversal and movement reversals commit
 * or roll back together (the composed adapters' own `withTransaction` then nests
 * as savepoints).
 */
export function createPostgresCorrectSalesLineStore(db: Database): CorrectSalesLineStore {
  const inventory = createPostgresInventoryStore(db);
  return {
    ...createPostgresSalesStore(db),
    ...createPostgresReconciliationStore(db),
    ...createPostgresPeriodCloseStore(db),
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresCorrectSalesLineStore(db));
      }
      return db.transaction((tx) => fn(createPostgresCorrectSalesLineStore(tx)));
    },
    listStockMovementsBySource: async (query) =>
      inventory.listStockMovements({
        organizationId: query.organizationId,
        sourceType: query.sourceType,
        sourceId: query.sourceId,
        ...(query.onlyReversible === undefined ? {} : { onlyReversible: query.onlyReversible }),
      }),
    reverseStockMovement: (input) => reverseStockMovement(inventory, input),
  };
}
