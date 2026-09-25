import {
  computeLandedCost,
  DomainError,
  includedTax,
  MONEY_SCALE,
  Money,
  parseDecimal,
  QUANTITY_SCALE,
  Quantity,
  SupplierPack,
  Unit,
} from "@aquarela/domain";
import { TAX_BASIS } from "@aquarela/persistence";

import { resolveTaxRule } from "../tax/resolve-tax-rule";

import { RECEIVING_AUDIT_ACTIONS } from "./actions";
import type { ReceivingStore, ReceivingUnit } from "./types";

/**
 * One receipt line at the trust boundary (M5). `otherAcquisitionCost` is
 * **intentionally absent**: §5 includes it in the landed pack cost, but
 * `goods_receipt_line` has no such column, so accepting it here would compute a
 * cost the receipt cannot persist. Add it (and the column) together.
 */
export interface RecordGoodsReceiptLineInput {
  readonly supplierItemId?: string | null;
  readonly itemId: string;
  readonly receivedPackQty: string;
  readonly acceptedPackQty: string;
  readonly rejectedPackQty?: string;
  /** The pack unit; `packToBaseFactor` converts one pack to the item's base unit. */
  readonly unitId: string;
  readonly packToBaseFactor: string;
  readonly price: string;
  readonly discount?: string;
  readonly taxBasis: string;
  readonly taxCodeId?: string | null;
  /**
   * Tax embedded in `price` that is recoverable. For an inclusive price it may
   * be stated explicitly, **or** resolved from the linked tax rule; supplying
   * both is refused (two authorities for one amount cannot both win). It must
   * be omitted/zero for an exclusive price, which contains no tax. CALCULATION
   * CONTRACT §5 subtracts it; §2 restricts it to a `recoverable` rule.
   */
  readonly recoverableTax?: string;
  /**
   * The channel being priced, when one applies, so `resolveTaxRule` can select
   * a channel-scoped override (`DEC-045` step 2). A resolution input only — it
   * is not stored on the receipt line (there is no column for it).
   */
  readonly channelId?: string | null;
  readonly allocatedFreight?: string;
  readonly importFee?: string;
  readonly lotNumber?: string | null;
  readonly expiryDate?: string | null;
}

export interface RecordGoodsReceiptInput {
  readonly organizationId: string;
  readonly locationId: string;
  /** Accepts the receipt (`accepted_by`) and is recorded on the audit row. */
  readonly actorId: string;
  readonly receivedAt: Date;
  /** Defaults to `receivedAt`; acceptance is recorded at receipt time. */
  readonly acceptedAt?: Date;
  readonly supplierId?: string | null;
  readonly storeName?: string | null;
  readonly purchaseOrderId?: string | null;
  readonly deliveryRef?: string | null;
  readonly evidenceFileId?: string | null;
  readonly currency?: string;
  readonly lines: readonly RecordGoodsReceiptLineInput[];
}

export interface RecordedGoodsReceiptLine {
  readonly goodsReceiptLineId: string;
  readonly priceHistoryKind: "supplier_price" | "cost_observation";
  readonly priceHistoryId: string;
  readonly netPackPrice: string;
  readonly landedPackCost: string;
  readonly baseQtyAccepted: string;
  readonly landedBaseUnitCost: string;
  /**
   * The landed base-unit cost of the supplier-price window that was open before
   * this receipt closed it; null on a first purchase or an ad-hoc observation.
   * Feeds the §8.3 price-variance warning; never affects the recorded cost.
   */
  readonly previousLandedBaseUnitCost: string | null;
}

export interface RecordGoodsReceiptResult {
  readonly goodsReceiptId: string;
  readonly lines: readonly RecordedGoodsReceiptLine[];
}

interface ValidatedLine {
  readonly input: RecordGoodsReceiptLineInput;
  readonly discount: string;
  readonly rejectedPackQty: string;
  readonly allocatedFreight: string;
  readonly importFee: string;
  /** `null` = derive from the linked tax rule in `recordLine` (§5/`PRICE-006`). */
  readonly recoverableTax: string | null;
}

const TAX_BASES: readonly string[] = TAX_BASIS;

function requireNonNegative(value: string, scale: number, label: string): string {
  if (parseDecimal(value, scale) < 0n) {
    throw new DomainError(`${label} must not be negative`);
  }
  return value;
}

/**
 * Validates one line at the trust boundary (before any database work), so a bad
 * quantity, factor, amount or tax basis never opens a transaction. Malformed or
 * over-precise decimals are rejected by `parseDecimal` (`numeric(19,6)`/`(19,4)`).
 */
