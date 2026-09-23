import { type ToleranceKind } from "@aquarela/domain";
import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import { createPostgresImportStore } from "../imports";

import type {
  NewReconciliationRecord,
  NewReconciliationToleranceRecord,
  ReconciliationPatch,
  ReconciliationRecord,
  ReconciliationStore,
  ReconciliationToleranceRecord,
  SettlementRecord,
} from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

function toSettlement(row: repo.Settlement): SettlementRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    provider: row.provider,
    channelId: row.channelId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    paidAmount: row.paidAmount,
    feeAmount: row.feeAmount,
    refundAmount: row.refundAmount,
    currency: row.currency,
    status: row.status,
  };
}

function toReconciliation(row: repo.Reconciliation): ReconciliationRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    expectedAmount: row.expectedAmount,
    actualAmount: row.actualAmount,
    tolerance: row.tolerance,
    difference: row.difference,
    status: row.status,
    resolutionNote: row.resolutionNote,
    ownerId: row.ownerId,
    dueDate: row.dueDate,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt === null ? null : row.updatedAt.toISOString(),
  };
}

function toTolerance(row: repo.ReconciliationTolerance): ReconciliationToleranceRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: row.kind as ToleranceKind,
    rate: row.rate,
    floorAmount: row.floorAmount,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}

/**
 * Adapts the persistence row-12 settlement/reconciliation repositories to the
 * `ReconciliationStore` port, composing the row-11 import adapter so
 * `reconcileImportRun` reads the run's staging rows through the same port.
 *
 * Repository gaps bridged here (recorded, not resolved — this slice must not
 * edit persistence):
 * - there is no reconciliation lookup by scope, so the adapter matches over the
 *   organization/scope page.
 *
 * `sumSalesForChannelPeriod` is re-derived from `sales_line.gross_amount` through
 * `sumSalesLineGrossForChannelPeriod` (`DEC-118`), excluding `included` lines and
 * netting a line-level `DEC-073` reversal as a negated line — so the settlement
 * reconciliation agrees with the sales reports (formerly the adapter summed the
 * append-only transaction header, where a reversal never netted).
 */
export function createPostgresReconciliationStore(db: Database): ReconciliationStore {
  const imports = createPostgresImportStore(db);
  return {
    ...imports,
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresReconciliationStore(db));
      }
      return db.transaction((tx) => fn(createPostgresReconciliationStore(tx)));
    },
    findSettlement: async (query) => {
      const row = await repo.findSettlement(db, query);
      return row === undefined ? undefined : toSettlement(row);
    },
    listSettlements: async (query) =>
      (
        await repo.listSettlements(db, {
          organizationId: query.organizationId,
          ...(query.provider === undefined ? {} : { provider: query.provider }),
          ...(query.channelId === undefined ? {} : { channelId: query.channelId }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.offset === undefined ? {} : { offset: query.offset }),
        })
      ).map(toSettlement),
    sumSalesForChannelPeriod: (query) =>
      repo.sumSalesLineGrossForChannelPeriod(db, {
        organizationId: query.organizationId,
        channelId: query.channelId,
        periodStart: query.periodStart,
        periodEnd: query.periodEnd,
        currency: query.currency,
      }),
    findReconciliation: async (query) => {
      const row = await repo.findReconciliation(db, query);
      return row === undefined ? undefined : toReconciliation(row);
    },
    findReconciliationByScope: async (query) => {
      const rows = await repo.listReconciliations(db, {
        organizationId: query.organizationId,
        scopeType: query.scopeType,
        scopeId: query.scopeId,
      });
      const match = rows.find((row) => row.periodStart === query.periodStart);
      return match === undefined ? undefined : toReconciliation(match);
    },
    listReconciliations: async (query) =>
      (
        await repo.listReconciliations(db, {
          organizationId: query.organizationId,
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.scopeType === undefined ? {} : { scopeType: query.scopeType }),
          ...(query.scopeId === undefined ? {} : { scopeId: query.scopeId }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.offset === undefined ? {} : { offset: query.offset }),
        })
      ).map(toReconciliation),
    findReconciliationsCoveringDate: async (query) =>
      (
        await repo.findReconciliationsCoveringDate(db, {
          organizationId: query.organizationId,
          at: query.at,
          ...(query.scopeTypes === undefined ? {} : { scopeTypes: query.scopeTypes }),
        })
      ).map((row) => ({ status: row.status })),
    findReconciliationTolerance: async (query) => {
      const row = await repo.findReconciliationTolerance(db, query);
      return row === undefined ? undefined : toTolerance(row);
    },
    listReconciliationTolerances: async (query) =>
      (
        await repo.listReconciliationTolerances(db, {
          organizationId: query.organizationId,
          ...(query.kind === undefined ? {} : { kind: query.kind }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.offset === undefined ? {} : { offset: query.offset }),
        })
      ).map(toTolerance),
    createReconciliationTolerance: async (input: NewReconciliationToleranceRecord) =>
      toTolerance(
        await repo.createReconciliationTolerance(db, {
          organizationId: input.organizationId,
          kind: input.kind,
          rate: input.rate,
          floorAmount: input.floorAmount,
          effectiveFrom: input.effectiveFrom,
          ...(input.effectiveTo === undefined ? {} : { effectiveTo: input.effectiveTo }),
        }),
      ),
    createReconciliation: async (input: NewReconciliationRecord) =>
      toReconciliation(await repo.createReconciliation(db, { ...input })),
    updateReconciliation: async (query, patch: ReconciliationPatch) => {
      const values: repo.ReconciliationPatch = {
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.expectedAmount === undefined ? {} : { expectedAmount: patch.expectedAmount }),
        ...(patch.actualAmount === undefined ? {} : { actualAmount: patch.actualAmount }),
        ...(patch.tolerance === undefined ? {} : { tolerance: patch.tolerance }),
        ...(patch.difference === undefined ? {} : { difference: patch.difference }),
        ...(patch.resolutionNote === undefined ? {} : { resolutionNote: patch.resolutionNote }),
        ...(patch.ownerId === undefined ? {} : { ownerId: patch.ownerId }),
        ...(patch.dueDate === undefined ? {} : { dueDate: patch.dueDate }),
        ...(patch.updatedBy === undefined ? {} : { updatedBy: patch.updatedBy }),
      };
      const row = await repo.updateReconciliation(db, query, values);
      return row === undefined ? undefined : toReconciliation(row);
    },
  };
}
