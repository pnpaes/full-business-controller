import type { ImportStagingRowRecord } from "../imports";
import { FakeImportStore } from "../imports/test-support";
import { reverseStockMovement } from "../inventory";
import { FakeInventoryStore, seedInventoryFixture } from "../inventory/test-support";
import type { InventoryFixture } from "../inventory/test-support";
import type {
  ReverseStockMovementInput,
  ReverseStockMovementResult,
  StockMovementRecord,
} from "../inventory";
import type { PeriodCloseRecord, PeriodCloseScopeType } from "../close";
import type { ReconciliationStatusRecord } from "../reconciliation";

import type {
  ConsumptionSalesLineRecord,
  ConsumptionStore,
  CorrectSalesLineStore,
  FindVariantRecipeQuery,
  ListStockMovementsBySourceQuery,
  NewSalesLineRecord,
  NewSalesTransactionRecord,
  SalesLineRecord,
  SalesStore,
  SalesTransactionRecord,
  VariantRecipeRecord,
} from "./types";

function variantKey(organizationId: string, productVariantId: string, locationId: string): string {
  return `${organizationId}\u0000${productVariantId}\u0000${locationId}`;
}

/**
 * In-memory `SalesStore` for the unit suite: it extends `FakeImportStore` so
 * `postImportRun` runs against the real staging shape. There is no
 * application-level Postgres sales test; the repository adapter is covered by
 * the `packages/persistence` suite, so the unit suite exercises the commands
 * against this fake store.
 */
export class FakeSalesStore extends FakeImportStore implements SalesStore {
  readonly salesTransactions = new Map<string, SalesTransactionRecord>();
  readonly salesLines = new Map<string, SalesLineRecord>();
  private salesSequence = 0;

  private nextSalesId(prefix: string): string {
    this.salesSequence += 1;
    return `${prefix}-${this.salesSequence}`;
  }

