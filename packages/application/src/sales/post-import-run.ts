import {
  DomainError,
  MONEY_SCALE,
  QUANTITY_SCALE,
  assertImportRunStatusTransition,
  formatDecimal,
  parseDecimal,
} from "@aquarela/domain";

import type { ImportStagingRowRecord } from "../imports";
import { isBlank, isPlainObject } from "../imports/validation";
import { assertIsoInstant } from "../inventory/validation";

import { SALES_AUDIT_ACTIONS } from "./actions";
import type { NewSalesLineRecord, NewSalesTransactionRecord, SalesStore } from "./types";
import {
  readMoneyOrNull,
  readOptionKind,
  readQuantityOrNull,
  readRateOrNull,
  readUuidOrNull,
} from "./validation";

export interface PostImportRunInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly importRunId: string;
  /**
   * The `sales_transaction.source_system` value. Defaults to the run's
   * `source` label; there is no source-system column on `import_run`.
   */
  readonly sourceSystem?: string;
}

export interface PostImportRunResult {
  readonly importRunId: string;
  readonly status: string;
  readonly postedCount: number;
  readonly notPostedCount: number;
  readonly transactionCount: number;
  /** `DEC-043` included zero-price lines: posted but excluded from revenue. */
  readonly includedLineCount: number;
}

/** One staging row that can become a `sales_line`, with its normalized fields read. */
interface PostableRow {
  readonly row: ImportStagingRowRecord;
  readonly normalized: Readonly<Record<string, unknown>>;
  readonly externalTransactionId: string;
  readonly externalLineId: string;
  readonly occurredAt: string;
  readonly currency: string;
  readonly quantity: string;
  readonly optionKind: string;
  readonly parentExternalLineId: string | null;
}

function addMoney(total: bigint, value: string | null): bigint {
  return value === null ? total : total + parseDecimal(value, MONEY_SCALE);
}

function sumMoney(
  rows: readonly PostableRow[],
  key: "gross_amount" | "net_amount" | "tax_amount" | "discount_amount" | "refund_amount",
) {
  return rows.reduce((total, item) => addMoney(total, readMoneyOrNull(item.normalized, key)), 0n);
}

/**
 * Reads a staging row into a `PostableRow`, or returns null when the row is not
 * postable. A row is postable when it is `mapped`, carries no error code and has
 * the external transaction/line keys, an ISO instant, a currency and a positive
 * quantity; anything else stays in the review queue for an approved disposition
 * (`DEC-025`/`DEC-035`).
 */
function toPostableRow(row: ImportStagingRowRecord): PostableRow | null {
  if (row.mappingState !== "mapped" || row.errorCode !== null) {
    return null;
  }
  if (!isPlainObject(row.normalized)) {
    return null;
  }
  const externalTransactionId = readUuidOrNull(row.normalized, "external_transaction_id");
  const externalLineId = readUuidOrNull(row.normalized, "external_line_id");
  const occurredAt = readUuidOrNull(row.normalized, "occurred_at");
  const currency = readUuidOrNull(row.normalized, "currency");
  const quantity = readQuantityOrNull(row.normalized, "quantity");
  if (
    externalTransactionId === null ||
    externalLineId === null ||
    occurredAt === null ||
    currency === null ||
    quantity === null
  ) {
    return null;
  }
  if (isBlank(occurredAt)) {
    return null;
  }
  assertIsoInstant(occurredAt, "occurred_at");
  if (parseDecimal(quantity, QUANTITY_SCALE) <= 0n) {
    return null;
  }
  return {
    row,
    normalized: row.normalized,
    externalTransactionId,
    externalLineId,
    occurredAt,
    currency,
    quantity,
    optionKind: readOptionKind(row.normalized),
    parentExternalLineId: readUuidOrNull(row.normalized, "parent_external_line_id"),
  };
}

