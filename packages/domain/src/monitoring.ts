import { parseDecimal } from "./decimal";
import { DomainError } from "./errors";
import { QUANTITY_SCALE } from "./quantity";

/**
 * HMS monitoring point reading in range (slice 19a; `DEC-089`, `HMS-002`).
 *
 * A reading is in range when it lies on or between the point's target bounds —
 * bounds are **inclusive**, so a fridge at exactly `4.0 °C` is within a
 * `0…4 °C` target. Values, `target_min` and `target_max` are stored at quantity
 * scale (`numeric(19,6)`) and compared as scaled integers: decimal only, never
 * floats (`13_AGENT_BUILD_BRIEF.md`). A point whose minimum exceeds its maximum
 * is misconfigured, so it is rejected rather than silently reporting every
 * reading out of range.
 */
export function isReadingInRange(value: string, targetMin: string, targetMax: string): boolean {
  const reading = parseDecimal(value, QUANTITY_SCALE);
  const min = parseDecimal(targetMin, QUANTITY_SCALE);
  const max = parseDecimal(targetMax, QUANTITY_SCALE);
  if (min > max) {
    throw new DomainError(
      `monitoring target range is inverted: targetMin ${targetMin} > targetMax ${targetMax}`,
    );
  }
  return reading >= min && reading <= max;
}
