import type { ProductionBatchCost } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresProductionBatchCostStore: vi.fn(() => ({})),
    computeProductionBatchCost: vi.fn(),
  };
});
vi.mock("../../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const BATCH_ID = "55555555-5555-4555-8555-555555555555";

function cost(overrides: Partial<ProductionBatchCost> = {}): ProductionBatchCost {
  return {
    productionBatchId: BATCH_ID,
    currency: "NOK",
    ingredientCost: "4.2500",
    labourCost: "375.0000",
    allocatedOverhead: "0.0000",
    totalBatchCost: "379.2500",
    actualOutputQty: "2.000000",
    unitCost: "189.6250",
    plannedOutputQty: "2.000000",
    yieldVariancePct: "0.000000",
    actualHours: "1.50",
    effectiveLoadedHourlyRate: "250.00",
    theoreticalUnitCost: "10.0000",
    varianceUnitCost: "-179.6250",
    provenance: ["no cost pool supplied: allocated overhead is zero"],
    ...overrides,
  };
}

function context(id: string): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresProductionBatchCostStore).mockReturnValue({} as never);
  vi.mocked(application.computeProductionBatchCost).mockResolvedValue(cost());
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/production/batches/[id]/cost", () => {
  it("returns the batch cost row", async () => {
    const response = await GET(
      new Request(`http://localhost/api/v1/production/batches/${BATCH_ID}/cost`),
      context(BATCH_ID),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly cost: Record<string, unknown> };
    expect(body.cost).toMatchObject({
      productionBatchId: BATCH_ID,
      totalBatchCost: "379.2500",
      unitCost: "189.6250",
      actualHours: "1.50",
      effectiveLoadedHourlyRate: "250.00",
      varianceUnitCost: "-179.6250",
    });
    expect(body.cost.provenance).toEqual(["no cost pool supplied: allocated overhead is zero"]);
    expect(application.computeProductionBatchCost).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, productionBatchId: BATCH_ID }),
    );
  });

  it("passes the optional cost pool and period through", async () => {
    const poolId = "66666666-6666-4666-8666-666666666666";
    await GET(
      new Request(
        `http://localhost/api/v1/production/batches/${BATCH_ID}/cost?costPoolId=${poolId}` +
          "&periodFrom=2026-06-01T00:00:00.000Z&periodTo=2026-07-01T00:00:00.000Z",
      ),
      context(BATCH_ID),
    );

    expect(application.computeProductionBatchCost).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        costPoolId: poolId,
        periodFrom: "2026-06-01T00:00:00.000Z",
        periodTo: "2026-07-01T00:00:00.000Z",
      }),
    );
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);
    const response = await GET(
      new Request(`http://localhost/api/v1/production/batches/${BATCH_ID}/cost`),
      context(BATCH_ID),
    );
    expect(response.status).toBe(401);
  });

  it("returns 400 for a malformed id", async () => {
    const response = await GET(
      new Request("http://localhost/api/v1/production/batches/not-a-uuid/cost"),
      context("not-a-uuid"),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for a malformed cost pool id", async () => {
    const response = await GET(
      new Request(`http://localhost/api/v1/production/batches/${BATCH_ID}/cost?costPoolId=nope`),
      context(BATCH_ID),
    );
    expect(response.status).toBe(400);
  });

  it("returns 404 when the batch is not found in the organization", async () => {
    vi.mocked(application.computeProductionBatchCost).mockRejectedValue(
      new DomainError("production batch not found in organization"),
    );
    const response = await GET(
      new Request(`http://localhost/api/v1/production/batches/${BATCH_ID}/cost`),
      context(BATCH_ID),
    );
    expect(response.status).toBe(404);
  });

  it("returns 400 when the batch is not completed", async () => {
    vi.mocked(application.computeProductionBatchCost).mockRejectedValue(
      new DomainError("a batch cost is only available for a completed batch (current: planned)"),
    );
    const response = await GET(
      new Request(`http://localhost/api/v1/production/batches/${BATCH_ID}/cost`),
      context(BATCH_ID),
    );
    expect(response.status).toBe(400);
  });
});
