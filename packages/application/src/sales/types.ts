import type { AuditInput } from "../auth";
import type { ImportStore } from "../imports";
import type {
  InventoryStore,
  ReverseStockMovementInput,
  ReverseStockMovementResult,
  StockMovementRecord,
} from "../inventory";

/**
 * Application-level ports and DTOs for row 12 — **sales + settlements +
 * reconciliation** (`SALE-001`–`011`, `REC-001`/`002`/`005`; `DEC-026`,
 * `DEC-035`, `DEC-040`, `DEC-042`, `DEC-043`, `DEC-045`; `ADR-0008` accepted).
 *
 * `SalesStore` is a narrow port over `@aquarela/persistence`. It reuses two
 * existing ports so the commands do not re-implement shared primitives:
 * - the row-11 `ImportStore` reads/writes (`findImportRun`,
 *   `listImportStagingRows`, `updateImportStagingRow`, `updateImportRun`), so
 *   `postImportRun` posts the staged rows of an existing run;
 * - the slice-8 `InventoryStore`, so `postTheoreticalConsumption` posts through
 *   the same atomic `postStockMovements` batch and the same locked balances
 *   (one ledger writer, `ADR-0005`/`DEC-009`).
 *
 * `timestamptz` columns are carried as ISO strings and `date` columns as
 * `yyyy-mm-dd` strings, as in the other application ports.
 *
 * Recorded open points — deliberately **not** resolved (the full list is in
 * `packages/persistence/src/schema/sales.ts` and the slice report):
 * (a) the sales/consumption grain ambiguity (`DEC-009` daily-per-location vs a
 *     single `sales_line` `source_id`, A1): the daily command still posts per
 *     `sales_line` because the ledger guard validates `source_type='sales_line'`
 *     against `sales_line.id`;
 * (c) `tax_code_id` vs `tax_rule_id` naming and the `applied_tax_rate`
 *     authority (A4); `applied_tax_rate` is captured verbatim, never re-derived
 *     (`DEC-045`);
 * (d) sales-line reversal (`DEC-028`/`DEC-073`) is implemented: `reverseSalesLine`
 *     creates a new negated `sales_line` in the same transaction, never edits or
 *     deletes the original; `correctSalesLine` (`DEC-116`) is the orchestrating
 *     command that reverses the line and every `sales_line`-sourced movement for
 *     it in one transaction, through the inventory `reverseStockMovement`
 *     primitive;
 * (h) the normalized import-row shape is owned by the row-11 slice; this slice
 *     reads the keys documented on `NORMALIZED_SALES_FIELDS` and nothing else.
 */

/**
 * The normalized staging-row keys `postImportRun` reads. There is no authority
 * pinning the jsonb shape (row 11 owns the keys it writes), so the mapping is
 * explicit and any other key is ignored.
 */
export const NORMALIZED_SALES_FIELDS = [
  "external_transaction_id",
  "external_line_id",
  "occurred_at",
  "currency",
  "location_id",
  "channel_id",
  "sku",
  "external_product_ref",
  "quantity",
  "unit_price",
  "gross_amount",
  "net_amount",
  "tax_amount",
  "discount_amount",
  "refund_amount",
  "applied_tax_rate",
  "tax_rule_id",
  "option_kind",
  "parent_external_line_id",
] as const;

export interface SalesTransactionRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly sourceSystem: string;
  readonly externalTransactionId: string;
  /** `timestamptz`, ISO. */
  readonly occurredAt: string;
  /** numeric(19,4). */
  readonly grossAmount: string | null;
  readonly netAmount: string | null;
  readonly taxAmount: string | null;
  readonly discountAmount: string | null;
  readonly refundAmount: string | null;
  readonly currency: string;
  readonly importRunId: string | null;
}

export interface NewSalesTransactionRecord {
  readonly organizationId: string;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly sourceSystem: string;
  readonly externalTransactionId: string;
  /** ISO instant. */
  readonly occurredAt: string;
  readonly grossAmount: string | null;
  readonly netAmount: string | null;
  readonly taxAmount: string | null;
  readonly discountAmount: string | null;
  readonly refundAmount: string | null;
  readonly currency: string;
  readonly importRunId: string | null;
}