function validateLine(line: RecordGoodsReceiptLineInput): ValidatedLine {
  if (!TAX_BASES.includes(line.taxBasis)) {
    throw new DomainError(`tax basis must be one of ${TAX_BASES.join(", ")}`);
  }
  const received = parseDecimal(line.receivedPackQty, QUANTITY_SCALE);
  const accepted = parseDecimal(line.acceptedPackQty, QUANTITY_SCALE);
  const rejected = parseDecimal(line.rejectedPackQty ?? "0", QUANTITY_SCALE);
  if (received < 0n) {
    throw new DomainError("receivedPackQty must not be negative");
  }
  if (accepted <= 0n) {
    throw new DomainError("acceptedPackQty must be positive");
  }
  if (rejected < 0n) {
    throw new DomainError("rejectedPackQty must not be negative");
  }
  if (accepted > received) {
    throw new DomainError("acceptedPackQty must not exceed receivedPackQty");
  }
  if (parseDecimal(line.packToBaseFactor, QUANTITY_SCALE) <= 0n) {
    throw new DomainError("packToBaseFactor must be positive");
  }
  requireNonNegative(line.price, MONEY_SCALE, "price");
  const discount = requireNonNegative(line.discount ?? "0", MONEY_SCALE, "discount");
  const allocatedFreight = requireNonNegative(
    line.allocatedFreight ?? "0",
    MONEY_SCALE,
    "allocatedFreight",
  );
  const importFee = requireNonNegative(line.importFee ?? "0", MONEY_SCALE, "importFee");

  // §5 tax-basis handling: the recoverable tax inside an inclusive price is
  // either stated explicitly or resolved from the line's linked tax rule in
  // `recordLine` (`PRICE-006`/`DEC-045`). Supplying both is refused — the rate
  // and an explicit amount are two authorities for one figure, and honoring
  // either silently could store a number the other disagrees with. An exclusive
  // price already excludes tax, so a supplied value is a caller error.
  let recoverableTax: string | null = "0";
  if (line.taxBasis === "inclusive") {
    if (line.recoverableTax !== undefined) {
      if (line.taxCodeId != null) {
        throw new DomainError(
          "recoverableTax must not be supplied alongside a linked tax rule (taxCodeId) for an inclusive price: the resolved rate and an explicit amount cannot both be authoritative (CALCULATION_CONTRACT §5)",
        );
      }
      recoverableTax = requireNonNegative(line.recoverableTax, MONEY_SCALE, "recoverableTax");
    } else if (line.taxCodeId == null) {
      throw new DomainError(
        "recoverableTax is required for an inclusive price with no linked tax rule (taxCodeId): supply recoverableTax or link a tax rule (CALCULATION_CONTRACT §5)",
      );
    } else {
      // Resolve the rate from the linked rule inside the transaction.
      recoverableTax = null;
    }
  } else if (
    line.recoverableTax !== undefined &&
    parseDecimal(line.recoverableTax, MONEY_SCALE) !== 0n
  ) {
    throw new DomainError("recoverableTax must not be supplied for an exclusive price");
  }

  return {
    input: line,
    discount,
    rejectedPackQty: line.rejectedPackQty ?? "0",
    allocatedFreight,
    importFee,
    recoverableTax,
  };
}

function toDomainUnit(unit: ReceivingUnit): Unit {
  return Unit.from(unit.code, unit.dimension, unit.isBase);
}

interface LineContext {
  readonly organizationId: string;
  readonly receiptId: string;
  readonly supplierId: string | null;
  readonly storeName: string | null;
  readonly evidenceFileId: string | null;
  readonly currency: string;
  readonly receivedAt: Date;
}

/** What tax resolution needs, known before the receipt row exists. */
interface TaxContext {
  readonly organizationId: string;
  readonly locationId: string;
  readonly receivedAt: Date;
}

/**
 * Derives an inclusive line's recoverable tax from its linked tax rule
 * (`PRICE-006`/`DEC-045`): resolve the effective rate, then take the tax
 * embedded in the gross price at that rate using the domain's §5 inclusive-basis
 * primitive (`includedTax` — decimal only, HALF_UP at the money boundary). A
 * non-`recoverable` rule yields `0`: the input VAT is a cost, not recoverable
 * (`CALCULATION_CONTRACT §2`). The resolver fails closed, so a missing or
 * ambiguous rule surfaces as its `DomainError` rather than a guessed rate.
 */
async function resolveRecoverableTax(
  tx: ReceivingStore,
  ctx: TaxContext,
  line: ValidatedLine,
): Promise<string> {
  const taxCodeId = line.input.taxCodeId;
  if (taxCodeId == null) {
    // `validateLine` leaves `null` only for an inclusive line with a linked rule.
    throw new DomainError("an inclusive price requires a linked tax rule (taxCodeId) to resolve");
  }
  const resolved = await resolveTaxRule(tx, {
    organizationId: ctx.organizationId,
    asOf: ctx.receivedAt,
    itemTaxRuleId: taxCodeId,
    locationId: ctx.locationId,
    ...(line.input.channelId == null ? {} : { channelId: line.input.channelId }),
  });
  return resolved.rule.recoverable ? includedTax(line.input.price, resolved.ratePct) : "0";
}

