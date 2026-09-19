import { formatDecimal, parseDecimal, rescale } from "./decimal";
import { DomainError } from "./errors";
import { Quantity } from "./quantity";
import { areUnitsConvertible, convertQuantity, Unit } from "./unit";

/** `unit_conversion.factor` is `numeric(19,6)` (`DATA_DICTIONARY` §2). */
const FACTOR_SCALE = 6;

/**
 * One row of the effective-dated `unit_conversion` graph. `itemId` is `null`
 * for a global conversion and set for a pack/density-specific one.
 */
export interface UnitConversionEdge {
  readonly from: Unit;
  readonly to: Unit;
  readonly factor: string;
  readonly itemId: string | null;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

export interface ResolveConversionOptions {
  /** Instant the conversion must be effective at; windows are `[from, to)`. */
  readonly asOf: Date;
  /**
   * Item context. When set, global edges and edges scoped to that item are both
   * considered; when absent, only global edges are. Which one wins on a
   * conflict is deliberately **not** decided here: two applicable edges that
   * disagree are rejected as ambiguous (FND-003) rather than silently
   * preferring item-scoped over global (the precedence is not documented).
   */
  readonly itemId?: string | null;
}

/** Exact decimal value `units / 10^scale`; keeps compositions precise. */
interface ScaledFactor {
  readonly units: bigint;
  readonly scale: number;
}

const ONE: ScaledFactor = { units: 10n ** BigInt(FACTOR_SCALE), scale: FACTOR_SCALE };

/** The composed-factor value is exact; any presence of a cycle is compared before rounding. */
function multiplyFactors(a: ScaledFactor, b: ScaledFactor): ScaledFactor {
  return { units: a.units * b.units, scale: a.scale + b.scale };
}

function factorsEqual(a: ScaledFactor, b: ScaledFactor): boolean {
  return a.units * 10n ** BigInt(b.scale) === b.units * 10n ** BigInt(a.scale);
}

function factorToString(value: ScaledFactor): string {
  return formatDecimal(rescale(value.units, value.scale, FACTOR_SCALE), FACTOR_SCALE);
}

function isEffective(edge: UnitConversionEdge, asOf: Date): boolean {
  return (
    edge.effectiveFrom.getTime() <= asOf.getTime() &&
    (edge.effectiveTo === null || asOf.getTime() < edge.effectiveTo.getTime())
  );
}

/**
 * Effective-dated graph of unit conversions (FND-003, PROC-001,
 * `DATA_DICTIONARY` §2). Construction enforces the per-edge invariants
 * (compatible dimensions, positive factor, ordered effective window); `resolve`
 * walks the graph and enforces the graph-level ones (no ambiguity, no
 * inconsistent cycles). The resolved factor is applied by `convertQuantity`, so
 * quantity arithmetic stays decimal-only, rounded HALF_UP at quantity scale
 * (DEC-024).
 */
export class ConversionGraph {
  readonly #edges: readonly UnitConversionEdge[];

  private constructor(edges: readonly UnitConversionEdge[]) {
    this.#edges = edges;
  }

  static from(edges: readonly UnitConversionEdge[]): ConversionGraph {
    for (const edge of edges) {
      if (!areUnitsConvertible(edge.from, edge.to)) {
        throw new DomainError(
          `incompatible unit dimensions: ${edge.from.dimension} vs ${edge.to.dimension}`,
        );
      }
      if (parseDecimal(edge.factor, FACTOR_SCALE) <= 0n) {
        throw new DomainError(`conversion factor must be positive, got "${edge.factor}"`);
      }
      if (edge.effectiveTo !== null && edge.effectiveTo.getTime() <= edge.effectiveFrom.getTime()) {
        throw new DomainError("conversion effective_to must be after effective_from");
      }
    }
    return new ConversionGraph(edges);
  }

  /**
   * Resolves `from` → `to` to a single factor at factor scale (6 dp). Throws
   * when the dimensions are incompatible, no effective path exists, or the
   * effective edges imply two different factors for the same unit (ambiguity or
   * an inconsistent cycle).
   */
  resolve(from: Unit, to: Unit, options: ResolveConversionOptions): string {
    if (!areUnitsConvertible(from, to)) {
      throw new DomainError(`incompatible unit dimensions: ${from.dimension} vs ${to.dimension}`);
    }

    const itemId = options.itemId ?? null;
    const adjacency = new Map<string, UnitConversionEdge[]>();
    for (const edge of this.#edges) {
      if (!isEffective(edge, options.asOf)) {
        continue;
      }
      if (edge.itemId !== null && edge.itemId !== itemId) {
        continue;
      }
      const list = adjacency.get(edge.from.code);
      if (list === undefined) {
        adjacency.set(edge.from.code, [edge]);
      } else {
        list.push(edge);
      }
    }

    const visited = new Map<string, ScaledFactor>([[from.code, ONE]]);
    const stack: Array<{ unit: string; value: ScaledFactor }> = [{ unit: from.code, value: ONE }];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const edge of adjacency.get(current.unit) ?? []) {
        const next = multiplyFactors(current.value, {
          units: parseDecimal(edge.factor, FACTOR_SCALE),
          scale: FACTOR_SCALE,
        });
        const seen = visited.get(edge.to.code);
        if (seen !== undefined) {
          if (!factorsEqual(seen, next)) {
            throw new DomainError(
              `ambiguous conversion from "${from.code}" to "${to.code}": ` +
                `"${edge.to.code}" resolves to two different factors`,
            );
          }
          continue;
        }
        visited.set(edge.to.code, next);
        stack.push({ unit: edge.to.code, value: next });
      }
    }

    const resolved = visited.get(to.code);
    if (resolved === undefined) {
      throw new DomainError(
        `no conversion from "${from.code}" to "${to.code}" effective at the requested date`,
      );
    }
    return factorToString(resolved);
  }
}

/**
 * Resolves the factor through `graph` and applies it with `convertQuantity`
 * (factor-driven, HALF_UP at quantity scale), so callers never hand-roll the
 * factor arithmetic.
 */
export function convertUsingGraph(
  graph: ConversionGraph,
  quantity: Quantity,
  from: Unit,
  to: Unit,
  options: ResolveConversionOptions,
): Quantity {
  if (quantity.unit !== from.code) {
    throw new DomainError(
      `quantity unit "${quantity.unit}" does not match conversion source "${from.code}"`,
    );
  }
  return convertQuantity(quantity, from, to, graph.resolve(from, to, options));
}