export interface SalesLineRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly salesTransactionId: string;
  readonly productVariantId: string | null;
  readonly externalProductRef: string | null;
  readonly sku: string | null;
  readonly externalLineId: string | null;
  /** numeric(19,6). */
  readonly quantity: string;
  readonly unitPrice: string | null;
  readonly grossAmount: string | null;
  readonly netAmount: string | null;
  readonly taxAmount: string | null;
  /** numeric(9,6); captured, never re-derived (`DEC-045`). */
  readonly appliedTaxRate: string | null;
  readonly discountAmount: string | null;
  readonly refundAmount: string | null;
  readonly channelId: string | null;
  readonly taxRuleId: string | null;
  readonly parentLineId: string | null;
  readonly optionKind: string;
  readonly channelFeeBasis: string | null;
  readonly mappingState: string;
  readonly reversalOfId: string | null;
}

export interface NewSalesLineRecord {
  readonly organizationId: string;
  readonly salesTransactionId: string;
  readonly productVariantId: string | null;
  readonly externalProductRef: string | null;
  readonly sku: string | null;
  readonly externalLineId: string | null;
  readonly quantity: string;
  readonly unitPrice: string | null;
  readonly grossAmount: string | null;
  readonly netAmount: string | null;
  readonly taxAmount: string | null;
  readonly appliedTaxRate: string | null;
  readonly discountAmount: string | null;
  readonly refundAmount: string | null;
  readonly channelId: string | null;
  readonly taxRuleId: string | null;
  readonly parentLineId: string | null;
  readonly optionKind: string;
  readonly channelFeeBasis: string | null;
  readonly mappingState: string;
  readonly reversalOfId: string | null;
}

/**
 * A posted sales line for one location/day, as the consumption command reads it.
 * `locationId` comes from the parent transaction (`sales_line` has no location).
 */
export interface ConsumptionSalesLineRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly salesTransactionId: string;
  readonly locationId: string | null;
  readonly productVariantId: string | null;
  /** numeric(19,6). */
  readonly quantity: string;
  /** `timestamptz`, ISO. */
  readonly occurredAt: string;
}

/** One recipe component of a sold variant, already in the component base unit. */
export interface VariantRecipeComponentRecord {
  readonly itemId: string;
  /** numeric(19,6): base-unit quantity per one output unit, before yield/loss. */
  readonly quantityPerOutput: string;
  /** numeric(9,6) in (0,1]; the recipe line loss factor (default `1`). */
  readonly lossFactor: string;
}

/**
 * The effective variant→recipe resolution for one location and instant. The
 * persistence layer exposes **no repository accessor** for
 * `product_recipe_assignment`, so the Postgres adapter reads it through the
 * composed relational-query client (the waste slice's precedent) rather than
 * inventing a table or a relationship.
 */
export interface VariantRecipeRecord {
  readonly recipeVersionId: string;
  readonly usableYieldRate: string;
  readonly components: readonly VariantRecipeComponentRecord[];
}

export interface FindSalesTransactionByExternalKeyQuery {
  readonly organizationId: string;
  readonly sourceSystem: string;
  readonly externalTransactionId: string;
}

export interface FindSalesTransactionQuery {
  readonly organizationId: string;
  readonly salesTransactionId: string;
}

export interface FindSalesLineQuery {
  readonly organizationId: string;
  readonly salesLineId: string;
}

