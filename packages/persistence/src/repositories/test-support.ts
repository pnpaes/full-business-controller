import { randomUUID } from "node:crypto";

import type { Database, DatabaseTransaction, NodeDatabase } from "../client";
import {
  channel,
  checklistRun,
  checklistTemplate,
  costCenter,
  correctiveAction,
  dataQualityException,
  equipment,
  externalMapping,
  fileObject,
  hmsIncident,
  importDisposition,
  importProfile,
  importRun,
  importStagingRow,
  item,
  location,
  maintenanceLog,
  monitoringPoint,
  organization,
  product,
  productVariant,
  productionBatch,
  productionBatchInput,
  productionBatchOutput,
  priceVersion,
  productionPlan,
  reconciliation,
  reconciliationTolerance,
  recipe,
  recipeVersion,
  role,
  salesLine,
  salesTransaction,
  settlement,
  stockCount,
  stockCountLine,
  stockLot,
  stockMovement,
  stockTransfer,
  storageArea,
  unit,
  wasteEvent,
} from "../schema";
import { createUser, type NewUser, type User } from "./users";

/**
 * Test-only support for the PostgreSQL integration tests.
 *
 * Every integration test runs inside a transaction that is always rolled back.
 * That keeps the append-only `audit_event` rows (which the database by design
 * refuses to delete) from accumulating, and means each test's rows are isolated
 * even when a statement is expected to fail.
 */
class RollbackSignal extends Error {
  constructor() {
    super("rollback");
    this.name = "RollbackSignal";
  }
}

let counter = 0;

