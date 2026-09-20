import {
  DomainError,
  MONEY_SCALE,
  QUANTITY_SCALE,
  formatDecimal,
  parseDecimal,
} from "@aquarela/domain";

import { isBlank } from "../imports/validation";

import { SALES_AUDIT_ACTIONS } from "./actions";
import type { NewSalesLineRecord, SalesLineRecord, SalesStore } from "./types";

export interface ReverseSalesLineInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly salesLineId: string;
  /** Mandatory; recorded in the audit (`DEC-073`). */
  readonly reasonCode: string;
}

export interface ReverseSalesLineResult {
  /** The new, negated `sales_line`; the original is never edited or deleted. */
  readonly reversalSalesLineId: string;
}

/** The exact negation of a nullable money/rate decimal, or null when absent. */
function negateMoney(value: string | null): string | null {
  return value === null ? null : formatDecimal(-parseDecimal(value, MONEY_SCALE), MONEY_SCALE);
}

/** The exact negation of a `numeric(19,6)` quantity. */
function negateQuantity(value: string): string {
  return formatDecimal(-parseDecimal(value, QUANTITY_SCALE), QUANTITY_SCALE);
}

function reversalLine(line: SalesLineRecord, organizationId: string): NewSalesLineRecord {
  return {
    organizationId,
    salesTransactionId: line.salesTransactionId,
    // Identity and classification are copied verbatim; only the quantities and
    // money fields are negated (`DEC-073`).
    productVariantId: line.productVariantId,
    externalProductRef: line.externalProductRef,
    sku: line.sku,
    // Null so the `(sales_transaction_id, external_line_id)` unique key is not
    // violated: the reversal is a new line, not a replay of the source line.
    externalLineId: null,
    quantity: negateQuantity(line.quantity),
    unitPrice: negateMoney(line.unitPrice),
    grossAmount: negateMoney(line.grossAmount),
    netAmount: negateMoney(line.netAmount),
    taxAmount: negateMoney(line.taxAmount),
    appliedTaxRate: line.appliedTaxRate,
    discountAmount: negateMoney(line.discountAmount),
    refundAmount: negateMoney(line.refundAmount),
    channelId: line.channelId,
    taxRuleId: line.taxRuleId,
    parentLineId: line.parentLineId,
    optionKind: line.optionKind,
    channelFeeBasis: line.channelFeeBasis,
    mappingState: line.mappingState,
    reversalOfId: line.id,
  };
}

/**
 * Reverses one `sales_line` (`DEC-028`/`DEC-073`): a **new** line in the same
 * transaction whose quantity and every money field are the exact negation of the
 * original and whose `reversal_of_id` references it. The original is never edited
 * or deleted. A reversal line cannot itself be reversed, and a line that already
 * has a reversal is rejected — idempotency is not a silent replay.
 *
 * `reasonCode` is mandatory and recorded in the audit. Theoretical-consumption
 * movements posted for the line are reversed separately through the inventory
 * `reverseStockMovement` primitive; **no stock is posted here**.
 */
export async function reverseSalesLine(
  store: SalesStore,
  input: ReverseSalesLineInput,
): Promise<ReverseSalesLineResult> {
  if (isBlank(input.reasonCode)) {
    throw new DomainError("reasonCode is required for a reversal");
  }
  const salesLineId = input.salesLineId.trim();

  return store.withTransaction(async (tx) => {
    const line = await tx.findSalesLine({
      organizationId: input.organizationId,
      salesLineId,
    });
    if (line === undefined || line.organizationId !== input.organizationId) {
      throw new DomainError("sales line not found in organization");
    }
    if (line.reversalOfId !== null) {
      throw new DomainError("a reversal line cannot itself be reversed");
    }
    const existing = await tx.findSalesLineReversal({
      organizationId: input.organizationId,
      salesLineId: line.id,
    });
    if (existing !== undefined) {
      throw new DomainError("sales line already reversed");
    }

    // The pre-check above is best-effort; the partial unique index
    // `sales_line_reversal_of_id_key` (migration `0026`) is the race-safe
    // backstop, so a concurrent reversal of the same line fails at this insert.
    const reversal = await tx.createSalesLine(reversalLine(line, input.organizationId));

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: SALES_AUDIT_ACTIONS.salesLineReversed,
      entityType: "sales_line",
      entityId: reversal.id,
      after: {
        reversal_of_id: line.id,
        reason_code: input.reasonCode,
        sales_line_id: reversal.id,
      },
    });

    return { reversalSalesLineId: reversal.id };
  });
}
