import { formatDecimal, parseDecimal } from "./decimal";
import { DomainError } from "./errors";
import { QUANTITY_SCALE, Quantity } from "./quantity";
import { areUnitsConvertible, Unit } from "./unit";

/** `pack_to_base_unit_factor` is `numeric(19,6)`, like quantity (`DATA_DICTIONARY` §2). */
const FACTOR_SCALE = 6;

/**
 * A supplier pack conversion (PROC-001): `1 pack = N base units`, with `N` the
 * `pack_to_base_unit_factor`. It carries no price, tax or cost policy — landed cost
 * (PROC-003, CALCULATION_CONTRACT §5) is applied on top by later slices.
 */
export class SupplierPack {
  readonly packUnit: Unit;
  readonly baseUnit: Unit;
  readonly #factor: bigint;

  private constructor(packUnit: Unit, baseUnit: Unit, factor: bigint) {
    this.packUnit = packUnit;
    this.baseUnit = baseUnit;
    this.#factor = factor;
  }

  static from(packUnit: Unit, baseUnit: Unit, packToBaseUnitFactor: string): SupplierPack {
    // "dimension must match unless package↔base" (DATA_DICTIONARY §2,
    // unit_conversion): a cross-dimension pack must resolve to the *base* unit of
    // the other dimension, so `pack → kg` is rejected (kg is not `is_base`; g is).
    if (!areUnitsConvertible(packUnit, baseUnit)) {
      throw new DomainError(
        `incompatible pack dimensions: ${packUnit.dimension} vs ${baseUnit.dimension}`,
      );
    }
    const factor = parseDecimal(packToBaseUnitFactor, FACTOR_SCALE);
    if (factor <= 0n) {
      throw new DomainError(
        `pack-to-base-unit factor must be positive, got "${packToBaseUnitFactor}"`,
      );
    }
    return new SupplierPack(packUnit, baseUnit, factor);
  }

  /** Canonical factor, always at factor scale (e.g. `"1000.000000"`). */
  get factor(): string {
    return formatDecimal(this.#factor, FACTOR_SCALE);
  }

  /**
   * `base_units_received = accepted_pack_quantity × pack_to_base_unit_factor`
   * (CALCULATION_CONTRACT §5), rounded HALF_UP at quantity scale. Rejects a
   * non-positive accepted quantity, as the contract rejects `base_units_received <= 0`.
   */
  baseUnitsReceived(acceptedPackQuantity: Quantity): Quantity {
    if (acceptedPackQuantity.unit !== this.packUnit.code) {
      throw new DomainError(
        `pack quantity unit "${acceptedPackQuantity.unit}" does not match pack unit "${this.packUnit.code}"`,
      );
    }
    const baseUnits = Quantity.from(
      acceptedPackQuantity.multiply(this.factor).toString(),
      this.baseUnit.code,
    );
    if (parseDecimal(baseUnits.toString(), QUANTITY_SCALE) <= 0n) {
      throw new DomainError("base units received must be positive");
    }
    return baseUnits;
  }

  toJSON(): { packUnit: string; baseUnit: string; factor: string } {
    return { packUnit: this.packUnit.code, baseUnit: this.baseUnit.code, factor: this.factor };
  }
}