/**
 * Computes the landed cost, inserts the line, then appends the price history
 * (DEC-047 precedence: a real supplier item gets an effective-dated
 * `supplier_price`; anything else gets a `cost_observation`).
 */
async function recordLine(
  tx: ReceivingStore,
  ctx: LineContext,
  line: ValidatedLine,
  recoverableTax: string,
): Promise<RecordedGoodsReceiptLine> {
  const item = await tx.findItem(line.input.itemId);
  if (item === undefined || item.organizationId !== ctx.organizationId) {
    throw new DomainError("item not found in organization");
  }
  const packUnitRow = await tx.findUnit(line.input.unitId);
  if (packUnitRow === undefined) {
    throw new DomainError("pack unit not found");
  }
  const baseUnitRow = await tx.findUnit(item.baseUnitId);
  if (baseUnitRow === undefined) {
    throw new DomainError("item base unit not found");
  }

  const packUnit = toDomainUnit(packUnitRow);
  const baseUnit = toDomainUnit(baseUnitRow);
  const pack = SupplierPack.from(packUnit, baseUnit, line.input.packToBaseFactor);
  const acceptedPackQuantity = Quantity.from(line.input.acceptedPackQty, packUnit.code);

  const cost = computeLandedCost({
    grossPackPrice: line.input.price,
    discount: line.discount,
    recoverableTax,
    allocatedFreight: line.allocatedFreight,
    importFee: line.importFee,
    currency: ctx.currency,
    acceptedPackQuantity,
    pack,
  });

  const createdLine = await tx.createGoodsReceiptLine({
    goodsReceiptId: ctx.receiptId,
    supplierItemId: line.input.supplierItemId ?? null,
    itemId: line.input.itemId,
    receivedPackQty: line.input.receivedPackQty,
    acceptedPackQty: line.input.acceptedPackQty,
    rejectedPackQty: line.rejectedPackQty,
    unitId: line.input.unitId,
    packToBaseFactor: line.input.packToBaseFactor,
    price: line.input.price,
    discount: line.discount,
    taxBasis: line.input.taxBasis,
    taxCodeId: line.input.taxCodeId ?? null,
    allocatedFreight: line.allocatedFreight,
    importFee: line.importFee,
    lotNumber: line.input.lotNumber ?? null,
    expiryDate: line.input.expiryDate ?? null,
    baseQtyAccepted: cost.baseUnitsReceived,
    landedBaseUnitCost: cost.landedBaseUnitCost,
  });

  const history = await appendPriceHistory(tx, ctx, line, cost, baseUnitRow.id);
  return {
    goodsReceiptLineId: createdLine.id,
    ...history,
    netPackPrice: cost.netPackPrice,
    landedPackCost: cost.landedPackCost,
    baseQtyAccepted: cost.baseUnitsReceived,
    landedBaseUnitCost: cost.landedBaseUnitCost,
  };
}

async function appendPriceHistory(
  tx: ReceivingStore,
  ctx: LineContext,
  line: ValidatedLine,
  cost: { netPackPrice: string; landedPackCost: string; landedBaseUnitCost: string },
  baseUnitId: string,
): Promise<{
  priceHistoryKind: "supplier_price" | "cost_observation";
  priceHistoryId: string;
  previousLandedBaseUnitCost: string | null;
}> {
  const supplierItemId = line.input.supplierItemId ?? null;

  if (supplierItemId !== null) {
    const supplierItem = await tx.findSupplierItem(supplierItemId);
    if (supplierItem === undefined || supplierItem.organizationId !== ctx.organizationId) {
      throw new DomainError("supplier item not found in organization");
    }
    if (supplierItem.itemId !== line.input.itemId) {
      throw new DomainError("supplier item does not match the received item");
    }
    if (ctx.supplierId === null || supplierItem.supplierId !== ctx.supplierId) {
      throw new DomainError("supplier item does not belong to the receipt supplier");
    }

    // Read the window that is about to close, for the §8.3 price variance, then
    // close it before appending so `supplier_price_no_overlap` cannot reject us.
    const previous = await tx.findOpenSupplierPrice(supplierItem.id);
    await tx.closeOpenSupplierPrices(supplierItem.id, ctx.receivedAt);
    const price = await tx.createSupplierPrice({
      organizationId: ctx.organizationId,
      supplierItemId: supplierItem.id,
      grossPackPrice: line.input.price,
      discount: line.discount,
      taxBasis: line.input.taxBasis,
      taxRuleId: line.input.taxCodeId ?? null,
      allocatedFreight: line.allocatedFreight,
      importFee: line.importFee,
      otherCost: "0",
      netPackPrice: cost.netPackPrice,
      landedPackCost: cost.landedPackCost,
      landedBaseUnitCost: cost.landedBaseUnitCost,
      currency: ctx.currency,
      sourceReceiptId: ctx.receiptId,
      effectiveFrom: ctx.receivedAt,
      effectiveTo: null,
    });
    return {
      priceHistoryKind: "supplier_price",
      priceHistoryId: price.id,
      previousLandedBaseUnitCost: previous?.landedBaseUnitCost ?? null,
    };
  }

  const observation = await tx.createCostObservation({
    organizationId: ctx.organizationId,
    itemId: line.input.itemId,
    storeName: ctx.storeName,
    observedAt: ctx.receivedAt.toISOString().slice(0, 10),
    // Pack size in the item's base unit, so `pack_price / pack_size` is a
    // self-contained base-unit cost (DEC-047) with no conversion lookup.
    packSize: line.input.packToBaseFactor,
    packUnitId: baseUnitId,
    packPrice: line.input.price,
    currency: ctx.currency,
    source: "receipt",
    receiptFileId: ctx.evidenceFileId,
    notes: `tax basis: ${line.input.taxBasis}`,
  });
  return {
    priceHistoryKind: "cost_observation",
    priceHistoryId: observation.id,
    previousLandedBaseUnitCost: null,
  };
}

