import { divideRoundHalfUp, formatDecimal, parseDecimal } from "./decimal";
import { DomainError } from "./errors";
import { MONEY_SCALE, Money } from "./money";
import { QUANTITY_SCALE, Quantity } from "./quantity";
import { SupplierPack } from "./supplier-pack";

/**
 * Supplier pack landed cost (PROC-003, CALCULATION_CONTRACT §5):
 *
 * ```
 * net_pack_price        = gross_pack_price − recoverable_tax − discount
 * landed_pack_cost      = net_pack_price + allocated_freight + import_fee + other_acquisition_cost
 * base_units_received   = accepted_pack_quantity × pack_to_base_unit_factor
 * landed_base_unit_cost = round(landed_pack_cost / base_units_received, 4 dp, HALF_UP)   # B1
 * ```
 *
 * Decimal only (never floats). `recoverableTax` is a **required input, not
 * derived here**: §5 subtracts "recoverable_tax" but does not define how it is
 * resolved from `tax_basis` + the tax code's rate/`recoverable` flag. That
 * resolution is left to the caller and remains an owner/accountant decision, so
 * this function never guesses it. See `recordGoodsReceipt` for the strict
 * boundary rule (an inclusive price requires an explicit recoverable tax).
 */
export interface LandedCostInput {
  readonly grossPackPrice: string;
  readonly discount?: string;
  /** Tax embedded in `grossPackPrice` that is recoverable; supply in full when the basis is inclusive. */
  readonly recoverableTax: string;
  readonly allocatedFreight?: string;
  readonly importFee?: string;
  readonly otherAcquisitionCost?: string;
  readonly currency: string;
  /** Accepted pack quantity, in the pack's unit (`accepted_pack_quantity`). */
  readonly acceptedPackQuantity: Quantity;
  /** The pack conversion (`1 pack = factor × base unit`). */
  readonly pack: SupplierPack;
}

export interface LandedCost {
  readonly netPackPrice: string;
  readonly landedPackCost: string;
  readonly baseUnitsReceived: string;
  readonly landedBaseUnitCost: string;
}

export function computeLandedCost(input: LandedCostInput): LandedCost {
  const money = (value: string | undefined): Money =>
    value === undefined ? Money.zero(input.currency) : Money.from(value, input.currency);

  const netPackPrice = money(input.grossPackPrice)
    .subtract(Money.from(input.recoverableTax, input.currency))
    .subtract(money(input.discount));

  // §5 has no negative net pack price: a `discount` greater than the price (or a
  // recoverable tax larger than it) is a caller error, not a cost. Fail at the
  // trust boundary rather than returning a number only the DB would reject.
  if (netPackPrice.compare(Money.zero(input.currency)) < 0) {
    throw new DomainError("net pack price must not be negative");
  }

  const landedPackCost = netPackPrice
    .add(money(input.allocatedFreight))
    .add(money(input.importFee))
    .add(money(input.otherAcquisitionCost));

  // Rejects a non-positive accepted quantity and a `base_units_received <= 0`.
  const baseUnitsReceived = input.pack.baseUnitsReceived(input.acceptedPackQuantity);

  // landed_pack_cost (4 dp) ÷ base_units_received (6 dp), rounded once at B1
  // (4 dp, HALF_UP): scaled to `quotient × 10^4` = landedUnits × 10^6 ÷ baseUnits.
  const landedUnits = parseDecimal(landedPackCost.toString(), MONEY_SCALE);
  const baseUnits = parseDecimal(baseUnitsReceived.toString(), QUANTITY_SCALE);
  const landedBaseUnitCost = formatDecimal(
    divideRoundHalfUp(landedUnits * 10n ** BigInt(QUANTITY_SCALE), baseUnits),
    MONEY_SCALE,
  );

  return {
    netPackPrice: netPackPrice.toString(),
    landedPackCost: landedPackCost.toString(),
    baseUnitsReceived: baseUnitsReceived.toString(),
    landedBaseUnitCost,
  };
}
