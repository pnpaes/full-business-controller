import type { AuditInput } from "../auth";
import type { InventoryStore, StockMovementRecord } from "../inventory";

/**
 * Application-level ports and DTOs for the slice-9 **transfers** vertical
 * (`INV-005`, `INV-007`, `INV-009`, `DEC-029`).
 *
 * There is **no transfer line table** in any authority: the items live in the
 * paired `stock_movement` rows linked by `stock_movement.transfer_id`, so the
 * header is a thin workflow record and per-item dispatched/received facts are
 * derived from the movements (recorded, not invented — see the slice report).
 *
 * `TransferStore` extends `InventoryStore` so the dispatch/receive commands can
 * reuse the atomic `postStockMovements` batch and the balance reads on one port;
 * a single Postgres adapter composes `createPostgresInventoryStore` with the
 * transfer-specific header reads/writes, and `FakeTransferStore` composes
 * `FakeInventoryStore`, so the unit suite exercises the real posting path.
 *
 * `timestamptz` columns are carried as ISO strings (`date` columns do not occur
 * here).
 *
 * Open points **recorded, not invented** (see the slice report):
 *  - there is no transfer line table in any authority: the items live in the
 *    paired `stock_movement` rows linked by `transfer_id`, and the per-item
 *    dispatched/received facts are derived from those movements;
 *  - ~~there is no exception table for discrepancies (`DEC-029` says differences
 *    become exceptions, but `data_quality_exception` is deferred); the header's
 *    `discrepancy_note` is the only recorded difference today~~ resolved by
 *    `DEC-080`: `data_quality_exception` exists (migration `0030`) and
 *    `receiveStockTransfer` records a `transfer_discrepancy` exception
 *    alongside the human `discrepancy_note`;
 *  - per-source reversal semantics (`DEC-028`) are not implemented in the
 *    inventory `reverseStockMovement`, so a transfer leg cannot yet be reversed
 *    through it — a short receipt simply stays in transit until that lands.
 */

export interface StockTransferRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly fromLocationId: string;
  readonly fromStorageAreaId: string;
  readonly toLocationId: string;
  readonly toStorageAreaId: string;
  readonly status: string;
  /** `timestamptz`, ISO, or null until dispatched. */
  readonly dispatchedAt: string | null;
  /** `timestamptz`, ISO, or null until received. */
  readonly receivedAt: string | null;
  /** The first dispatch leg; the full pair is read via `transfer_id`. */
  readonly dispatchMovementId: string | null;
  /** The first receipt leg; the full pair is read via `transfer_id`. */
  readonly receiptMovementId: string | null;
  readonly discrepancyNote: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  /** `timestamptz`, ISO, or null before the first update. */
  readonly updatedAt: string | null;
}

export interface NewStockTransferRecord {
  /** Optional deterministic id (idempotent seeding); the DB generates one otherwise. */
  readonly id?: string;
  readonly organizationId: string;
  readonly fromLocationId: string;
  readonly fromStorageAreaId: string;
  readonly toLocationId: string;
  readonly toStorageAreaId: string;
  readonly status: string;
  readonly createdBy: string | null;
}

/**
 * The mutable workflow columns of a transfer header. Every field is optional so
 * a command writes only what its transition changes.
 */
export interface UpdateStockTransferValues {
  readonly status?: string;
  /** ISO instant. */
  readonly dispatchedAt?: string | null;
  /** ISO instant. */
  readonly receivedAt?: string | null;
  readonly dispatchMovementId?: string | null;
  readonly receiptMovementId?: string | null;
  readonly discrepancyNote?: string | null;
}

/**
 * A ledger movement that belongs to a transfer (`stock_movement.transfer_id`).
 * The inventory slice's `StockMovementRecord` deliberately omits the column; the
 * transfers read needs it to pair the two legs (`DEC-029`).
 */
export interface TransferMovementRecord extends StockMovementRecord {
  readonly transferId: string | null;
}