/**
 * Posts the staged rows of a **validated** import run into `sales_transaction` /
 * `sales_line` (`SALE-003`/`SALE-005`; `DEC-025`, `DEC-035`, `DEC-042`,
 * `DEC-043`, `DEC-045`).
 *
 * - **A rejected file posts nothing** (`DEC-025`): only a run in `validated` or
 *   `needs_review` may post; any other status throws before a single row is
 *   written.
 * - **Idempotent on the external keys** (`SALE-003`): a transaction is matched by
 *   `(source_system, external_transaction_id)` and a line by
 *   `(sales_transaction_id, external_line_id)`, so replaying a posting (for
 *   example after a failed attempt) reuses the existing rows instead of
 *   duplicating them. Each posted staging row is linked through
 *   `import_staging_row.linked_sales_line_id`.
 * - **Partial posting** (`DEC-025`): valid/mapped rows are posted and the run is
 *   `partially_posted`; a run whose every staged row posts is `posted`. The
 *   non-posted rows keep their review-queue state and are the ones
 *   `reconcileImportRun` requires a disposition for (`DEC-035`).
 * - **Options/add-ons** (`DEC-043`): `option_kind` is normalized onto the line;
 *   an `attached`/`included` line must resolve its `parent_external_line_id`
 *   within the same transaction. `included` (zero-price) lines are retained for
 *   consumption but **excluded from the transaction header totals**, so they do
 *   not inflate revenue.
 * - **Applied VAT** (`DEC-045`/`DEC-042`): `applied_tax_rate` is captured
 *   verbatim onto the line; it is never re-derived from the tax rule.
 *
 * The whole posting runs in one transaction, so a failure on any row rolls back
 * every transaction/line and leaves the run unposted.
 */
