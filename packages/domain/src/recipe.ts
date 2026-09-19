import { divideRoundHalfUp, formatDecimal, parseDecimal } from "./decimal";
import { DomainError } from "./errors";
import { MONEY_SCALE, Money } from "./money";
import { QUANTITY_SCALE } from "./quantity";

/**
 * Recipe quantity and yield (COST-001/002, CALCULATION_CONTRACT §6):
 *
 * ```
 * usable_yield_rate          = approved_usable_output / planned_input        # ∈ (0,1]
 * effective_line_qty         = recipe_line.quantity / loss_factor
 * required_purchase_quantity = round(effective_line_qty / usable_yield_rate, 6 dp)   # B0
 * line_cost                  = round(required_purchase_quantity × selected_base_unit_cost, 4 dp)  # B2
 * ```
 *
 * Batch:
 *
 * ```
 * recipe_input_cost           = Σ line_cost
 * recipe_output_cost          = recipe_input_cost + direct_batch_labor + batch_variable_cost
 * cost_per_usable_output_unit = round(recipe_output_cost / approved_usable_output, 4 dp)  # B3
 * ```
 *
 * Decimal only (never floats); HALF_UP once at each named boundary (B0, B2, B3;
 * DEC-024). The functions here are pure: base-unit conversion, cost-source
 * selection (DEC-047) and sub-recipe recursion live in the application layer and
 * feed already-converted, already-selected inputs in.
 */

/** Recipe version states; mirrors `document_status` (`schemas/domain-enums.yaml`). */
export const RECIPE_VERSION_STATES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "retired",
] as const;

export type RecipeVersionState = (typeof RECIPE_VERSION_STATES)[number];

/** Rate/ratio scale (`numeric(9,6)`), as `unit_conversion.factor` and yields use. */
const RATE_SCALE = 6;
const RATE_ONE = 10n ** BigInt(RATE_SCALE);

function assertKnownState(state: string): asserts state is RecipeVersionState {
  if (!(RECIPE_VERSION_STATES as readonly string[]).includes(state)) {
    throw new DomainError(`unknown recipe version state "${state}"`);
  }
}

/**
 * `usable_yield_rate = approved_usable_output / planned_input`, at 6 dp
 * HALF_UP. The contract defines the rate from the two quantities (§6), so this
 * is the value to persist in `recipe_version.yield_rate`; an input ratio above 1
 * is rejected because §6 bounds the rate to `(0,1]`.
 */
export function usableYieldRate(plannedInputQty: string, approvedUsableOutput: string): string {
  const input = parseDecimal(plannedInputQty, QUANTITY_SCALE);
  const output = parseDecimal(approvedUsableOutput, QUANTITY_SCALE);
  if (input <= 0n) {
    throw new DomainError("plannedInputQty must be positive");
  }
  if (output <= 0n) {
    throw new DomainError("approvedUsableOutput must be positive (CALCULATION_CONTRACT §12.2)");
  }
  const rate = divideRoundHalfUp(output * RATE_ONE, input);
  if (rate <= 0n) {
    throw new DomainError("usable yield rate must be positive");
  }
  if (rate > RATE_ONE) {
    throw new DomainError(
      "usable yield rate must not exceed 1 (approvedUsableOutput <= plannedInputQty)",
    );
  }
  return formatDecimal(rate, RATE_SCALE);
}

/**
 * `required_purchase_quantity = round((quantity / loss_factor) / usable_yield_rate, 6 dp)`
 * (B0). The two divisions are combined into one HALF_UP rounding, so the
 * boundary is crossed exactly once. `lossFactor` and `usableYieldRate` are both
 * in `(0,1]`.
 */
export function requiredPurchaseQuantity(
  quantity: string,
  lossFactor: string,
  yieldRate: string,
): string {
  const qty = parseDecimal(quantity, QUANTITY_SCALE);
  const loss = parseDecimal(lossFactor, RATE_SCALE);
  const rate = parseDecimal(yieldRate, RATE_SCALE);
  if (qty <= 0n) {
    throw new DomainError("recipe line quantity must be positive");
  }
  if (loss <= 0n || loss > RATE_ONE) {
    throw new DomainError("lossFactor must be in (0,1]");
  }
  if (rate <= 0n || rate > RATE_ONE) {
    throw new DomainError("usable yield rate must be in (0,1]");
  }
  // qty (6 dp) / loss / rate, scaled back to 6 dp in one HALF_UP step.
  const required = divideRoundHalfUp(qty * RATE_ONE * RATE_ONE, loss * rate);
  if (required <= 0n) {
    throw new DomainError("required purchase quantity rounds to zero and is unusable");
  }
  return formatDecimal(required, QUANTITY_SCALE);
}

/** `line_cost = round(required_purchase_quantity × selected_base_unit_cost, 4 dp)` (B2). */
export function lineCost(
  requiredQuantity: string,
  selectedBaseUnitCost: string,
  currency: string,
): string {
  const cost = Money.from(selectedBaseUnitCost, currency);
  if (cost.compare(Money.zero(currency)) < 0) {
    throw new DomainError("selected base unit cost must not be negative");
  }
  return cost.multiply(requiredQuantity).toString();
}

export interface RecipeCostLine {
  /** B2 line cost, already at money scale (4 dp). */
  readonly lineCost: string;
}

