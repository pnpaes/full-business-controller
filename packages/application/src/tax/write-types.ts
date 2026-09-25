import type { AuditInput } from "../auth";

import type { TaxRuleRecord } from "./read-types";

/**
 * Authoring port for the `tax_rule` master data (`DATA_DICTIONARY` §1,
 * `PRICE-005`/`PRICE-006`). The table already exists with every column this
 * slice needs, so the port is a narrow read-then-write over
 * `@aquarela/persistence` and the commands can be unit-tested against an
 * in-memory fake.
 *
 * `rate_pct` stays the stored `numeric(9,6)` **fraction** string throughout
 * (`"0.150000"` is 15 %, never `15`), matching `TAX_RATE_SCALE` and
 * `resolveTaxRule`'s `normalizeRate`.
 */
export interface NewTaxRuleRecord {
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  /** Canonical 6 dp fraction (`"0.150000"` = 15 %). */
  readonly ratePct: string;
  readonly taxTreatment: string;
  readonly taxBasis: string;
  readonly recoverable: boolean;
  readonly appliesTo: string;
  readonly scopeType: string;
  readonly locationId: string | null;
  readonly channelId: string | null;
  /** Half-open `[effectiveFrom, effectiveTo)` `timestamptz` window. */
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

/** An organization-scoped `channel`/`location` row, for the scope FK check. */
export interface TaxScopeRef {
  readonly id: string;
  readonly organizationId: string;
}

export interface TaxWriteStore {
  /**
   * Binds `fn` to one transaction so the create/end and its audit row commit
   * together (and so the read-then-write overlap check sees a consistent set).
   */
  withTransaction<T>(fn: (store: TaxWriteStore) => Promise<T>): Promise<T>;
  /** The one organization-unique `code` holder, if any. */
  findTaxRuleByCode(organizationId: string, code: string): Promise<TaxRuleRecord | undefined>;
  findTaxRuleById(taxRuleId: string): Promise<TaxRuleRecord | undefined>;
  /**
   * Every rule of the organization with this `applies_to`, any window and scope
   * — the read behind the creation overlap check.
   */
  listTaxRulesByApplicability(
    organizationId: string,
    appliesTo: string,
  ): Promise<readonly TaxRuleRecord[]>;
  /**
   * Every rule of the organization, ordered by `code` (then `id`), with the
   * scope columns and the effective window — the Administration register read.
   */
  listTaxRulesWithWindows(organizationId: string): Promise<readonly TaxRuleRecord[]>;
  findChannelScope(channelId: string): Promise<TaxScopeRef | undefined>;
  findLocationScope(locationId: string): Promise<TaxScopeRef | undefined>;
  createTaxRule(input: NewTaxRuleRecord): Promise<TaxRuleRecord>;
  /**
   * Sets `effective_to` on one **organization-owned** rule and nothing else,
   * but only while it is still open (`effective_to is null`). `undefined` when
   * the id is unknown, belongs to another organization, or was ended already —
   * including by a concurrent transaction, which the `effective_to is null`
   * predicate is what makes detectable.
   */
  endTaxRule(
    organizationId: string,
    taxRuleId: string,
    effectiveTo: Date,
  ): Promise<TaxRuleRecord | undefined>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
