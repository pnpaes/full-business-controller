import type { AuditInput } from "../auth";

/**
 * Application-level ports and DTOs for the slice-7 price scenarios (PRICE-001–
 * 005). The store is a narrow port over `@aquarela/persistence` so the commands
 * can be unit-tested against an in-memory fake; `createPostgresPriceScenarioStore`
 * is the real adapter. Record types are structural subsets of the persistence
 * rows; `createdAt` is carried as an ISO string and the jsonb columns are
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
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