export async function postImportRun(
  store: SalesStore,
  input: PostImportRunInput,
): Promise<PostImportRunResult> {
  return store.withTransaction(async (tx) => {
    const run = await tx.findImportRun({
      organizationId: input.organizationId,
      importRunId: input.importRunId,
    });
    if (run === undefined) {
      throw new DomainError("import run not found in organization");
    }
    if (run.status !== "validated" && run.status !== "needs_review") {
      throw new DomainError(
        `import run is not open for posting (status ${run.status}); a rejected/unvalidated file posts nothing (DEC-025)`,
      );
    }

    const rows = await tx.listImportStagingRows({
      organizationId: input.organizationId,
      importRunId: run.id,
    });

    const postable: PostableRow[] = [];
    for (const row of rows) {
      if (row.linkedSalesLineId !== null) {
        // Already posted in an earlier attempt: idempotent, nothing to write.
        continue;
      }
      const candidate = toPostableRow(row);
      if (candidate !== null) {
        postable.push(candidate);
      }
    }

    const sourceSystem = (input.sourceSystem ?? run.source).trim();
    if (isBlank(sourceSystem)) {
      throw new DomainError("sourceSystem is required");
    }

    const groups = new Map<string, PostableRow[]>();
    for (const row of postable) {
      const group = groups.get(row.externalTransactionId);
      if (group === undefined) {
        groups.set(row.externalTransactionId, [row]);
      } else {
        group.push(row);
      }
    }

    let postedCount = rows.filter((row) => row.linkedSalesLineId !== null).length;
    let includedLineCount = 0;
    let transactionCount = 0;

    for (const [externalTransactionId, group] of groups) {
      const existing = await tx.findSalesTransactionByExternalKey({
        organizationId: input.organizationId,
        sourceSystem,
        externalTransactionId,
      });

      let transactionId: string;
      if (existing !== undefined) {
        transactionId = existing.id;
      } else {
        const currency = group[0]!.currency;
        for (const row of group) {
          if (row.currency !== currency) {
            throw new DomainError(
              `mixed currencies in external transaction ${externalTransactionId} are not supported`,
            );
          }
        }
        const occurredAt = group.reduce(
          (earliest, row) => (row.occurredAt < earliest ? row.occurredAt : earliest),
          group[0]!.occurredAt,
        );
        const billable = group.filter((row) => row.optionKind !== "included");
        const header: NewSalesTransactionRecord = {
          organizationId: input.organizationId,
          locationId: readUuidOrNull(group[0]!.normalized, "location_id"),
          channelId: readUuidOrNull(group[0]!.normalized, "channel_id"),
          sourceSystem,
          externalTransactionId,
          occurredAt,
          grossAmount: formatDecimal(sumMoney(billable, "gross_amount"), MONEY_SCALE),
          netAmount: formatDecimal(sumMoney(billable, "net_amount"), MONEY_SCALE),
          taxAmount: formatDecimal(sumMoney(billable, "tax_amount"), MONEY_SCALE),
          discountAmount: formatDecimal(sumMoney(billable, "discount_amount"), MONEY_SCALE),
          refundAmount: formatDecimal(sumMoney(billable, "refund_amount"), MONEY_SCALE),
          currency,
          importRunId: run.id,
        };
        transactionId = (await tx.createSalesTransaction(header)).id;
      }
      transactionCount += 1;

      // Idempotency at line grain: reuse a line that already carries the key.
      const existingLines = await tx.listSalesLines({
        organizationId: input.organizationId,
        salesTransactionId: transactionId,
      });
      const lineByExternalId = new Map<string, string>();
      for (const line of existingLines) {
        if (line.externalLineId !== null) {
          lineByExternalId.set(line.externalLineId, line.id);
        }
      }

      // Standalone lines first so an attached/included line can point at its
      // parent, which the schema's `sales_line_option_parent_check` requires.
      const ordered = [...group].sort(
        (left, right) =>
          Number(left.optionKind !== "standalone") - Number(right.optionKind !== "standalone"),
      );
      for (const item of ordered) {
        if (lineByExternalId.has(item.externalLineId)) {
          continue;
        }
        let parentLineId: string | null = null;
        if (item.optionKind !== "standalone") {
          if (item.parentExternalLineId === null) {
            throw new DomainError(
              `option_kind "${item.optionKind}" requires parent_external_line_id (row ${item.row.sourceRowNo})`,
            );
          }
          parentLineId = lineByExternalId.get(item.parentExternalLineId) ?? null;
          if (parentLineId === null) {
            throw new DomainError(
              `parent line ${item.parentExternalLineId} not found for row ${item.row.sourceRowNo}`,
            );
          }
        }
        if (item.optionKind === "included") {
          includedLineCount += 1;
        }
        const line: NewSalesLineRecord = {
          organizationId: input.organizationId,
          salesTransactionId: transactionId,
          productVariantId: readUuidOrNull(item.normalized, "product_variant_id"),
          externalProductRef: readUuidOrNull(item.normalized, "external_product_ref"),
          sku: readUuidOrNull(item.normalized, "sku"),
          externalLineId: item.externalLineId,
          quantity: item.quantity,
          unitPrice: readMoneyOrNull(item.normalized, "unit_price"),
          grossAmount: readMoneyOrNull(item.normalized, "gross_amount"),
          netAmount: readMoneyOrNull(item.normalized, "net_amount"),
          taxAmount: readMoneyOrNull(item.normalized, "tax_amount"),
          appliedTaxRate: readRateOrNull(item.normalized, "applied_tax_rate"),
          discountAmount: readMoneyOrNull(item.normalized, "discount_amount"),
          refundAmount: readMoneyOrNull(item.normalized, "refund_amount"),
          channelId: readUuidOrNull(item.normalized, "channel_id"),
          taxRuleId: readUuidOrNull(item.normalized, "tax_rule_id"),
          parentLineId,
          optionKind: item.optionKind,
          channelFeeBasis: readUuidOrNull(item.normalized, "channel_fee_basis"),
          mappingState: "mapped",
          reversalOfId: null,
        };
        const created = await tx.createSalesLine(line);
        lineByExternalId.set(item.externalLineId, created.id);
      }

      for (const item of group) {
        const lineId = lineByExternalId.get(item.externalLineId);
        if (lineId === undefined) {
          throw new DomainError(`sales line was not created for staging row ${item.row.id}`);
        }
        await tx.updateImportStagingRow(item.row.id, { linkedSalesLineId: lineId });
        postedCount += 1;
      }
    }

    const notPostedCount = rows.length - postedCount;
    const status = notPostedCount === 0 ? "posted" : "partially_posted";

    // `needs_review -> validated -> posted|partially_posted`: the review is
    // closed out by recording dispositions, then the run posts. The transition
    // map has no direct `needs_review -> posted` edge (slice-11 authority).
    if (run.status === "needs_review") {
      assertImportRunStatusTransition(run.status, "validated");
    }
    assertImportRunStatusTransition("validated", status);

    const updated = await tx.updateImportRun(run.id, {
      status,
      rowCounts: { ...run.rowCounts, posted: postedCount, not_posted: notPostedCount },
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: SALES_AUDIT_ACTIONS.importRunPosted,
      entityType: "import_run",
      entityId: run.id,
      after: {
        status: updated.status,
        posted: postedCount,
        not_posted: notPostedCount,
        transaction_count: transactionCount,
        included_line_count: includedLineCount,
      },
    });

    return {
      importRunId: run.id,
      status: updated.status,
      postedCount,
      notPostedCount,
      transactionCount,
      includedLineCount,
    };
  });
}
