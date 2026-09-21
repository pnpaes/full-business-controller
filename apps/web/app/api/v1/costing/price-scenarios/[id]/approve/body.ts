import { isRecord } from "../../../parse";

/**
 * Body parsing for `POST /api/v1/costing/price-scenarios/[id]/approve`
 * (PRICE-002/003). The body is optional — both `effectiveFrom` and `effectiveTo`
 * are optional, and an explicit `effectiveTo: null` is the "open-ended window".
 * This only checks the shape (string / null); the application command remains the
 * single validator of the instant format and the window semantics, so a malformed
 * instant is rejected there with a 400.
 */

export interface ApprovePriceScenarioBody {
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string | null;
}

export type ParsedApprovePriceScenarioBody =
  { readonly ok: true; readonly value: ApprovePriceScenarioBody } | { readonly ok: false };

function readInstant(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function parseApprovePriceScenarioBody(
  body: Record<string, unknown>,
): ParsedApprovePriceScenarioBody {
  const value: { effectiveFrom?: string; effectiveTo?: string | null } = {};

  if (body.effectiveFrom !== undefined && body.effectiveFrom !== null) {
    const from = readInstant(body.effectiveFrom);
    if (from === undefined) {
      return { ok: false };
    }
    value.effectiveFrom = from;
  }

  if (body.effectiveTo !== undefined) {
    if (body.effectiveTo === null) {
      value.effectiveTo = null;
    } else {
      const to = readInstant(body.effectiveTo);
      if (to === undefined) {
        return { ok: false };
      }
      value.effectiveTo = to;
    }
  }

  return { ok: true, value };
}

/**
 * Reads the optional approve body: a blank or absent body is `{}` (every field
 * is optional), while malformed JSON or a non-object JSON value is `undefined`
 * so the route replies 400.
 */
export async function readApprovePriceScenarioBody(
  request: Request,
): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await request.text();
    if (text.trim().length === 0) {
      return {};
    }
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
