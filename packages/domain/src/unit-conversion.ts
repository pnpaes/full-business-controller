import { formatDecimal, parseDecimal, rescale } from "./decimal";
import { DomainError } from "./errors";
import { Quantity } from "./quantity";
import { areConversionEdgeUnits, convertQuantity, Unit } from "./unit";

/** `unit_conversion.factor` is `numeric(19,6)` (`DATA_DICTIONARY` §2). */
const FACTOR_SCALE = 6;

/**
 * Upper bound on a resolved path. `numeric(19,6)` factors cannot represent an
 * unbounded chain, and a path this long signals corrupt or adversarial data
 * rather than a real conversion (`DATA_DICTIONARY` §2; FND-003).
 */
const MAX_CHAIN_LENGTH = 32;

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

/** A factor is always held at `FACTOR_SCALE`, so it is a valid `numeric(19,6)`. */
const ONE = 10n ** BigInt(FACTOR_SCALE);

/**
 * Composes two factors and rescales the product back to factor scale (HALF_UP)
 * immediately, so the running value stays a `numeric(19,6)` and its scale cannot
 * grow with the path length (DEC-024; review finding on composed-factor scale).
 */
function multiplyFactors(a: bigint, b: bigint): bigint {
  return rescale(a * b, FACTOR_SCALE * 2, FACTOR_SCALE);
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
      if (edge.from.code === edge.to.code) {
        throw new DomainError(`conversion edge from "${edge.from.code}" to itself is not allowed`);
      }
      if (!areConversionEdgeUnits(edge.from, edge.to)) {
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
   * Resolves `from` → `to` to a single factor at factor scale (6 dp). Each hop
   * is rescaled HALF_UP before the next, so a composed factor is always a valid
   * `numeric(19,6)`. Throws when the dimensions are incompatible, no effective
   * path exists, the path exceeds `MAX_CHAIN_LENGTH` hops, a composed factor
   * rounds to zero, or the effective edges imply two different factors for the
   * same unit (ambiguity or an inconsistent cycle).
   */
  resolve(from: Unit, to: Unit, options: ResolveConversionOptions): string {
    if (!areConversionEdgeUnits(from, to)) {
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

    const visited = new Map<string, bigint>([[from.code, ONE]]);
    const stack: Array<{ unit: string; value: bigint; hops: number }> = [
      { unit: from.code, value: ONE, hops: 0 },
    ];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const edge of adjacency.get(current.unit) ?? []) {
        if (current.hops + 1 > MAX_CHAIN_LENGTH) {
          throw new DomainError(
            `conversion path from "${from.code}" to "${to.code}" exceeds ` +
              `${MAX_CHAIN_LENGTH} hops; the graph is not a usable conversion`,
          );
        }
        const next = multiplyFactors(current.value, parseDecimal(edge.factor, FACTOR_SCALE));
        if (next === 0n) {
          throw new DomainError(
            `conversion from "${from.code}" to "${to.code}" rounds to zero at ` +
              `${FACTOR_SCALE} dp and is unusable`,
          );
        }
        const seen = visited.get(edge.to.code);
        if (seen !== undefined) {
          if (seen !== next) {
            throw new DomainError(
              `ambiguous conversion from "${from.code}" to "${to.code}": ` +
                `"${edge.to.code}" resolves to two different factors`,
            );
          }
          continue;
        }
        visited.set(edge.to.code, next);
        stack.push({ unit: edge.to.code, value: next, hops: current.hops + 1 });
      }
    }

    const resolved = visited.get(to.code);
    if (resolved === undefined) {
      throw new DomainError(
        `no conversion from "${from.code}" to "${to.code}" effective at the requested date`,
      );
    }
    return formatDecimal(resolved, FACTOR_SCALE);
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
