import { DomainError, TAX_RATE_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";
import { SCOPE_TYPE, TAX_APPLIES_TO, TAX_BASIS, TAX_TREATMENT } from "@aquarela/persistence";

import { assertIsoInstant } from "../inventory/validation";
import type { TaxRuleRecord } from "./read-types";
import type { TaxWriteStore } from "./write-types";
import { TAX_AUDIT_ACTIONS } from "./actions";

const TAX_BASES: readonly string[] = TAX_BASIS;
const TAX_TREATMENTS: readonly string[] = TAX_TREATMENT;
const TAX_APPLICABILITIES: readonly string[] = TAX_APPLIES_TO;
const SCOPE_TYPES: readonly string[] = SCOPE_TYPE;

/** One whole unit at the rate scale: the ceiling of a plausible tax fraction. */
const ONE = parseDecimal("1", TAX_RATE_SCALE);

export interface CreateTaxRuleInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly code: string;
  readonly name: string;
  /**
   * A **fraction** at `TAX_RATE_SCALE`, so `"0.150000"` is 15 % (never `"15"`).
   * A percent-shaped value above 1 is rejected rather than silently read as a
   * 1500 % rate.
   */
  readonly ratePct: string;
  readonly taxBasis: string;
  readonly taxTreatment: string;
  readonly recoverable?: boolean;
  readonly appliesTo: string;
  readonly scopeType?: string;
  readonly locationId?: string | null;
  readonly channelId?: string | null;
  /** ISO-8601 instant (`tax_rule.effective_from` is `timestamptz`). */
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
}

export interface CreateTaxRuleResult {
  readonly taxRuleId: string;
}

/** The scoped id the resolver narrows by, per the table's structure. */
function scopedId(scopeType: string, locationId: string | null, channelId: string | null): string {
  if (scopeType === "channel") {
    return channelId ?? "";
  }
  if (scopeType === "location") {
    return locationId ?? "";
  }
  return "";
}

/**
 * Overlap identity (`DEC-045` applicability/scope key): two rules conflict only
 * when `applies_to`, `scope_type` **and** the scoped id all match — the same
 * narrowing `resolveTaxRule` applies before it can see more than one candidate.
 */
function sameScopeKey(
  rule: TaxRuleRecord,
  appliesTo: string,
  scopeType: string,
  locationId: string | null,
  channelId: string | null,
): boolean {
  return (
    rule.appliesTo === appliesTo &&
    rule.scopeType === scopeType &&
    scopedId(rule.scopeType, rule.locationId, rule.channelId) ===
      scopedId(scopeType, locationId, channelId)
  );
}

/** Half-open `[from, to)` overlap; a null `to` is open-ended. */
function overlaps(rule: TaxRuleRecord, from: Date, to: Date | null): boolean {
  return (
    (rule.effectiveTo === null || rule.effectiveTo > from) &&
    (to === null || rule.effectiveFrom < to)
  );
}

/** Parses the rate at `TAX_RATE_SCALE` and returns it canonicalised at 6 dp. */
function normalizeRate(ratePct: string): string {
  const parsed = parseDecimal(ratePct, TAX_RATE_SCALE);
  if (parsed < 0n) {
    throw new DomainError("ratePct must not be negative");
  }
  if (parsed > ONE) {
    throw new DomainError(
      `ratePct must be a fraction between 0 and 1 (0.150000 is 15 %), not a percentage such as "${ratePct}"`,
    );
  }
  return formatDecimal(parsed, TAX_RATE_SCALE);
}

/**
 * Creates one effective-dated `tax_rule` (`PRICE-005`, `DEC-003`/`DEC-022`).
 *
 * **Append-only.** This is the only way a rate is written; a rate change is a
 * new rule, and an existing rule is never edited except by `supersedeTaxRule`,
 * which only sets its `effective_to` (`DEC-008`/`DEC-028` posture). Every field
 * the DB constrains is validated here — vocabulary, the 6 dp fraction rate, a
 * non-empty organization-unique code, the scope ids, and the half-open
 * `[effectiveFrom, effectiveTo)` window — so a `DomainError` names the field
 * before any constraint violation.
 *
 * **Overlap is refused, not stored.** Two rules effective at one instant for
 * the same `applies_to` + `scope_type` + scoped id would make `resolveTaxRule`
 * fail closed in production, so creation names the conflicting rule and
 * refuses. The DB has no exclusion constraint on `tax_rule` (unlike
 * `channel_fee_rule`), so this read-then-write inside the transaction is the
 * only guard: a concurrent create can still race, and the resolver's
 * fail-closed ambiguity check is then the backstop.
 */
