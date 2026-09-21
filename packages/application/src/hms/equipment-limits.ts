import { DomainError } from "@aquarela/domain";

/**
 * Field ceilings for the HMS equipment register (`HMS-006`, `DEC-092`).
 *
 * The web parsers bound `code`/`name`/`kind`/`serialNo`, but the command is the
 * contract boundary: a direct application caller (the worker, a script, a future
 * non-HTTP adapter) bypasses the parser, so the same ceilings are enforced in
 * `registerEquipment`/`updateEquipment` and rejected as a `DomainError` naming
 * the field and its limit. Both layers import these constants, so the numbers
 * cannot drift apart silently.
 */

/** Ceiling for the register key `code` (`equipment.code`). */
export const EQUIPMENT_CODE_MAX = 64;

/** Ceiling for `equipment.name`. */
export const EQUIPMENT_NAME_MAX = 200;

/**
 * Ceiling for the free-text `equipment.kind` (`DEC-092` names no vocabulary).
 * The maintenance-log `kind` — a closed vocabulary whose longest member is far
 * shorter — reuses the same sanity bound in the web parser.
 */
export const EQUIPMENT_KIND_MAX = 32;

/** Ceiling for the optional `equipment.serial_no`. */
export const EQUIPMENT_SERIAL_MAX = 200;

/** Rejects `value` when it is longer than `max`, naming the field and the limit. */
export function assertMaxLength(value: string, max: number, field: string): void {
  if (value.length > max) {
    throw new DomainError(`${field} must be at most ${max} characters`);
  }
}
