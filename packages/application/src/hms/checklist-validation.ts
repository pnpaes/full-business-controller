import { DomainError } from "@aquarela/domain";
import { CHECKLIST_ITEM_OUTCOME } from "@aquarela/persistence";

import { isBlank } from "../inventory/validation";

/**
 * Shared shape validation for the `DEC-091`/`DEC-096` (`HMS-005`) checklist
 * jsonb columns. Both are database-checked to be jsonb arrays
 * (`checklist_template_items_array_check`, `checklist_run_results_array_check`),
 * but the per-element shape is not, so the commands validate it here first and
 * callers see one error class (`DomainError`) naming the offending index and
 * field rather than a driver constraint violation.
 *
 * The shape is provisional (`DEC-096`): an item is `{ key, label, required? }`
 * and a result is `{ key, outcome, note? }`. Extra keys pass through untouched,
 * so a later widening of the shape does not require changing this module.
 * Keeping both validators in one place stops the four checklist commands
 * drifting apart.
 */

/** The per-item `outcome` vocabulary (`CHECKLIST_ITEM_OUTCOME`). */
export const CHECKLIST_ITEM_OUTCOMES: readonly string[] = CHECKLIST_ITEM_OUTCOME;

/**
 * The ceiling on the `items`/`results` jsonb arrays. One shared constant so the
 * bound is greppable and the two validators cannot drift apart; it caps the
 * stored document size, not the business meaning of a checklist.
 */
export const CHECKLIST_ARRAY_MAX = 500;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `items` must be a JSON array; each element an object with a non-empty string
 * `key` and `label`; an optional `required` must be a boolean when present.
 */
export function assertChecklistItems(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new DomainError("items must be a JSON array");
  }
  if (value.length > CHECKLIST_ARRAY_MAX) {
    throw new DomainError(`items must hold at most ${CHECKLIST_ARRAY_MAX} elements`);
  }
  value.forEach((item, index) => {
    const at = `items[${index}]`;
    if (!isPlainObject(item)) {
      throw new DomainError(`${at} must be an object`);
    }
    if (typeof item.key !== "string" || isBlank(item.key)) {
      throw new DomainError(`${at}.key is required`);
    }
    if (typeof item.label !== "string" || isBlank(item.label)) {
      throw new DomainError(`${at}.label is required`);
    }
    if (item.required !== undefined && typeof item.required !== "boolean") {
      throw new DomainError(`${at}.required must be a boolean`);
    }
  });
}

/**
 * `results` must be a JSON array; each element an object with a non-empty string
 * `key` and an `outcome` in `CHECKLIST_ITEM_OUTCOME`; an optional `note` must be
 * a string when present. A non-conformity is simply a `fail` outcome
 * (`DEC-096`), so no other value is singled out.
 */
export function assertChecklistResults(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new DomainError("results must be a JSON array");
  }
  if (value.length > CHECKLIST_ARRAY_MAX) {
    throw new DomainError(`results must hold at most ${CHECKLIST_ARRAY_MAX} elements`);
  }
  value.forEach((result, index) => {
    const at = `results[${index}]`;
    if (!isPlainObject(result)) {
      throw new DomainError(`${at} must be an object`);
    }
    if (typeof result.key !== "string" || isBlank(result.key)) {
      throw new DomainError(`${at}.key is required`);
    }
    if (typeof result.outcome !== "string" || !CHECKLIST_ITEM_OUTCOMES.includes(result.outcome)) {
      throw new DomainError(`${at}.outcome must be one of ${CHECKLIST_ITEM_OUTCOMES.join(", ")}`);
    }
    if (result.note !== undefined && typeof result.note !== "string") {
      throw new DomainError(`${at}.note must be a string`);
    }
  });
}

/**
 * Every `results[i].key` must name an item of the template being walked: a run
 * records answers, so a result key outside the template is a mismatch, not a new
 * item. `items`/`results` are validated for shape separately; this only compares
 * the key sets and names the offending key. It does not require completeness — a
 * `completed` run may still omit an item's result (`DEC-096`, open point).
 */
export function assertChecklistResultKeys(results: unknown, items: unknown): void {
  if (!Array.isArray(results) || !Array.isArray(items)) {
    return;
  }
  const itemKeys = new Set<string>();
  for (const item of items) {
    if (isPlainObject(item) && typeof item.key === "string") {
      itemKeys.add(item.key);
    }
  }
  results.forEach((result, index) => {
    if (isPlainObject(result) && typeof result.key === "string" && !itemKeys.has(result.key)) {
      throw new DomainError(`results[${index}].key "${result.key}" is not an item of the template`);
    }
  });
}
