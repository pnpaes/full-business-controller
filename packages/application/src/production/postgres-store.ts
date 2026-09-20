import type { UnitDimension } from "@aquarela/domain";
import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type { ConversionEdge, MasterUnit } from "../catalog";
import { createPostgresInventoryStore } from "../inventory";

import type {
  ListProductionBatchesQuery,
  ListProductionPlansQuery,
  NewProductionBatchInputRecord,
  NewProductionBatchOutputRecord,
  NewProductionBatchRecord,
  NewProductionPlanRecord,
  ProductionBatchInputRecord,
  ProductionBatchOutputRecord,
  ProductionBatchPatch,
  ProductionBatchRecord,
  ProductionPlanRecord,
  ProductionRecipeLineRecord,
  ProductionRecipeRecord,
  ProductionRecipeVersionRecord,
  ProductionStore,
} from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

function toPlan(row: repo.ProductionPlan): ProductionPlanRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    locationId: row.locationId,
    productionDate: row.productionDate,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

function toBatch(row: repo.ProductionBatch): ProductionBatchRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    locationId: row.locationId,
    workstation: row.workstation,
    recipeVersionId: row.recipeVersionId,
    planId: row.planId,
    status: row.status,
    plannedStart: iso(row.plannedStart),
    actualStart: iso(row.actualStart),
    actualFinish: iso(row.actualFinish),
    operatorId: row.operatorId,
    destinationStorageAreaId: row.destinationStorageAreaId,
    plannedOutputQty: row.plannedOutputQty,
    actualOutputQty: row.actualOutputQty,
    yieldVariancePct: row.yieldVariancePct,
    reversalOfId: row.reversalOfId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toBatchInput(row: repo.ProductionBatchInput): ProductionBatchInputRecord {
  return {
    id: row.id,
    productionBatchId: row.productionBatchId,
    itemId: row.itemId,
    unitId: row.unitId,
    plannedQty: row.plannedQty,
    actualQty: row.actualQty,
    varianceQty: row.varianceQty,
    lotId: row.lotId,
    reasonCode: row.reasonCode,
    movementId: row.movementId,
  };
}

function toBatchOutput(row: repo.ProductionBatchOutput): ProductionBatchOutputRecord {
  return {
    id: row.id,
    productionBatchId: row.productionBatchId,
    itemId: row.itemId,
    unitId: row.unitId,
    kind: row.kind,
    plannedQty: row.plannedQty,
    actualQty: row.actualQty,
    varianceQty: row.varianceQty,
    lotId: row.lotId,
    expiryDate: row.expiryDate,
    movementId: row.movementId,
  };
}

function toRecipe(row: repo.Recipe): ProductionRecipeRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    outputItemId: row.outputItemId,
  };
}

