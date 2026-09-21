import { isEffectiveAt, priceVersionWindowsOverlap } from "@aquarela/domain";

import type { AuditInput } from "../auth";
import type {
  NewPriceScenarioRecord,
  NewPriceVersionRecord,
  PriceScenarioRecord,
  PriceScenarioStore,
  PriceVersionRecord,
} from "./price-scenario-types";

type SnapshotInput = Parameters<PriceScenarioStore["createCalculationSnapshot"]>[0];

/**
 * In-memory `PriceScenarioStore` for the unit suite. It mirrors the observable
 * contract closely enough to exercise the commands without a database;
 * `price-scenario.postgres.test.ts` covers the real adapter.
 */
export class FakePriceScenarioStore implements PriceScenarioStore {
  readonly productVariants = new Map<
    string,
    { readonly id: string; readonly organizationId: string }
  >();
  readonly locations = new Map<string, { readonly id: string; readonly organizationId: string }>();
  readonly channels = new Map<string, { readonly id: string; readonly organizationId: string }>();
  readonly priceScenarios = new Map<string, PriceScenarioRecord>();
  readonly priceVersions = new Map<string, PriceVersionRecord>();
  readonly snapshots: Array<SnapshotInput & { readonly id: string }> = [];
  readonly audits: AuditInput[] = [];