/** Random, collision-resistant suffix for usernames, emails and org names. */
export function uniqueSuffix(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

export function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}_${uniqueSuffix()}`;
}

export async function createTestOrganization(db: Database, suffix: string): Promise<string> {
  const rows = await db
    .insert(organization)
    .values({ legalName: `Test Org ${suffix}` })
    .returning({ id: organization.id });
  return rows[0]!.id;
}

export async function createTestUser(
  db: Database,
  organizationId: string,
  overrides: Partial<NewUser> = {},
): Promise<User> {
  return createUser(db, {
    organizationId,
    username: uniqueName("user"),
    email: `${uniqueName("mail")}@example.test`,
    displayName: "Test User",
    passwordHash: "hash-v1",
    ...overrides,
  });
}

export async function createTestLocation(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof location.$inferInsert> = {},
): Promise<typeof location.$inferSelect> {
  const rows = await db
    .insert(location)
    .values({
      organizationId,
      code: uniqueName("loc"),
      name: "Test Location",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestChannel(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof channel.$inferInsert> = {},
): Promise<typeof channel.$inferSelect> {
  const rows = await db
    .insert(channel)
    .values({
      organizationId,
      code: uniqueName("chan"),
      name: "Test Channel",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestProduct(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof product.$inferInsert> = {},
): Promise<typeof product.$inferSelect> {
  const rows = await db
    .insert(product)
    .values({
      organizationId,
      code: uniqueName("prod"),
      name: "Test Product",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestProductVariant(
  db: Database,
  organizationId: string,
  productId: string,
  overrides: Partial<typeof productVariant.$inferInsert> = {},
): Promise<typeof productVariant.$inferSelect> {
  const rows = await db
    .insert(productVariant)
    .values({
      organizationId,
      productId,
      code: uniqueName("variant"),
      sku: uniqueName("sku"),
      name: "Test Variant",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestRole(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof role.$inferInsert> = {},
): Promise<typeof role.$inferSelect> {
  const rows = await db
    .insert(role)
    .values({
      organizationId,
      code: "owner",
      name: "Owner",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestUnit(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof unit.$inferInsert> = {},
): Promise<typeof unit.$inferSelect> {
  const rows = await db
    .insert(unit)
    .values({
      organizationId,
      code: uniqueName("unit"),
      dimension: "mass",
      isBase: true,
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestCostCenter(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof costCenter.$inferInsert> = {},
): Promise<typeof costCenter.$inferSelect> {
  const rows = await db
    .insert(costCenter)
    .values({
      organizationId,
      code: uniqueName("cc"),
      name: "Test Cost Center",
      kind: "company_shared",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestItem(
  db: Database,
  organizationId: string,
  baseUnitId: string,
  overrides: Partial<typeof item.$inferInsert> = {},
): Promise<typeof item.$inferSelect> {
  const rows = await db
    .insert(item)
    .values({
      organizationId,
      code: uniqueName("item"),
      sku: uniqueName("sku"),
      name: "Test Item",
      itemType: "ingredient",
      baseUnitId,
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestStorageArea(
  db: Database,
  organizationId: string,
  locationId: string,
  overrides: Partial<typeof storageArea.$inferInsert> = {},
): Promise<typeof storageArea.$inferSelect> {
  const rows = await db
    .insert(storageArea)
    .values({
      organizationId,
      locationId,
      code: uniqueName("area"),
      name: "Test Storage Area",
      kind: "dry_store",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestStockLot(
  db: Database,
  organizationId: string,
  itemId: string,
  locationId: string,
  overrides: Partial<typeof stockLot.$inferInsert> = {},
): Promise<typeof stockLot.$inferSelect> {
  const rows = await db
    .insert(stockLot)
    .values({
      organizationId,
      itemId,
      locationId,
      lotNumber: uniqueName("lot"),
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

/**
 * A ledger movement with a non-zero quantity delta, defaulting to an
 * `adjustment` source. That default deliberately relies on the documented
 * `0017` `stock_movement_source_guard` no-op: the guard validates only
 * `source_type = 'goods_receipt'` and returns `NEW` unchanged for every other
 * source type (adjustment's source table is not modelled yet). Override
 * `sourceType`/`sourceId` to exercise `goods_receipt` validation.
 */
export async function createTestStockMovement(
  db: Database,
  organizationId: string,
  refs: {
    readonly itemId: string;
    readonly locationId: string;
    readonly storageAreaId: string;
    readonly unitId: string;
  },
  overrides: Partial<typeof stockMovement.$inferInsert> = {},
): Promise<typeof stockMovement.$inferSelect> {
  const rows = await db
    .insert(stockMovement)
    .values({
      organizationId,
      locationId: refs.locationId,
      storageAreaId: refs.storageAreaId,
      itemId: refs.itemId,
      movementType: "count_adjustment",
      quantityDelta: "1",
      unitId: refs.unitId,
      sourceType: "adjustment",
      sourceId: randomUUID(),
      occurredAt: new Date("2026-03-01T00:00:00.000Z"),
      postedBy: randomUUID(),
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestStockCount(
  db: Database,
  organizationId: string,
  locationId: string,
  overrides: Partial<typeof stockCount.$inferInsert> = {},
): Promise<typeof stockCount.$inferSelect> {
  const rows = await db
    .insert(stockCount)
    .values({
      organizationId,
      locationId,
      cutoff: new Date("2026-03-01T00:00:00.000Z"),
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestStockCountLine(
  db: Database,
  stockCountId: string,
  refs: { readonly itemId: string; readonly storageAreaId: string },
  overrides: Partial<typeof stockCountLine.$inferInsert> = {},
): Promise<typeof stockCountLine.$inferSelect> {
  const rows = await db
    .insert(stockCountLine)
    .values({
      stockCountId,
      itemId: refs.itemId,
      storageAreaId: refs.storageAreaId,
      expectedQty: "0",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestStockTransfer(
  db: Database,
  organizationId: string,
  refs: {
    readonly fromLocationId: string;
    readonly fromStorageAreaId: string;
    readonly toLocationId: string;
    readonly toStorageAreaId: string;
  },
  overrides: Partial<typeof stockTransfer.$inferInsert> = {},
): Promise<typeof stockTransfer.$inferSelect> {
  const rows = await db
    .insert(stockTransfer)
    .values({
      organizationId,
      ...refs,
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestWasteEvent(
  db: Database,
  organizationId: string,
  refs: {
    readonly locationId: string;
    readonly storageAreaId: string;
    readonly itemId: string;
    readonly unitId: string;
  },
  overrides: Partial<typeof wasteEvent.$inferInsert> = {},
): Promise<typeof wasteEvent.$inferSelect> {
  const rows = await db
    .insert(wasteEvent)
    .values({
      organizationId,
      locationId: refs.locationId,
      storageAreaId: refs.storageAreaId,
      itemId: refs.itemId,
      quantity: "1",
      unitId: refs.unitId,
      stage: "other",
      reasonCode: "test",
      valueMethod: "moving_average",
      occurredAt: new Date("2026-03-01T00:00:00.000Z"),
      actorId: randomUUID(),
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestProductionPlan(
  db: Database,
  organizationId: string,
  locationId: string,
  overrides: Partial<typeof productionPlan.$inferInsert> = {},
): Promise<typeof productionPlan.$inferSelect> {
  const rows = await db
    .insert(productionPlan)
    .values({
      organizationId,
      locationId,
      productionDate: "2026-03-01",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestRecipe(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof recipe.$inferInsert> = {},
): Promise<typeof recipe.$inferSelect> {
  const rows = await db
    .insert(recipe)
    .values({
      organizationId,
      code: uniqueName("recipe"),
      name: "Test Recipe",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestRecipeVersion(
  db: Database,
  recipeId: string,
  overrides: Partial<typeof recipeVersion.$inferInsert> = {},
): Promise<typeof recipeVersion.$inferSelect> {
  const rows = await db
    .insert(recipeVersion)
    .values({
      recipeId,
      versionNo: 1,
      plannedInputQty: "1",
      plannedOutputQty: "1",
      approvedUsableOutput: "1",
      yieldRate: "1",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestProductionBatch(
  db: Database,
  organizationId: string,
  refs: { readonly locationId: string; readonly recipeVersionId: string },
  overrides: Partial<typeof productionBatch.$inferInsert> = {},
): Promise<typeof productionBatch.$inferSelect> {
  const rows = await db
    .insert(productionBatch)
    .values({
      organizationId,
      locationId: refs.locationId,
      recipeVersionId: refs.recipeVersionId,
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestProductionBatchInput(
  db: Database,
  productionBatchId: string,
  refs: { readonly itemId: string; readonly unitId: string },
  overrides: Partial<typeof productionBatchInput.$inferInsert> = {},
): Promise<typeof productionBatchInput.$inferSelect> {
  const rows = await db
    .insert(productionBatchInput)
    .values({
      productionBatchId,
      itemId: refs.itemId,
      unitId: refs.unitId,
      plannedQty: "1",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestProductionBatchOutput(
  db: Database,
  productionBatchId: string,
  refs: { readonly itemId: string; readonly unitId: string },
  overrides: Partial<typeof productionBatchOutput.$inferInsert> = {},
): Promise<typeof productionBatchOutput.$inferSelect> {
  const rows = await db
    .insert(productionBatchOutput)
    .values({
      productionBatchId,
      itemId: refs.itemId,
      unitId: refs.unitId,
      kind: "finished",
      plannedQty: "1",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestImportRun(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof importRun.$inferInsert> = {},
): Promise<typeof importRun.$inferSelect> {
  const rows = await db
    .insert(importRun)
    .values({
      organizationId,
      source: "frontline",
      profileVersion: "v1",
      fileHash: uniqueName("hash"),
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

/**
 * A `DEC-081` import profile. `posting_policy` defaults to `allow_partial` and
 * `validation_rules` to `{}` (the schema defaults); `source` gets a unique test
 * value because `(organization_id, source)` is unique.
 */
export async function createTestImportProfile(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof importProfile.$inferInsert> = {},
): Promise<typeof importProfile.$inferSelect> {
  const rows = await db
    .insert(importProfile)
    .values({
      organizationId,
      source: uniqueName("source"),
      profileVersion: "v1",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestImportStagingRow(
  db: Database,
  importRunId: string,
  overrides: Partial<typeof importStagingRow.$inferInsert> = {},
): Promise<typeof importStagingRow.$inferSelect> {
  const rows = await db
    .insert(importStagingRow)
    .values({
      importRunId,
      sourceRowNo: 1,
      raw: { row: 1 },
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

/**
 * A `DEC-083` import disposition. `disposition` defaults to `unmapped` and
 * `actor_id` to a random uuid (the FK to `app_user` is deferred, so no user row
 * is needed); `sourceRowNo` only exists on the joined read.
 */
export async function createTestImportDisposition(
  db: Database,
  importStagingRowId: string,
  overrides: Partial<typeof importDisposition.$inferInsert> = {},
): Promise<typeof importDisposition.$inferSelect> {
  const rows = await db
    .insert(importDisposition)
    .values({
      importStagingRowId,
      disposition: "unmapped",
      actorId: randomUUID(),
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestExternalMapping(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof externalMapping.$inferInsert> = {},
): Promise<typeof externalMapping.$inferSelect> {
  const rows = await db
    .insert(externalMapping)
    .values({
      organizationId,
      sourceSystem: "frontline",
      entityType: "product",
      externalId: uniqueName("ext"),
      internalEntityType: "product_variant",
      internalEntityId: randomUUID(),
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestSalesTransaction(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof salesTransaction.$inferInsert> = {},
): Promise<typeof salesTransaction.$inferSelect> {
  const rows = await db
    .insert(salesTransaction)
    .values({
      organizationId,
      sourceSystem: "frontline",
      externalTransactionId: uniqueName("txn"),
      occurredAt: new Date("2026-03-01T12:00:00.000Z"),
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestSalesLine(
  db: Database,
  organizationId: string,
  salesTransactionId: string,
  overrides: Partial<typeof salesLine.$inferInsert> = {},
): Promise<typeof salesLine.$inferSelect> {
  const rows = await db
    .insert(salesLine)
    .values({
      organizationId,
      salesTransactionId,
      quantity: "1",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestSettlement(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof settlement.$inferInsert> = {},
): Promise<typeof settlement.$inferSelect> {
  const rows = await db
    .insert(settlement)
    .values({
      organizationId,
      provider: "wolt",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      status: "received",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestPriceVersion(
  db: Database,
  organizationId: string,
  refs: { readonly productVariantId: string; readonly sourceScenarioId: string },
  overrides: Partial<typeof priceVersion.$inferInsert> = {},
): Promise<typeof priceVersion.$inferSelect> {
  const rows = await db
    .insert(priceVersion)
    .values({
      organizationId,
      productVariantId: refs.productVariantId,
      sourceScenarioId: refs.sourceScenarioId,
      grossPrice: "10.0000",
      netPrice: "9.0000",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      approvedBy: randomUUID(),
      approvedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestReconciliation(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof reconciliation.$inferInsert> = {},
): Promise<typeof reconciliation.$inferSelect> {
  const rows = await db
    .insert(reconciliation)
    .values({
      organizationId,
      scopeType: "sales_source",
      scopeId: randomUUID(),
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      expectedAmount: "100",
      actualAmount: "100",
      tolerance: "5",
      difference: "0",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestReconciliationTolerance(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof reconciliationTolerance.$inferInsert> = {},
): Promise<typeof reconciliationTolerance.$inferSelect> {
  const rows = await db
    .insert(reconciliationTolerance)
    .values({
      organizationId,
      kind: "sales_settlement",
      rate: "0.005",
      floorAmount: "5.0000",
      effectiveFrom: "2026-01-01",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

/**
 * A `DEC-080` data-quality exception. `severity` defaults to `medium` and
 * `status` to `open` (the schema defaults); `rule_code` gets a unique test
 * value and `entity_id` a random uuid because the target is polymorphic.
 */
export async function createTestDataQualityException(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof dataQualityException.$inferInsert> = {},
): Promise<typeof dataQualityException.$inferSelect> {
  const rows = await db
    .insert(dataQualityException)
    .values({
      organizationId,
      ruleCode: uniqueName("rule"),
      entityType: "stock_transfer",
      entityId: randomUUID(),
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

/**
 * An `ADR-0006`/`DEC-085` file object. `storage_key` and `checksum_sha256` get
 * unique test values because `(organization_id, storage_key)` is unique;
 * `uploaded_by` stays null (the `app_user` FK is deferred) and the polymorphic
 * link stays null unless a test sets it.
 */
export async function createTestFileObject(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof fileObject.$inferInsert> = {},
): Promise<typeof fileObject.$inferSelect> {
  const rows = await db
    .insert(fileObject)
    .values({
      organizationId,
      storageKey: uniqueName("key"),
      filename: "test.csv",
      mime: "text/csv",
      sizeBytes: 1,
      checksumSha256: uniqueName("sha"),
      retentionPolicy: "default",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

/**
 * A `DEC-089` monitoring point. `code` gets a unique test value because
 * `(organization_id, code)` is unique; the vocabulary columns and the
 * `target_min <= target_max` check get valid defaults, so a test need only
 * override the field under test.
 */
export async function createTestMonitoringPoint(
  db: Database,
  organizationId: string,
  locationId: string,
  overrides: Partial<typeof monitoringPoint.$inferInsert> = {},
): Promise<typeof monitoringPoint.$inferSelect> {
  const rows = await db
    .insert(monitoringPoint)
    .values({
      organizationId,
      locationId,
      code: uniqueName("mp"),
      name: "Test Monitoring Point",
      kind: "refrigerator",
      unit: "celsius",
      targetMin: "0",
      targetMax: "4",
      checkFrequency: "daily",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

/**
 * A `DEC-090`/`DEC-095` HMS incident. `reported_by` gets a random uuid (the
 * `app_user` FK is deferred) and the vocabulary columns take valid defaults, so
 * a test need only override the field under test. `owner_id` stays null.
 */
export async function createTestHmsIncident(
  db: Database,
  organizationId: string,
  locationId: string,
  overrides: Partial<typeof hmsIncident.$inferInsert> = {},
): Promise<typeof hmsIncident.$inferSelect> {
  const rows = await db
    .insert(hmsIncident)
    .values({
      organizationId,
      locationId,
      category: "other",
      severity: "low",
      occurredAt: new Date("2026-01-01T08:00:00.000Z"),
      reportedAt: new Date("2026-01-01T09:00:00.000Z"),
      reportedBy: randomUUID(),
      title: "Test Incident",
      involvesPersonalData: false,
      status: "open",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

/**
 * A `DEC-090`/`DEC-095` corrective action. Both links (`incident_id`,
 * `monitoring_reading_id`) are nullable and stay null unless a test sets them.
 */
export async function createTestCorrectiveAction(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof correctiveAction.$inferInsert> = {},
): Promise<typeof correctiveAction.$inferSelect> {
  const rows = await db
    .insert(correctiveAction)
    .values({
      organizationId,
      description: "Test corrective action",
      status: "open",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

/**
 * A `DEC-091`/`HMS-005` checklist template. The vocabulary columns and the
 * jsonb-array `items` get valid defaults, so a test need only override the field
 * under test; `supersedes_id` stays null unless a test sets it.
 */
export async function createTestChecklistTemplate(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof checklistTemplate.$inferInsert> = {},
): Promise<typeof checklistTemplate.$inferSelect> {
  const rows = await db
    .insert(checklistTemplate)
    .values({
      organizationId,
      name: uniqueName("checklist"),
      category: "cleaning",
      frequency: "daily",
      items: [],
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

/**
 * A `DEC-091`/`HMS-005` checklist run. `performed_by` gets a random uuid (the
 * `app_user` FK is deferred) and the schema defaults take `status`/`results`, so
 * a test need only override the field under test.
 */
export async function createTestChecklistRun(
  db: Database,
  organizationId: string,
  refs: { readonly templateId: string; readonly locationId: string },
  overrides: Partial<typeof checklistRun.$inferInsert> = {},
): Promise<typeof checklistRun.$inferSelect> {
  const rows = await db
    .insert(checklistRun)
    .values({
      organizationId,
      templateId: refs.templateId,
      locationId: refs.locationId,
      runAt: new Date("2026-01-01T08:00:00.000Z"),
      performedBy: randomUUID(),
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

/**
 * A `DEC-092`/`HMS-006` equipment register row. `code` gets a unique test value
 * because `(organization_id, code)` is unique; `kind` is free text, so a test
 * need only override the field under test.
 */
export async function createTestEquipment(
  db: Database,
  organizationId: string,
  locationId: string,
  overrides: Partial<typeof equipment.$inferInsert> = {},
): Promise<typeof equipment.$inferSelect> {
  const rows = await db
    .insert(equipment)
    .values({
      organizationId,
      locationId,
      code: uniqueName("equip"),
      name: "Test Equipment",
      kind: "other",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

/**
 * A `DEC-092`/`HMS-006` maintenance-log fact. `performed_by` gets a random uuid
 * (the `app_user` FK is deferred); `file_object_id` stays null unless a test
 * sets it.
 */
export async function createTestMaintenanceLog(
  db: Database,
  organizationId: string,
  equipmentId: string,
  overrides: Partial<typeof maintenanceLog.$inferInsert> = {},
): Promise<typeof maintenanceLog.$inferSelect> {
  const rows = await db
    .insert(maintenanceLog)
    .values({
      organizationId,
      equipmentId,
      kind: "service",
      performedAt: new Date("2026-01-01T08:00:00.000Z"),
      performedBy: randomUUID(),
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

/**
 * Awaits `operation` expecting it to reject, then returns the underlying error.
 *
 * drizzle 0.44+ wraps driver errors in `DrizzleQueryError` with the original
 * PostgreSQL error (the one carrying the trigger/constraint message) in
 * `.cause`. Assertions on a failure reason must go through `.cause`; falling
 * back to the wrapper keeps this usable if that wrapping ever changes.
 */
export async function rejectionCause(operation: Promise<unknown>): Promise<Error> {
  const caught = await operation.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(caught instanceof Error)) {
    throw new Error("expected the operation to reject with an Error");
  }
  return caught.cause instanceof Error ? caught.cause : caught;
}

/**
 * Runs `fn` in a transaction and rolls it back. A statement that is expected to
 * fail can be caught inside `fn` without aborting the test: the rollback at the
 * end is what discards the work either way.
 */
export async function inRollback(
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
