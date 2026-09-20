import type { AuditInput } from "../auth";
import type {
  NewPriceScenarioRecord,
  PriceScenarioRecord,
  PriceScenarioStore,
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