  override async withTransaction<T>(fn: (store: SalesStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async findSalesTransactionByExternalKey(query: {
    readonly organizationId: string;
    readonly sourceSystem: string;
    readonly externalTransactionId: string;
  }): Promise<SalesTransactionRecord | undefined> {
    return [...this.salesTransactions.values()].find(
      (row) =>
        row.organizationId === query.organizationId &&
        row.sourceSystem === query.sourceSystem &&
        row.externalTransactionId === query.externalTransactionId,
    );
  }

  async findSalesTransaction(query: {
    readonly organizationId: string;
    readonly salesTransactionId: string;
  }): Promise<SalesTransactionRecord | undefined> {
    const row = this.salesTransactions.get(query.salesTransactionId);
    return row !== undefined && row.organizationId === query.organizationId ? row : undefined;
  }

  async listSalesTransactions(query: {
    readonly organizationId: string;
    readonly sourceSystem?: string;
    readonly locationId?: string;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly SalesTransactionRecord[]> {
    let rows = [...this.salesTransactions.values()]
      .filter((row) => row.organizationId === query.organizationId)
      .filter((row) => query.sourceSystem === undefined || row.sourceSystem === query.sourceSystem)
      .filter((row) => query.locationId === undefined || row.locationId === query.locationId)
      .sort((a, b) => {
        if (a.occurredAt !== b.occurredAt) {
          return a.occurredAt < b.occurredAt ? 1 : -1;
        }
        return a.id < b.id ? 1 : -1;
      });
    rows = rows.slice(query.offset ?? 0);
    if (query.limit !== undefined) {
      rows = rows.slice(0, query.limit);
    }
    return rows;
  }

  async createSalesTransaction(input: NewSalesTransactionRecord): Promise<SalesTransactionRecord> {
    const record: SalesTransactionRecord = { id: this.nextSalesId("sales-txn"), ...input };
    this.salesTransactions.set(record.id, record);
    return record;
  }

  async listSalesLines(query: {
    readonly organizationId: string;
    readonly salesTransactionId: string;
  }): Promise<readonly SalesLineRecord[]> {
    return [...this.salesLines.values()]
      .filter(
        (row) =>
          row.organizationId === query.organizationId &&
          row.salesTransactionId === query.salesTransactionId,
      )
      .sort((a, b) => {
        const left = a.externalLineId ?? "";
        const right = b.externalLineId ?? "";
        if (left !== right) {
          return left < right ? -1 : 1;
        }
        return a.id < b.id ? -1 : 1;
      });
  }

  async createSalesLine(input: NewSalesLineRecord): Promise<SalesLineRecord> {
    const record: SalesLineRecord = { id: this.nextSalesId("sales-line"), ...input };
    this.salesLines.set(record.id, record);
    return record;
  }

  async findSalesLine(query: {
    readonly organizationId: string;
    readonly salesLineId: string;
  }): Promise<SalesLineRecord | undefined> {
    const row = this.salesLines.get(query.salesLineId);
    return row !== undefined && row.organizationId === query.organizationId ? row : undefined;
  }

  async findSalesLineReversal(query: {
    readonly organizationId: string;
    readonly salesLineId: string;
  }): Promise<SalesLineRecord | undefined> {
    return [...this.salesLines.values()].find(
      (row) =>
        row.organizationId === query.organizationId && row.reversalOfId === query.salesLineId,
    );
  }
}

/**
 * In-memory `CorrectSalesLineStore` for the unit suite (`DEC-116`): the sales
 * fake plus an embedded `FakeInventoryStore` for the source-scoped movement read
 * and the movement-reversal primitive, so `correctSalesLine` runs against the
 * same `reverseStockMovement` path the real adapter composes. The `DEC-117`
 * reversal gate reads seedable state: `reconciliations` (covering periods and
 * statuses) and `periodCloses` (`locked` closes for a scope and period).
 */
export class FakeCorrectSalesLineStore extends FakeSalesStore implements CorrectSalesLineStore {
  readonly inventory = new FakeInventoryStore();
  readonly reconciliations: FakeReconciliationCover[] = [];
  readonly periodCloses: PeriodCloseRecord[] = [];

  override async withTransaction<T>(fn: (store: CorrectSalesLineStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  listStockMovementsBySource(
    query: ListStockMovementsBySourceQuery,
  ): Promise<readonly StockMovementRecord[]> {
    return this.inventory.listStockMovements({
      organizationId: query.organizationId,
      sourceType: query.sourceType,
      sourceId: query.sourceId,
      ...(query.onlyReversible === undefined ? {} : { onlyReversible: query.onlyReversible }),
    });
  }

  reverseStockMovement(input: ReverseStockMovementInput): Promise<ReverseStockMovementResult> {
    return reverseStockMovement(this.inventory, input);
  }

  async findReconciliationsCoveringDate(query: {
    readonly organizationId: string;
    readonly at: string;
    readonly scopeTypes?: readonly string[];
  }): Promise<readonly ReconciliationStatusRecord[]> {
    return this.reconciliations
      .filter(
        (row) =>
          row.organizationId === query.organizationId &&
          row.periodStart <= query.at &&
          row.periodEnd >= query.at &&
          (query.scopeTypes === undefined ||
            query.scopeTypes.length === 0 ||
            query.scopeTypes.includes(row.scopeType)),
      )
      .map((row) => ({ status: row.status }));
  }

  async findLockedPeriodCloseCoveringDate(query: {
    readonly organizationId: string;
    readonly scopeType: PeriodCloseScopeType;
    readonly scopeId: string;
    readonly at: string;
  }): Promise<PeriodCloseRecord | undefined> {
    return this.periodCloses.find(
      (close) =>
        close.organizationId === query.organizationId &&
        close.scopeType === query.scopeType &&
        close.scopeId === query.scopeId &&
        close.status === "locked" &&
        close.periodStart <= query.at &&
        close.periodEnd >= query.at,
    );
  }
}

/** The seedable covering-reconciliation state of `FakeCorrectSalesLineStore`. */
export interface FakeReconciliationCover {
  readonly organizationId: string;
  readonly scopeType: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: string;
}

/** Seeds one covering reconciliation into the fake store (`DEC-117`). */
export function seedReconciliationCover(
  store: FakeCorrectSalesLineStore,
  input: {
    readonly organizationId: string;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly status: string;
    readonly scopeType?: string;
  },
): void {
  store.reconciliations.push({
    organizationId: input.organizationId,
    scopeType: input.scopeType ?? "sales_source",
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    status: input.status,
  });
}

/**
 * Seeds one `locked` `period_close` into the fake store (`DEC-117`). A `location`
 * scope defaults to a single day; a `company` scope takes its month bounds from
 * the caller.
 */
export function seedLockedPeriodCloseCover(
  store: FakeCorrectSalesLineStore,
  input: {
    readonly organizationId: string;
    readonly scopeType: PeriodCloseScopeType;
    readonly scopeId: string;
    readonly periodStart: string;
    readonly periodEnd?: string;
    readonly status?: string;
  },
): PeriodCloseRecord {
  const record: PeriodCloseRecord = {
    id: `period-close-${store.periodCloses.length + 1}`,
    organizationId: input.organizationId,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd ?? input.periodStart,
    status: input.status ?? "locked",
    checklist: [],
    snapshot: null,
    correctionPolicy: null,
    lockedBy: "actor-1",
    lockedAt: "2026-02-01T00:00:00.000Z",
    reopenedBy: null,
    reopenedAt: null,
    reopenReason: null,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: null,
  };
  store.periodCloses.push(record);
  return record;
}

/**
 * In-memory `ConsumptionStore` for the unit suite: it extends
 * `FakeInventoryStore`, so `postTheoreticalConsumption` posts through the same
 * `postStockMovements` path the real adapter uses.
 */
export class FakeConsumptionStore extends FakeInventoryStore implements ConsumptionStore {
  readonly salesTransactions = new Map<string, SalesTransactionRecord>();
  readonly salesLines = new Map<string, SalesLineRecord>();
  readonly variantRecipes = new Map<string, VariantRecipeRecord>();
  private salesSequence = 0;

  private nextSalesId(prefix: string): string {
    this.salesSequence += 1;
    return `${prefix}-${this.salesSequence}`;
  }

  override async withTransaction<T>(fn: (store: ConsumptionStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async createSalesTransaction(input: NewSalesTransactionRecord): Promise<SalesTransactionRecord> {
    const record: SalesTransactionRecord = { id: this.nextSalesId("sales-txn"), ...input };
    this.salesTransactions.set(record.id, record);
    return record;
  }

  async createSalesLine(input: NewSalesLineRecord): Promise<SalesLineRecord> {
    const record: SalesLineRecord = { id: this.nextSalesId("sales-line"), ...input };
    this.salesLines.set(record.id, record);
    return record;
  }

  async listSalesLinesForDay(query: {
    readonly organizationId: string;
    readonly locationId: string;
    readonly date: string;
  }): Promise<readonly ConsumptionSalesLineRecord[]> {
    const result: ConsumptionSalesLineRecord[] = [];
    for (const transaction of this.salesTransactions.values()) {
      if (
        transaction.organizationId !== query.organizationId ||
        transaction.locationId !== query.locationId ||
        transaction.occurredAt.slice(0, 10) !== query.date
      ) {
        continue;
      }
      for (const line of this.salesLines.values()) {
        if (line.salesTransactionId !== transaction.id) {
          continue;
        }
        result.push({
          id: line.id,
          organizationId: query.organizationId,
          salesTransactionId: transaction.id,
          locationId: transaction.locationId,
          productVariantId: line.productVariantId,
          quantity: line.quantity,
          occurredAt: transaction.occurredAt,
        });
      }
    }
    return result;
  }

  async findVariantRecipe(query: FindVariantRecipeQuery): Promise<VariantRecipeRecord | undefined> {
    return this.variantRecipes.get(
      variantKey(query.organizationId, query.productVariantId, query.locationId),
    );
  }
}

export interface ConsumptionFixture extends InventoryFixture {
  readonly secondItemId: string;
  readonly productVariantId: string;
  readonly sourceSystem: string;
}

/** The inventory fixture plus a second stocked component item and a variant id. */
export function seedConsumptionFixture(store: FakeConsumptionStore): ConsumptionFixture {
  const fixture = seedInventoryFixture(store);
  const secondItemId = "item-component";
  store.items.set(secondItemId, {
    id: secondItemId,
    organizationId: fixture.organizationId,
    code: "COMP-01",
    name: "Component",
    baseUnitId: fixture.unitId,
    inventoryPolicy: "stocked",
    lotTracked: false,
  });
  return {
    ...fixture,
    secondItemId,
    productVariantId: "variant-1",
    sourceSystem: "frontline",
  };
}

/** Seeds a posted sales transaction + line for the consumption fixture. */
export async function seedSalesLine(
  store: FakeConsumptionStore,
  fixture: ConsumptionFixture,
  input: {
    readonly externalTransactionId: string;
    readonly externalLineId: string;
    readonly occurredAt: string;
    readonly quantity: string;
    readonly productVariantId?: string | null;
    readonly locationId?: string;
  },
): Promise<SalesLineRecord> {
  const transaction = await store.createSalesTransaction({
    organizationId: fixture.organizationId,
    locationId: input.locationId ?? fixture.locationId,
    channelId: null,
    sourceSystem: fixture.sourceSystem,
    externalTransactionId: input.externalTransactionId,
    occurredAt: input.occurredAt,
    grossAmount: null,
    netAmount: null,
    taxAmount: null,
    discountAmount: null,
    refundAmount: null,
    currency: "NOK",
    importRunId: null,
  });
  const line = await store.createSalesLine({
    organizationId: fixture.organizationId,
    salesTransactionId: transaction.id,
    productVariantId:
      input.productVariantId === undefined ? fixture.productVariantId : input.productVariantId,
    externalProductRef: null,
    sku: null,
    externalLineId: input.externalLineId,
    quantity: input.quantity,
    unitPrice: null,
    grossAmount: null,
    netAmount: null,
    taxAmount: null,
    appliedTaxRate: null,
    discountAmount: null,
    refundAmount: null,
    channelId: null,
    taxRuleId: null,
    parentLineId: null,
    optionKind: "standalone",
    channelFeeBasis: null,
    mappingState: "mapped",
    reversalOfId: null,
  });
  return line;
}

export interface SeedStagingRow {
  readonly sourceRowNo: number;
  readonly normalized: Readonly<Record<string, unknown>>;
  readonly mappingState?: string;
  readonly errorCode?: string | null;
}

export interface SeedImportRunOptions {
  readonly status?: string;
  readonly source?: string;
  /** Seed diagnostics verbatim (e.g. `{ posting_policy: "all_or_nothing" }`). */
  readonly diagnostics?: Readonly<Record<string, unknown>>;
  readonly rows: readonly SeedStagingRow[];
}

/**
 * Creates an import run with staged rows through the real `FakeImportStore`
 * writes. Defaults to a `validated` run with `mapped` rows, which is what
 * `postImportRun` accepts.
 */
export async function seedImportRun(
  store: FakeSalesStore,
  input: { readonly organizationId: string; readonly source?: string },
  options: SeedImportRunOptions,
): Promise<{ importRunId: string; rowIds: string[] }> {
  const run = await store.createImportRun({
    organizationId: input.organizationId,
    source: input.source ?? "frontline",
    profileVersion: "v1",
    importProfileId: null,
    fileObjectId: null,
    fileHash: `hash-${store.importRuns.size + 1}`,
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    status: options.status ?? "validated",
    rowCounts: {},
    diagnostics: options.diagnostics ?? {},
    createdBy: "actor",
  });
  const rowIds: string[] = [];
  for (const row of options.rows) {
    const created = await store.createImportStagingRow({
      importRunId: run.id,
      sourceRowNo: row.sourceRowNo,
      raw: {},
      normalized: row.normalized,
      mappingState: row.mappingState ?? "mapped",
      errorCode: row.errorCode ?? null,
      linkedSalesLineId: null,
    });
    rowIds.push(created.id);
  }
  return { importRunId: run.id, rowIds };
}

/** Reads a staging row back for assertions. */
export function stagingRow(store: FakeSalesStore, rowId: string): ImportStagingRowRecord {
  const row = store.stagingRows.get(rowId);
  if (row === undefined) {
    throw new Error(`staging row ${rowId} not found`);
  }
  return row;
}