export interface ListStockTransfersQuery {
  readonly organizationId: string;
  readonly status?: string;
  readonly fromLocationId?: string;
  readonly toLocationId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** One item/lot pair of a transfer, derived from its paired movements. */
export interface TransferLineSummary {
  readonly itemId: string;
  readonly lotId: string | null;
  /** numeric(19,6), positive; 0 when nothing was dispatched for the pair. */
  readonly dispatchedQuantity: string;
  /** numeric(19,6), positive; 0 when nothing was received for the pair. */
  readonly receivedQuantity: string;
  /** The paired dispatch leg's applied average (numeric(19,4)), or null. */
  readonly unitCost: string | null;
  readonly hasDiscrepancy: boolean;
}

/** The movement-derived facts shared by the list row and the detail read. */
export interface TransferMovementSummary {
  readonly lines: readonly TransferLineSummary[];
  /** numeric(19,6), positive total across every dispatched line. */
  readonly dispatchedQuantity: string;
  /** numeric(19,6), positive total across every received line. */
  readonly receivedQuantity: string;
  readonly hasDiscrepancy: boolean;
}

export interface TransferSummary extends TransferMovementSummary {
  readonly transfer: StockTransferRecord;
}

export interface TransferDetail extends TransferMovementSummary {
  readonly transfer: StockTransferRecord;
  /** Every movement paired to the transfer, in ledger order. */
  readonly movements: readonly TransferMovementRecord[];
}

export interface StockTransferPage {
  readonly transfers: readonly TransferSummary[];
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

/**
 * `DEC-080` (`DQ-001`): a `data_quality_exception` row as the transfers store
 * needs it. The port exposes only the create the receive command performs;
 * reads/updates live in the persistence repository. `timestamptz` columns are
 * ISO strings and `due_date` a `yyyy-mm-dd` string.
 */
export interface DataQualityExceptionRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly ruleCode: string;
  readonly severity: string;
  readonly entityType: string;
  readonly entityId: string;
  /** `timestamptz`, ISO. */
  readonly detectedAt: string;
  readonly ownerId: string | null;
  /** `date`, `yyyy-mm-dd`. */
  readonly dueDate: string | null;
  readonly status: string;
  readonly resolution: string | null;
}

export interface NewDataQualityExceptionRecord {
  readonly organizationId: string;
  readonly ruleCode: string;
  readonly severity: string;
  readonly entityType: string;
  readonly entityId: string;
  /** `timestamptz`, ISO. */
  readonly detectedAt: string;
  readonly status: string;
  readonly resolution?: string | null;
  readonly ownerId?: string | null;
  /** `date`, `yyyy-mm-dd`. */
  readonly dueDate?: string | null;
  readonly createdBy?: string | null;
}

export interface TransferStore extends InventoryStore {
  /** Binds `fn` to one transaction so the header update and the ledger post commit together. */
  withTransaction<T>(fn: (store: TransferStore) => Promise<T>): Promise<T>;
  /** One transfer by id, organization-scoped (`DEC-061`), or `undefined`. */
  findStockTransfer(query: {
    readonly organizationId: string;
    readonly transferId: string;
  }): Promise<StockTransferRecord | undefined>;
  listStockTransfers(query: ListStockTransfersQuery): Promise<readonly StockTransferRecord[]>;
  createStockTransfer(input: NewStockTransferRecord): Promise<StockTransferRecord>;
  /** Org-scoped header patch; the schema checks still govern the legal combinations. */
  updateStockTransfer(query: {
    readonly organizationId: string;
    readonly transferId: string;
    readonly values: UpdateStockTransferValues;
  }): Promise<StockTransferRecord>;
  /** The paired ledger legs of one transfer (`transfer_id`), org-scoped. */
  listStockMovementsByTransferId(query: {
    readonly organizationId: string;
    readonly transferId: string;
  }): Promise<readonly TransferMovementRecord[]>;
  /**
   * Records a `DEC-080` data-quality exception inside the caller's transaction,
   * so a failed command rolls it back with the rest of the batch.
   */
  createDataQualityException(
    input: NewDataQualityExceptionRecord,
  ): Promise<DataQualityExceptionRecord>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