function toRecipeVersion(row: repo.RecipeVersion): ProductionRecipeVersionRecord {
  return {
    id: row.id,
    recipeId: row.recipeId,
    versionNo: row.versionNo,
    state: row.state,
    plannedInputQty: row.plannedInputQty,
    plannedOutputQty: row.plannedOutputQty,
    approvedUsableOutput: row.approvedUsableOutput,
    yieldRate: row.yieldRate,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}

function toRecipeLine(row: repo.RecipeLine): ProductionRecipeLineRecord {
  return {
    id: row.id,
    recipeVersionId: row.recipeVersionId,
    componentKind: row.componentKind,
    itemId: row.itemId,
    subRecipeId: row.subRecipeId,
    quantity: row.quantity,
    unitId: row.unitId,
    lossFactor: row.lossFactor,
    stage: row.stage,
    substitutionGroup: row.substitutionGroup,
  };
}

function toMasterUnit(row: repo.Unit): MasterUnit {
  return {
    id: row.id,
    code: row.code,
    dimension: row.dimension as UnitDimension,
    isBase: row.isBase,
  };
}

function toNewBatchInput(input: NewProductionBatchInputRecord): repo.NewProductionBatchInput {
  return {
    productionBatchId: input.productionBatchId,
    itemId: input.itemId,
    unitId: input.unitId,
    plannedQty: input.plannedQty,
    actualQty: input.actualQty,
    varianceQty: input.varianceQty,
    lotId: input.lotId,
    reasonCode: input.reasonCode,
    movementId: input.movementId,
  };
}

function toNewBatchOutput(input: NewProductionBatchOutputRecord): repo.NewProductionBatchOutput {
  return {
    productionBatchId: input.productionBatchId,
    itemId: input.itemId,
    unitId: input.unitId,
    kind: input.kind,
    plannedQty: input.plannedQty,
    actualQty: input.actualQty,
    varianceQty: input.varianceQty,
    lotId: input.lotId,
    expiryDate: input.expiryDate,
    movementId: input.movementId,
  };
}

/**
 * Adapts the persistence repositories to the `ProductionStore` port: the slice-8
 * inventory adapter is composed in (so `postStockMovements` and the balance
 * locks share one implementation), and the slice-5 recipe/conversion reads plus
 * the production reads/writes are added on top. No persistence file is changed.
 */
export function createPostgresProductionStore(db: Database): ProductionStore {
  const inventory = createPostgresInventoryStore(db);

  return {
    ...inventory,
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresProductionStore(db));
      }
      return db.transaction((tx) => fn(createPostgresProductionStore(tx)));
    },
    findMasterUnit: async (unitId) => {
      const row = await repo.findUnitById(db, unitId);
      return row === undefined ? undefined : toMasterUnit(row);
    },
    listEffectiveConversions: async (organizationId, asOf, itemId) => {
      const rows = await repo.listEffectiveConversions(db, { organizationId, asOf, itemId });
      return rows.map((row): ConversionEdge => ({
        fromUnit: {
          id: row.fromUnitId,
          code: row.fromUnitCode,
          dimension: row.fromUnitDimension as UnitDimension,
          isBase: row.fromUnitIsBase,
        },
        toUnit: {
          id: row.toUnitId,
          code: row.toUnitCode,
          dimension: row.toUnitDimension as UnitDimension,
          isBase: row.toUnitIsBase,
        },
        factor: row.factor,
        itemId: row.itemId,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
      }));
    },
    findRecipe: async (recipeId) => {
      const row = await repo.findRecipeById(db, recipeId);
      return row === undefined ? undefined : toRecipe(row);
    },
    findRecipeVersion: async (recipeVersionId) => {
      const row = await repo.findRecipeVersionById(db, recipeVersionId);
      return row === undefined ? undefined : toRecipeVersion(row);
    },
    listRecipeLines: async (recipeVersionId) =>
      (await repo.listRecipeLines(db, recipeVersionId)).map(toRecipeLine),

    findProductionPlan: async (query) => {
      const row = await repo.findProductionPlan(db, {
        organizationId: query.organizationId,
        productionPlanId: query.productionPlanId,
      });
      return row === undefined ? undefined : toPlan(row);
    },
    listProductionPlans: async (query: ListProductionPlansQuery) =>
      (
        await repo.listProductionPlans(db, {
          organizationId: query.organizationId,
          ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.offset === undefined ? {} : { offset: query.offset }),
        })
      ).map(toPlan),
    createProductionPlan: async (input: NewProductionPlanRecord) =>
      toPlan(
        await repo.createProductionPlan(db, {
          organizationId: input.organizationId,
          locationId: input.locationId,
          productionDate: input.productionDate,
          status: input.status,
          createdBy: input.createdBy,
          ...(input.id === undefined ? {} : { id: input.id }),
        }),
      ),

    findProductionBatch: async (query) => {
      const row = await repo.findProductionBatch(db, {
        organizationId: query.organizationId,
        productionBatchId: query.productionBatchId,
      });
      return row === undefined ? undefined : toBatch(row);
    },
    listProductionBatches: async (query: ListProductionBatchesQuery) =>
      (
        await repo.listProductionBatches(db, {
          organizationId: query.organizationId,
          ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.planId === undefined ? {} : { planId: query.planId }),
          ...(query.workstation === undefined ? {} : { workstation: query.workstation }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.offset === undefined ? {} : { offset: query.offset }),
        })
      ).map(toBatch),
    createProductionBatch: async (input: NewProductionBatchRecord) =>
      toBatch(
        await repo.createProductionBatch(db, {
          organizationId: input.organizationId,
          locationId: input.locationId,
          workstation: input.workstation,
          recipeVersionId: input.recipeVersionId,
          planId: input.planId,
          status: input.status,
          plannedStart: input.plannedStart === null ? null : new Date(input.plannedStart),
          operatorId: input.operatorId,
          destinationStorageAreaId: input.destinationStorageAreaId,
          plannedOutputQty: input.plannedOutputQty,
          ...(input.id === undefined ? {} : { id: input.id }),
        }),
      ),
    updateProductionBatch: async (id, patch: ProductionBatchPatch) => {
      const values: repo.ProductionBatchPatch = {};
      if (patch.status !== undefined) {
        values.status = patch.status;
      }
      if (patch.actualStart !== undefined) {
        values.actualStart = patch.actualStart === null ? null : new Date(patch.actualStart);
      }
      if (patch.actualFinish !== undefined) {
        values.actualFinish = patch.actualFinish === null ? null : new Date(patch.actualFinish);
      }
      if (patch.actualOutputQty !== undefined) {
        values.actualOutputQty = patch.actualOutputQty;
      }
      if (patch.yieldVariancePct !== undefined) {
        values.yieldVariancePct = patch.yieldVariancePct;
      }
      if (patch.operatorId !== undefined) {
        values.operatorId = patch.operatorId;
      }
      if (patch.destinationStorageAreaId !== undefined) {
        values.destinationStorageAreaId = patch.destinationStorageAreaId;
      }
      const row = await repo.updateProductionBatch(db, id, values);
      return row === undefined ? undefined : toBatch(row);
    },

    listProductionBatchInputs: async (query) =>
      (
        await repo.listProductionBatchInputs(db, {
          organizationId: query.organizationId,
          productionBatchId: query.productionBatchId,
        })
      ).map(toBatchInput),
    createProductionBatchInput: async (input) =>
      toBatchInput(await repo.createProductionBatchInput(db, toNewBatchInput(input))),
    listProductionBatchOutputs: async (query) =>
      (
        await repo.listProductionBatchOutputs(db, {
          organizationId: query.organizationId,
          productionBatchId: query.productionBatchId,
        })
      ).map(toBatchOutput),
    createProductionBatchOutput: async (input) =>
      toBatchOutput(await repo.createProductionBatchOutput(db, toNewBatchOutput(input))),
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
  };
}