export async function createTaxRule(
  store: TaxWriteStore,
  input: CreateTaxRuleInput,
): Promise<CreateTaxRuleResult> {
  const code = input.code.trim();
  if (code.length === 0) {
    throw new DomainError("code must not be empty");
  }
  const name = input.name.trim();
  if (name.length === 0) {
    throw new DomainError("name must not be empty");
  }

  const ratePct = normalizeRate(input.ratePct);

  if (!TAX_BASES.includes(input.taxBasis)) {
    throw new DomainError(`taxBasis must be one of ${TAX_BASES.join(", ")}`);
  }
  if (!TAX_TREATMENTS.includes(input.taxTreatment)) {
    throw new DomainError(`taxTreatment must be one of ${TAX_TREATMENTS.join(", ")}`);
  }
  if (!TAX_APPLICABILITIES.includes(input.appliesTo)) {
    throw new DomainError(`appliesTo must be one of ${TAX_APPLICABILITIES.join(", ")}`);
  }
  const scopeType = input.scopeType ?? "company_wide";
  if (!SCOPE_TYPES.includes(scopeType)) {
    throw new DomainError(`scopeType must be one of ${SCOPE_TYPES.join(", ")}`);
  }

  const locationId = input.locationId ?? null;
  const channelId = input.channelId ?? null;
  if (scopeType === "channel" && channelId === null) {
    throw new DomainError('channelId is required when scopeType is "channel"');
  }
  if (scopeType === "location" && locationId === null) {
    throw new DomainError('locationId is required when scopeType is "location"');
  }
  if (scopeType !== "channel" && channelId !== null) {
    throw new DomainError(`channelId must be null when scopeType is "${scopeType}"`);
  }
  if (scopeType !== "location" && locationId !== null) {
    throw new DomainError(`locationId must be null when scopeType is "${scopeType}"`);
  }

  assertIsoInstant(input.effectiveFrom, "effectiveFrom");
  if (input.effectiveTo !== undefined && input.effectiveTo !== null) {
    assertIsoInstant(input.effectiveTo, "effectiveTo");
  }
  const effectiveFrom = new Date(input.effectiveFrom);
  const effectiveTo =
    input.effectiveTo === undefined || input.effectiveTo === null
      ? null
      : new Date(input.effectiveTo);
  if (effectiveTo !== null && effectiveTo.getTime() <= effectiveFrom.getTime()) {
    throw new DomainError("effectiveTo must be after effectiveFrom");
  }

  const recoverable = input.recoverable ?? false;

  return store.withTransaction(async (tx) => {
    if (channelId !== null) {
      const channel = await tx.findChannelScope(channelId);
      if (channel === undefined || channel.organizationId !== input.organizationId) {
        throw new DomainError("channel not found in organization");
      }
    }
    if (locationId !== null) {
      const location = await tx.findLocationScope(locationId);
      if (location === undefined || location.organizationId !== input.organizationId) {
        throw new DomainError("location not found in organization");
      }
    }

    const duplicate = await tx.findTaxRuleByCode(input.organizationId, code);
    if (duplicate !== undefined) {
      throw new DomainError(`tax rule code "${code}" already exists in this organization`);
    }

    const existing = await tx.listTaxRulesByApplicability(input.organizationId, input.appliesTo);
    const overlapping = existing.find(
      (rule) =>
        sameScopeKey(rule, input.appliesTo, scopeType, locationId, channelId) &&
        overlaps(rule, effectiveFrom, effectiveTo),
    );
    if (overlapping !== undefined) {
      throw new DomainError(
        `tax rule "${overlapping.code}" is already effective over this window for the same applicability and scope; end it by setting its effective_to, or choose a different appliesTo or scope`,
      );
    }

    const created = await tx.createTaxRule({
      organizationId: input.organizationId,
      code,
      name,
      ratePct,
      taxTreatment: input.taxTreatment,
      taxBasis: input.taxBasis,
      recoverable,
      appliesTo: input.appliesTo,
      scopeType,
      locationId,
      channelId,
      effectiveFrom,
      effectiveTo,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: TAX_AUDIT_ACTIONS.taxRuleCreated,
      entityType: "tax_rule",
      entityId: created.id,
      after: {
        code,
        rate_pct: ratePct,
        tax_basis: input.taxBasis,
        tax_treatment: input.taxTreatment,
        recoverable,
        applies_to: input.appliesTo,
        scope_type: scopeType,
        location_id: locationId,
        channel_id: channelId,
        effective_from: effectiveFrom.toISOString(),
        effective_to: effectiveTo === null ? null : effectiveTo.toISOString(),
      },
    });

    return { taxRuleId: created.id };
  });
}