export interface ListSalesTransactionsQuery {
  readonly organizationId: string;
  readonly sourceSystem?: string;
  readonly locationId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ListSalesLinesQuery {
  readonly organizationId: string;
  readonly salesTransactionId: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ListSalesLinesForDayQuery {
  readonly organizationId: string;
  readonly locationId: string;
  /** `yyyy-mm-dd`; matched against the transaction's `occurred_at` date part. */
  readonly date: string;
}

export interface FindVariantRecipeQuery {
  readonly organizationId: string;
  readonly productVariantId: string;
  readonly locationId: string;
  readonly asOf: Date;
}

/**
 * `SalesStore` handles posting and reading the imported sales facts; it reuses
 * the row-11 `ImportStore` reads/writes (`findImportRun`,
 * `listImportStagingRows`, `updateImportStagingRow`, `updateImportRun`) so
 * `postImportRun` posts the staged rows of an existing run.
 */
export interface SalesStore extends Omit<ImportStore, "withTransaction"> {
  /** Binds `fn` to one transaction so the run, its sales rows and the audit commit together. */
  withTransaction<T>(fn: (store: SalesStore) => Promise<T>): Promise<T>;
  /**
   * One transaction by the external replay key (`SALE-003`). There is no
   * repository lookup by external id, so the adapter matches over the
   * organization/source-system page.
   */
  findSalesTransactionByExternalKey(
    query: FindSalesTransactionByExternalKeyQuery,
  ): Promise<SalesTransactionRecord | undefined>;
  findSalesTransaction(
    query: FindSalesTransactionQuery,
  ): Promise<SalesTransactionRecord | undefined>;
  listSalesTransactions(
    query: ListSalesTransactionsQuery,
  ): Promise<readonly SalesTransactionRecord[]>;
  createSalesTransaction(input: NewSalesTransactionRecord): Promise<SalesTransactionRecord>;
  listSalesLines(query: ListSalesLinesQuery): Promise<readonly SalesLineRecord[]>;
  createSalesLine(input: NewSalesLineRecord): Promise<SalesLineRecord>;
  /** One sales line by id, organization-scoped (`DEC-061`), or `undefined`. */
  findSalesLine(query: FindSalesLineQuery): Promise<SalesLineRecord | undefined>;
  /** The line whose `reversal_of_id` is `salesLineId`, or `undefined` (`DEC-073`). */
  findSalesLineReversal(query: FindSalesLineQuery): Promise<SalesLineRecord | undefined>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}

/**
 * `ConsumptionStore` handles the daily theoretical consumption posting; it
 * extends the slice-8 `InventoryStore`, so `postTheoreticalConsumption` posts
 * through the same atomic `postStockMovements` batch and the same locked
 * balances (one ledger writer, `ADR-0005`/`DEC-009`), and adds the two reads the
 * explosion needs.
 */
export interface ConsumptionStore extends InventoryStore {
  /** Binds `fn` to one transaction over the whole day's postings. */
  withTransaction<T>(fn: (store: ConsumptionStore) => Promise<T>): Promise<T>;
  /** Posted sales lines for one location/date (daily consumption, `DEC-009`). */
  listSalesLinesForDay(
    query: ListSalesLinesForDayQuery,
  ): Promise<readonly ConsumptionSalesLineRecord[]>;
  /**
   * The variant's effective recipe at `asOf`, or `undefined` when the variant
   * is not recipe-based (a retail pack) or no assignment is effective.
   */
  findVariantRecipe(query: FindVariantRecipeQuery): Promise<VariantRecipeRecord | undefined>;
}

/** One posted source's movements (`source_type` + `source_id`), org-scoped (`DEC-116`). */
export interface ListStockMovementsBySourceQuery {
  readonly organizationId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  /**
   * Keep only originals not already reversed (`DEC-116`): a movement that is
   * itself a reversal, or that already has one, is excluded, so a
   * partially-reversed line stays correctable.
   */
  readonly onlyReversible?: boolean;
}

/**
 * The port `correctSalesLine` orchestrates (`DEC-116`): the row-12 `SalesStore`
 * for the line-level reversal, plus the two inventory capabilities the
 * correction needs — a source-scoped movement read and the movement-reversal
 * primitive — and one transaction runner so the reversal line and every
 * movement reversal commit or roll back together. The movement-reversal member
 * delegates to the inventory `reverseStockMovement` primitive (`DEC-028`); it
 * copies the original's `source_type`/`source_id`, so the source line's ledger
 * cost nets to zero (the ledger convention).
 */
export interface CorrectSalesLineStore extends SalesStore {
  /** Binds `fn` to one transaction so the line and its movements reverse atomically. */
  withTransaction<T>(fn: (store: CorrectSalesLineStore) => Promise<T>): Promise<T>;
  /** Every movement posted for one source, organization-scoped, in ledger order. */
  listStockMovementsBySource(
    query: ListStockMovementsBySourceQuery,
  ): Promise<readonly StockMovementRecord[]>;
  /** Reverses one posted movement exactly (`DEC-028`) against this store's ledger. */
  reverseStockMovement(input: ReverseStockMovementInput): Promise<ReverseStockMovementResult>;
}