  private sequence = 0;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  async withTransaction<T>(fn: (store: PriceScenarioStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  findProductVariant(
    productVariantId: string,
  ): Promise<{ readonly id: string; readonly organizationId: string } | undefined> {
    return Promise.resolve(this.productVariants.get(productVariantId));
  }

  findLocation(
    locationId: string,
  ): Promise<{ readonly id: string; readonly organizationId: string } | undefined> {
    return Promise.resolve(this.locations.get(locationId));
  }

  findChannel(
    channelId: string,
  ): Promise<{ readonly id: string; readonly organizationId: string } | undefined> {
    return Promise.resolve(this.channels.get(channelId));
  }

  createPriceScenario(input: NewPriceScenarioRecord): Promise<PriceScenarioRecord> {
    const record: PriceScenarioRecord = {
      id: this.nextId("price-scenario"),
      organizationId: input.organizationId,
      productVariantId: input.productVariantId,
      locationId: input.locationId ?? null,
      channelId: input.channelId ?? null,
      grossPrice: input.grossPrice ?? null,
      netPrice: input.netPrice ?? null,
      targetContributionPct: input.targetContributionPct ?? null,
      volumeAssumption: input.volumeAssumption ?? null,
      feeBreakdown: input.feeBreakdown ?? {},
      outcome: input.outcome ?? {},
      state: input.state ?? "draft",
      createdAt: new Date().toISOString(),
    };
    this.priceScenarios.set(record.id, record);
    return Promise.resolve(record);
  }

  findPriceScenario(priceScenarioId: string): Promise<PriceScenarioRecord | undefined> {
    return Promise.resolve(this.priceScenarios.get(priceScenarioId));
  }

  updatePriceScenario(
    priceScenarioId: string,
    patch: {
      readonly state?: string;
      readonly outcome?: Record<string, unknown>;
      readonly grossPrice?: string | null;
      readonly netPrice?: string | null;
    },
  ): Promise<PriceScenarioRecord> {
    const existing = this.priceScenarios.get(priceScenarioId);
    if (existing === undefined) {
      return Promise.reject(new Error(`price scenario ${priceScenarioId} not found`));
    }
    const updated: PriceScenarioRecord = {
      ...existing,
      state: patch.state ?? existing.state,
      outcome: patch.outcome ?? existing.outcome,
      grossPrice: patch.grossPrice !== undefined ? patch.grossPrice : existing.grossPrice,
      netPrice: patch.netPrice !== undefined ? patch.netPrice : existing.netPrice,
    };
    this.priceScenarios.set(priceScenarioId, updated);
    return Promise.resolve(updated);
  }

  /**
   * Mirrors `approvePriceScenarioIfApprovable`'s conditional UPDATE: only a
   * `draft`/`submitted` scenario in the same organization flips to `approved`;
   * anything else returns `undefined` (a lost approval race).
   */
  markPriceScenarioApproved(query: {
    readonly organizationId: string;
    readonly priceScenarioId: string;
  }): Promise<PriceScenarioRecord | undefined> {
    const existing = this.priceScenarios.get(query.priceScenarioId);
    if (
      existing === undefined ||
      existing.organizationId !== query.organizationId ||
      (existing.state !== "draft" && existing.state !== "submitted")
    ) {
      return Promise.resolve(undefined);
    }
    const updated: PriceScenarioRecord = { ...existing, state: "approved" };
    this.priceScenarios.set(query.priceScenarioId, updated);
    return Promise.resolve(updated);
  }

  createPriceVersion(input: NewPriceVersionRecord): Promise<PriceVersionRecord> {
    // Mirrors the `price_version_no_overlap` EXCLUDE constraint so the fake
    // enforces DEC-077 exactly as the database does.
    const overlaps = [...this.priceVersions.values()].some(
      (version) =>
        version.organizationId === input.organizationId &&
        version.productVariantId === input.productVariantId &&
        version.locationId === input.locationId &&
        version.channelId === input.channelId &&
        priceVersionWindowsOverlap(
          { effectiveFrom: version.effectiveFrom, effectiveTo: version.effectiveTo },
          { effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo },
        ),
    );
    if (overlaps) {
      return Promise.reject(
        new Error("price version window overlaps an existing version for this scope"),
      );
    }
    const record: PriceVersionRecord = { id: this.nextId("price-version"), ...input };
    this.priceVersions.set(record.id, record);
    return Promise.resolve(record);
  }

  findPriceVersion(query: {
    readonly organizationId: string;
    readonly priceVersionId: string;
  }): Promise<PriceVersionRecord | undefined> {
    const version = this.priceVersions.get(query.priceVersionId);
    return Promise.resolve(
      version !== undefined && version.organizationId === query.organizationId
        ? version
        : undefined,
    );
  }

  listPriceVersions(query: {
    readonly organizationId: string;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<readonly PriceVersionRecord[]> {
    const versions = this.versionsFor(query.organizationId).sort((a, b) =>
      a.effectiveFrom === b.effectiveFrom
        ? b.id.localeCompare(a.id)
        : b.effectiveFrom.localeCompare(a.effectiveFrom),
    );
    const offset = query.offset ?? 0;
    const page =
      query.limit === undefined
        ? versions.slice(offset)
        : versions.slice(offset, offset + query.limit);
    return Promise.resolve(page);
  }

  listPriceVersionsForScope(query: {
    readonly organizationId: string;
    readonly productVariantId: string;
    readonly locationId: string | null;
    readonly channelId: string | null;
  }): Promise<readonly PriceVersionRecord[]> {
    const versions = this.versionsFor(query.organizationId)
      .filter(
        (version) =>
          version.productVariantId === query.productVariantId &&
          version.locationId === query.locationId &&
          version.channelId === query.channelId,
      )
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    return Promise.resolve(versions);
  }

  findEffectivePriceVersion(query: {
    readonly organizationId: string;
    readonly productVariantId: string;
    readonly locationId: string | null;
    readonly channelId: string | null;
    readonly asOf: Date;
  }): Promise<PriceVersionRecord | undefined> {
    const asOf = query.asOf.toISOString();
    const effective = this.versionsFor(query.organizationId).filter(
      (version) =>
        version.productVariantId === query.productVariantId &&
        version.locationId === query.locationId &&
        version.channelId === query.channelId &&
        isEffectiveAt(
          { effectiveFrom: version.effectiveFrom, effectiveTo: version.effectiveTo },
          asOf,
        ),
    );
    // Non-overlap (enforced above) guarantees at most one; newest `effectiveFrom`
    // is only a defensive tie-break, as in the persistence query.
    effective.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    return Promise.resolve(effective[0]);
  }

  private versionsFor(organizationId: string): PriceVersionRecord[] {
    return [...this.priceVersions.values()].filter(
      (version) => version.organizationId === organizationId,
    );
  }

  createCalculationSnapshot(input: SnapshotInput): Promise<{ readonly id: string }> {
    const record = { id: this.nextId("snapshot"), ...input };
    this.snapshots.push(record);
    return Promise.resolve({ id: record.id });
  }

  writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
    return Promise.resolve();
  }
}