export interface ComputeRecipeCostInput {
  readonly currency: string;
  readonly lines: readonly RecipeCostLine[];
  readonly approvedUsableOutput: string;
  /** Labor is slice 6; defaults to zero so slice 5 costs ingredients only. */
  readonly directBatchLabor?: string;
  readonly batchVariableCost?: string;
}

export interface RecipeCost {
  readonly recipeInputCost: string;
  readonly recipeOutputCost: string;
  readonly costPerUsableOutputUnit: string;
}

/**
 * Sums the line costs into `recipe_input_cost`, adds the optional batch labor /
 * variable cost into `recipe_output_cost`, and derives
 * `cost_per_usable_output_unit` at B3 (4 dp HALF_UP). Rejects a non-positive
 * `approvedUsableOutput` (§12.2).
 */
export function computeRecipeCost(input: ComputeRecipeCostInput): RecipeCost {
  const currency = Money.from("0", input.currency).currency;
  const money = (value: string | undefined): Money =>
    value === undefined ? Money.zero(currency) : Money.from(value, currency);

  const recipeInputCost = input.lines.reduce(
    (total, line) => total.add(Money.from(line.lineCost, currency)),
    Money.zero(currency),
  );
  const recipeOutputCost = recipeInputCost
    .add(money(input.directBatchLabor))
    .add(money(input.batchVariableCost));

  const output = parseDecimal(input.approvedUsableOutput, QUANTITY_SCALE);
  if (output <= 0n) {
    throw new DomainError("approvedUsableOutput must be positive (CALCULATION_CONTRACT §12.2)");
  }
  const outputUnits = parseDecimal(recipeOutputCost.toString(), MONEY_SCALE);
  const perUnit = formatDecimal(divideRoundHalfUp(outputUnits * RATE_ONE, output), MONEY_SCALE);

  return {
    recipeInputCost: recipeInputCost.toString(),
    recipeOutputCost: recipeOutputCost.toString(),
    costPerUsableOutputUnit: perUnit,
  };
}

/** A resolved sub-recipe dependency: a line in `parentRecipeId` consumes `childRecipeId`. */
export interface RecipeDependencyEdge {
  readonly parentRecipeId: string;
  readonly childRecipeId: string;
}

/**
 * Rejects self-references and cycles in the recipe dependency graph
 * (COST-002: "Circular sub-recipes are prohibited"). A self-edge is a cycle of
 * length one, so the same walk catches a recipe containing itself directly. The
 * caller passes the proposed edges together with the existing graph, so a new
 * version cannot introduce a cycle.
 */
export function assertNoSubRecipeCycles(edges: readonly RecipeDependencyEdge[]): void {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.parentRecipeId === edge.childRecipeId) {
      throw new DomainError("a recipe must not contain itself as a sub-recipe");
    }
    const list = adjacency.get(edge.parentRecipeId);
    if (list === undefined) {
      adjacency.set(edge.parentRecipeId, [edge.childRecipeId]);
    } else {
      list.push(edge.childRecipeId);
    }
  }

  // Iterative DFS with an explicit on-stack set: a node reached while already
  // on the current path closes a cycle.
  const visited = new Set<string>();
  const onStack = new Set<string>();
  for (const root of adjacency.keys()) {
    if (visited.has(root)) {
      continue;
    }
    const stack: Array<{ node: string; next: number }> = [{ node: root, next: 0 }];
    visited.add(root);
    onStack.add(root);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const children = adjacency.get(frame.node) ?? [];
      if (frame.next >= children.length) {
        onStack.delete(frame.node);
        stack.pop();
        continue;
      }
      const child = children[frame.next++]!;
      if (onStack.has(child)) {
        throw new DomainError("circular sub-recipes are prohibited (COST-002)");
      }
      if (!visited.has(child)) {
        visited.add(child);
        onStack.add(child);
        stack.push({ node: child, next: 0 });
      }
    }
  }
}

/** Effective-dated view needed to resolve a recipe version as of a date. */
export interface EffectiveRecipeVersion {
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

/** Half-open `[effective_from, effective_to)` (DATA_DICTIONARY §0). */
export function isRecipeVersionEffectiveAt(version: EffectiveRecipeVersion, asOf: Date): boolean {
  return (
    version.effectiveFrom.getTime() <= asOf.getTime() &&
    (version.effectiveTo === null || asOf.getTime() < version.effectiveTo.getTime())
  );
}

/**
 * The version effective at `asOf`. Returns `undefined` when none covers the
 * instant; throws when more than one does, because overlapping windows are a
 * data-integrity failure (`recipe_version_no_overlap`) rather than a case to
 * resolve by guessing.
 */
export function selectEffectiveRecipeVersion<T extends EffectiveRecipeVersion>(
  versions: readonly T[],
  asOf: Date,
): T | undefined {
  const effective = versions.filter((version) => isRecipeVersionEffectiveAt(version, asOf));
  if (effective.length > 1) {
    throw new DomainError("more than one recipe version is effective at the requested date");
  }
  return effective[0];
}

/**
 * Approving a version requires an approver and a timestamp, mirroring the DB
 * `recipe_version_approval_check`. The broader state machine is deliberately not
 * encoded here (the transitions are not pinned down by the authority docs).
 */
export function assertRecipeVersionState(state: string, approvedBy?: string | null): void {
  assertKnownState(state);
  if (state === "approved" && (approvedBy === undefined || approvedBy === null)) {
    throw new DomainError("an approved recipe version requires an approver");
  }
}