/**
 * Records an accepted goods receipt (PROC-002): validates the lines at the trust
 * boundary, computes each line's landed base-unit cost (§5, B1), and appends the
 * price history plus an audit row in one transaction. Stock movements are **not**
 * posted: that is the inventory slice (slice 8), gated on `ADR-0005` (Proposed).
 */
export async function recordGoodsReceipt(
  store: ReceivingStore,
  input: RecordGoodsReceiptInput,
): Promise<RecordGoodsReceiptResult> {
  if (input.lines.length === 0) {
    throw new DomainError("a goods receipt requires at least one line");
  }
  const validated = input.lines.map(validateLine);
  // Validate the currency before opening the transaction.
  const currency = Money.from("0", input.currency ?? "NOK").currency;
  const supplierId = input.supplierId ?? null;
  const storeName = input.storeName ?? null;
  const acceptedAt = input.acceptedAt ?? input.receivedAt;

  return store.withTransaction(async (tx) => {
    if (supplierId !== null) {
      const supplier = await tx.findSupplier(supplierId);
      if (supplier === undefined || supplier.organizationId !== input.organizationId) {
        throw new DomainError("supplier not found in organization");
      }
    }

    // Resolve every inclusive line's recoverable tax before any insert, so an
    // unresolvable rule refuses without leaving a receipt behind.
    const taxCtx: TaxContext = {
      organizationId: input.organizationId,
      locationId: input.locationId,
      receivedAt: input.receivedAt,
    };
    const recoverableTaxes: string[] = [];
    for (const line of validated) {
      recoverableTaxes.push(line.recoverableTax ?? (await resolveRecoverableTax(tx, taxCtx, line)));
    }

    const receipt = await tx.createGoodsReceipt({
      organizationId: input.organizationId,
      supplierId,
      storeName,
      locationId: input.locationId,
      purchaseOrderId: input.purchaseOrderId ?? null,
      deliveryRef: input.deliveryRef ?? null,
      receivedAt: input.receivedAt,
      status: "accepted",
      acceptedBy: input.actorId,
      acceptedAt,
      evidenceFileId: input.evidenceFileId ?? null,
    });

    const ctx: LineContext = {
      organizationId: input.organizationId,
      receiptId: receipt.id,
      supplierId,
      storeName,
      evidenceFileId: input.evidenceFileId ?? null,
      currency,
      receivedAt: input.receivedAt,
    };

    const lines: RecordedGoodsReceiptLine[] = [];
    for (const [index, line] of validated.entries()) {
      lines.push(await recordLine(tx, ctx, line, recoverableTaxes[index]!));
    }

    // Sum of line price × received pack quantity (money scale, HALF_UP), so an
    // auditor can reconcile the receipt without joining the lines. A fixed
    // derived number — no secret, no free text.
    const grossTotal = validated.reduce(
      (total, line) =>
        total.add(Money.from(line.input.price, currency).multiply(line.input.receivedPackQty)),
      Money.zero(currency),
    );

    // Fixed, non-secret fields only, so the audit row is secret-safe by
    // construction (mirrors the auth audit convention without duplicating it).
    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: RECEIVING_AUDIT_ACTIONS.receiptRecorded,
      entityType: "goods_receipt",
      entityId: receipt.id,
      after: { status: "accepted", lineCount: lines.length, gross_total: grossTotal.toString() },
    });

    return { goodsReceiptId: receipt.id, lines };
  });
}
