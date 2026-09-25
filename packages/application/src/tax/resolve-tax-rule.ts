import { DomainError, TAX_RATE_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";

import type { TaxReadStore, TaxRuleRecord } from "./read-types";

/**
 * Effective-dated tax-rule resolution (`PRICE-006`, decided by `DEC-045` over
 * `DEC-022`'s line-level tax model and `CALCULATION_CONTRACT.md` §2).
 *
 * Resolution order, verbatim from `CALCULATION_CONTRACT.md:52-57`:
 *
 * 1. **Fixed item rate** where the item's tax rule is `tax_treatment = 'fixed'`
 *    (e.g. a book at 0 %, retail packs at 15 %) — it takes precedence.
 * 2. Otherwise the **item default rate with a channel override** where the
 *    item's rule is `channel_overridable` and a channel-scoped rule is
 *    effective for the requested channel (eat-in 25 % / takeaway 15 %).
 *
 * The stored window is half-open `[effective_from, effective_to)`: the shared
 * `rangeCheck` requires `effective_to > effective_from`
 * (`packages/persistence/src/schema/columns.ts:79-81`) and every effective read
 * in the costing adapter uses `lte(from, asOf)` plus
 * `isNull(to) || gt(to, asOf)` (`packages/persistence/src/repositories/costing.ts:208-209`,
 * `packages/domain/src/pricing.ts:296-302`). `asOf === effectiveFrom` matches;
 * `asOf === effectiveTo` does not.
 *
 * It **fails closed** — an explicit refusal beats a plausible number (§12):
 * no effective match, a missing/ineffective item rule, an unknown treatment, or
 * more than one equally-specific match all throw. When a channel-scoped and a
 * location-scoped rule both match, the contract names no precedence, so it is
 * refused as ambiguous rather than guessed (the `DEC-050` "refuse to guess"
 * precedent for undocumented cross-scope precedence).
 *
 * Rates are carried as 6 dp **fractions** (`TAX_RATE_SCALE`): `0.150000` is
 * 15 % (`packages/domain/src/pricing.ts:24`; the golden fixtures store
 * `0.150000`). No arithmetic is written here: the stored string is only parsed
 * and re-formatted at the contract's rate scale.
 */
export type TaxRuleResolutionSource = "fixed" | "channel_override" | "location_scope" | "default";

export interface ResolveTaxRuleInput {
  readonly organizationId: string;
  /** ISO instant / `Date` at which the rule must be effective. */
  readonly asOf: Date;
  /**
   * The tax rule the item/line references, when it references one
   * (DEC-045 steps 1/2). Absent = resolve from the scope alone (step 3).
   */
  readonly itemTaxRuleId?: string | null;
  /** Narrows the org-wide fallback set when the item references no rule. */
  readonly appliesTo?: string;
  /** The channel being priced/sold through; enables a channel override. */
  readonly channelId?: string | null;
  /** The location being priced; a location scope narrows like a channel. */
  readonly locationId?: string | null;
}

export interface ResolvedTaxRule {
  readonly rule: TaxRuleRecord;
  readonly source: TaxRuleResolutionSource;
  /** The rule's rate as a canonical 6 dp fraction (e.g. `"0.150000"`). */
  readonly ratePct: string;
}

/** Parses a stored rate at the contract's scale, rejecting a malformed/negative one. */
function normalizeRate(rule: TaxRuleRecord): string {
  const parsed = parseDecimal(rule.ratePct, TAX_RATE_SCALE);
  if (parsed < 0n) {
    throw new DomainError(`tax rule "${rule.code}" has a negative rate_pct`);
  }
  return formatDecimal(parsed, TAX_RATE_SCALE);
}

function isChannelScoped(rule: TaxRuleRecord): boolean {
  return rule.scopeType === "channel";
}

function isLocationScoped(rule: TaxRuleRecord): boolean {
  return rule.scopeType === "location";
}

function isOrganizationWide(rule: TaxRuleRecord): boolean {
  return rule.scopeType === "organization" || rule.scopeType === "company_wide";
}

function matchesChannel(rule: TaxRuleRecord, channelId: string | null | undefined): boolean {
  return channelId != null && isChannelScoped(rule) && rule.channelId === channelId;
}

function matchesLocation(rule: TaxRuleRecord, locationId: string | null | undefined): boolean {
  return locationId != null && isLocationScoped(rule) && rule.locationId === locationId;
}

/**
 * The single narrow-scope rule that wins over the org-wide default, or
 * `undefined` when none matches. Refuses when a channel-scoped and a
 * location-scoped rule both match (undocumented precedence) or when more than
 * one rule shares the winning scope.
 */
function selectNarrowRule(
  candidates: readonly TaxRuleRecord[],
  input: ResolveTaxRuleInput,
  context: string,
): { readonly rule: TaxRuleRecord; readonly source: TaxRuleResolutionSource } | undefined {
  const channel = candidates.filter((rule) => matchesChannel(rule, input.channelId));
  const location = candidates.filter((rule) => matchesLocation(rule, input.locationId));
  if (channel.length > 0 && location.length > 0) {
    throw new DomainError(
      `tax rule resolution is ambiguous for ${context}: a channel-scoped and a location-scoped rule both match; the contract defines no precedence (DEC-045), refusing to guess (DEC-050)`,
    );
  }
  const winner = channel.length > 0 ? channel : location;
  if (winner.length > 1) {
    const scope = channel.length > 0 ? "channel" : "location";
    throw new DomainError(
      `tax rule resolution is ambiguous for ${context}: more than one ${scope}-scoped rule is effective`,
    );
  }
  const rule = winner[0];
  if (rule === undefined) {
    return undefined;
  }
  return { rule, source: channel.length > 0 ? "channel_override" : "location_scope" };
}

function resolveFromItemRule(
  itemRule: TaxRuleRecord,
  effective: readonly TaxRuleRecord[],
  input: ResolveTaxRuleInput,
): ResolvedTaxRule {
  if (itemRule.taxTreatment === "fixed") {
    return { rule: itemRule, source: "fixed", ratePct: normalizeRate(itemRule) };
  }
  if (itemRule.taxTreatment !== "channel_overridable") {
    throw new DomainError(
      `tax rule "${itemRule.code}" has unknown tax_treatment "${itemRule.taxTreatment}"; expected "fixed" or "channel_overridable" (DEC-045)`,
    );
  }

  const candidates = effective.filter(
    (rule) => rule.taxTreatment === "channel_overridable" && rule.appliesTo === itemRule.appliesTo,
  );
  const narrow = selectNarrowRule(candidates, input, "the item default");
  if (narrow !== undefined) {
    return { rule: narrow.rule, source: narrow.source, ratePct: normalizeRate(narrow.rule) };
  }
  return { rule: itemRule, source: "default", ratePct: normalizeRate(itemRule) };
}

/**
 * Resolves the effective tax rule (`PRICE-006`). Never returns a guessed rate:
 * every refusal is a `DomainError` naming the reason.
 */
export async function resolveTaxRule(
  store: TaxReadStore,
  input: ResolveTaxRuleInput,
): Promise<ResolvedTaxRule> {
  const effective = (
    await store.listEffectiveTaxRules({
      organizationId: input.organizationId,
      asOf: input.asOf,
      ...(input.itemTaxRuleId != null || input.appliesTo === undefined
        ? {}
        : { appliesTo: input.appliesTo }),
    })
  ).filter((rule) => rule.organizationId === input.organizationId);

  if (input.itemTaxRuleId != null) {
    const itemRule = effective.find((rule) => rule.id === input.itemTaxRuleId);
    if (itemRule === undefined) {
      throw new DomainError(
        `tax rule ${input.itemTaxRuleId} is not effective for this organization at the requested instant`,
      );
    }
    return resolveFromItemRule(itemRule, effective, input);
  }

  // The item references no rule: resolve the scope's channel-overridable set.
  const candidates = effective.filter((rule) => rule.taxTreatment === "channel_overridable");
  const narrow = selectNarrowRule(candidates, input, "the requested scope");
  if (narrow !== undefined) {
    return { rule: narrow.rule, source: narrow.source, ratePct: normalizeRate(narrow.rule) };
  }

  const defaults = candidates.filter(isOrganizationWide);
  if (defaults.length > 1) {
    throw new DomainError(
      "tax rule resolution is ambiguous: more than one organization-wide rule is effective for the requested scope",
    );
  }
  const fallback = defaults[0];
  if (fallback === undefined) {
    throw new DomainError(
      "no effective tax rule matches the requested organization, applicability and scope",
    );
  }
  return { rule: fallback, source: "default", ratePct: normalizeRate(fallback) };
}
