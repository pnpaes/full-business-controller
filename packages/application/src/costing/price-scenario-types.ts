import type { AuditInput } from "../auth";

/**
 * Application-level ports and DTOs for the slice-7 price scenarios (PRICE-001–
 * 005) and the price versions they produce (PRICE-002/003; `DEC-064`,
 * `DEC-077`). The store is a narrow port over `@aquarela/persistence` so the
 * commands can be unit-tested against an in-memory fake;
 * `createPostgresPriceScenarioStore` is the real adapter. Record types are
 * structural subsets of the persistence rows; `createdAt` is carried as an ISO
 * string, `timestamptz` columns as ISO instants, and the jsonb columns are
 * defaulted to `{}` by the adapter.
 */

export interface PriceScenarioRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly productVariantId: string;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly grossPrice: string | null;
  readonly netPrice: string | null;
  readonly targetContributionPct: string | null;
  readonly volumeAssumption: string | null;
  readonly feeBreakdown: Record<string, unknown>;
  readonly outcome: Record<string, unknown>;
  readonly state: string;
  readonly createdAt: string;
}

export interface NewPriceScenarioRecord {
  readonly organizationId: string;
  readonly productVariantId: string;
  readonly locationId?: string | null;
  readonly channelId?: string | null;
  readonly grossPrice?: string | null;
  readonly netPrice?: string | null;
  readonly targetContributionPct?: string | null;
  readonly volumeAssumption?: string | null;
  readonly feeBreakdown?: Record<string, unknown>;
  readonly outcome?: Record<string, unknown>;
  readonly state?: string;
}

/** An approved, effective price for one exact scope (`price_version`). */
export interface PriceVersionRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly productVariantId: string;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly grossPrice: string;
  readonly netPrice: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly sourceScenarioId: string;
}

export interface NewPriceVersionRecord {
  readonly organizationId: string;
  readonly productVariantId: string;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly grossPrice: string;
  readonly netPrice: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly sourceScenarioId: string;
}

export interface PriceScenarioStore {
  /** Binds `fn` to one transaction so the state change and its audit row commit together. */
  withTransaction<T>(fn: (store: PriceScenarioStore) => Promise<T>): Promise<T>;
  findProductVariant(
    productVariantId: string,
  ): Promise<{ readonly id: string; readonly organizationId: string } | undefined>;
  findLocation(
    locationId: string,
  ): Promise<{ readonly id: string; readonly organizationId: string } | undefined>;
  findChannel(
    channelId: string,
  ): Promise<{ readonly id: string; readonly organizationId: string } | undefined>;
  createPriceScenario(input: NewPriceScenarioRecord): Promise<PriceScenarioRecord>;
  findPriceScenario(priceScenarioId: string): Promise<PriceScenarioRecord | undefined>;
  updatePriceScenario(
    priceScenarioId: string,
    patch: {
      readonly state?: string;
      readonly outcome?: Record<string, unknown>;
      readonly grossPrice?: string | null;
      readonly netPrice?: string | null;
    },
  ): Promise<PriceScenarioRecord>;
  /**
   * Compare-and-swap `draft`/`submitted` → `approved`, organization-scoped
   * (PRICE-003). Returns `undefined` when the scenario is unknown, foreign, or
   * no longer approvable, so a lost concurrent-approval race cannot create a
   * second effective `price_version`.
   */
  markPriceScenarioApproved(query: {
    readonly organizationId: string;
    readonly priceScenarioId: string;
  }): Promise<PriceScenarioRecord | undefined>;
  createCalculationSnapshot(input: {
    readonly organizationId: string;
    readonly costCardId?: string | null;
    readonly priceScenarioId?: string | null;
    readonly costSelectionPolicy: string;
    readonly asOf: Date;
    readonly taxRuleSnapshot?: Record<string, unknown>;
    readonly fxRateId?: string | null;
    readonly roundingMethod?: string;
    readonly roundingScales?: Record<string, unknown>;
    readonly ruleVersion: string;
    readonly totals: Record<string, unknown>;
  }): Promise<{ readonly id: string }>;
  createPriceVersion(input: NewPriceVersionRecord): Promise<PriceVersionRecord>;
  findPriceVersion(query: {
    readonly organizationId: string;
    readonly priceVersionId: string;
  }): Promise<PriceVersionRecord | undefined>;
  listPriceVersions(query: {
    readonly organizationId: string;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly PriceVersionRecord[]>;
  /** The approved price versions for one scope, oldest `effectiveFrom` first. */
  listPriceVersionsForScope(query: {
    readonly organizationId: string;
    readonly productVariantId: string;
    readonly locationId: string | null;
    readonly channelId: string | null;
  }): Promise<readonly PriceVersionRecord[]>;
  /** The one version effective for a scope at `asOf` (half-open window), if any. */
  findEffectivePriceVersion(query: {
    readonly organizationId: string;
    readonly productVariantId: string;
    readonly locationId: string | null;
    readonly channelId: string | null;
    readonly asOf: Date;
  }): Promise<PriceVersionRecord | undefined>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
