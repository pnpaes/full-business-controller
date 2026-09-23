import type { CostCardDetailRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresCostCardCompositionStore: vi.fn(() => ({})),
    assembleCostCardComposition: vi.fn(),
    createPostgresCostCardStore: vi.fn(() => ({})),
    calculateCostCard: vi.fn(),
    createPostgresCostingReadStore: vi.fn(() => ({})),
    getCostCardDetail: vi.fn(),
    listCostCards: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/organization", () => ({ resolveOrganization: vi.fn(() => "org-1") }));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../lib/auth";
import { getServerSession } from "../../../../../lib/server-session";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const VARIANT = "11111111-1111-4111-8111-111111111111";
const LOCATION = "22222222-2222-4222-8222-222222222222";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "44444444-4444-4444-8444-444444444444";
const SNAPSHOT_ID = "55555555-5555-4555-8555-555555555555";
const AS_OF = "2026-06-01T00:00:00.000Z";

const COMPOSITION = {
  currency: "NOK",
  ingredientCost: "0.0060",
  packagingCost: "0.0002",
  directLaborCost: "0.0000",
  channelVariableCost: "0.0000",
  otherVariableCost: "0.0000",
  unitNetSales: "33.9130",
  allocatedUnitOverhead: "0.0000",
} as const;

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function detail(): CostCardDetailRecord {
  return {
    card: {
      id: CARD_ID,
      organizationId: ORG,
      productVariantId: VARIANT,
      locationId: LOCATION,
      channelId: null,
      recipeVersionId: "version-1",
      state: "draft",
      costSelectionPolicy: "latest_approved_price",
      calculatedAt: AS_OF,
      approvedBy: null,
      approvedAt: null,
      snapshotId: SNAPSHOT_ID,
    },
    snapshot: {
      id: SNAPSHOT_ID,
      organizationId: ORG,
      costCardId: CARD_ID,
      priceScenarioId: null,
      costSelectionPolicy: "latest_approved_price",
      asOf: AS_OF,
      taxRuleSnapshot: {},
      fxRateId: null,
      roundingMethod: "HALF_UP",
      roundingScales: {},
      ruleVersion: "calc-v1",
      totals: { currency: "NOK", unitVariableCost: "2.5610" },
      createdAt: AS_OF,
    },
    components: [],
    history: [],
  };
}

function readStoreStub() {
  return {
    findProductVariant: vi.fn(async () => undefined),
    findLocation: vi.fn(async () => undefined),
    findChannel: vi.fn(async () => undefined),
    findCostCenter: vi.fn(async () => undefined),
    findItem: vi.fn(async () => undefined),
    findUnit: vi.fn(async () => undefined),
  };
}

const validBody = {
  productVariantId: VARIANT,
  locationId: LOCATION,
  asOf: AS_OF,
  directLaborCost: "2.5548",
};

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/costing/cost-cards", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresCostCardCompositionStore).mockReturnValue({} as never);
  vi.mocked(application.createPostgresCostCardStore).mockReturnValue({} as never);
  vi.mocked(application.createPostgresCostingReadStore).mockReturnValue(readStoreStub() as never);
  vi.mocked(application.assembleCostCardComposition).mockResolvedValue({
    composition: COMPOSITION,
    components: [],
    recipeVersionId: "version-1",
    snapshotOptions: {},
    provenance: {
      recipeVersionId: "version-1",
      approvedUsableOutput: "1000",
      priceVersionId: "price-1",
      assembled: { ingredientCost: "0.0060", packagingCost: "0.0002", unitNetSales: "33.9130" },
      supplied: {
        directLaborCost: "2.5548",
        channelVariableCost: "0.0000",
        otherVariableCost: "0.0000",
        allocatedUnitOverhead: "0.0000",
      },
      resolved: {
        directLaborCost: false,
        channelVariableCost: false,
        allocatedUnitOverhead: false,
      },
      notes: [],
    },
  });
  vi.mocked(application.calculateCostCard).mockResolvedValue({
    costCardId: CARD_ID,
    snapshotId: SNAPSHOT_ID,
    totals: {
      currency: "NOK",
      unitVariableCostBeforeLabor: "0.0062",
      unitVariableCost: "2.5610",
      contributionBeforeDirectLabor: "33.9068",
      contributionAfterDirectLabor: "31.3520",
      contributionMarginPctBeforeLabor: "99.9817",
      contributionMarginPctAfterLabor: "92.4497",
      unitFullCost: "2.5610",
      fullCostMargin: "31.3520",
    },
  });
  vi.mocked(application.getCostCardDetail).mockResolvedValue(detail());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/costing/cost-cards", () => {
  it("assembles the composition and calculates the card for the session actor", async () => {
    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.assembleCostCardComposition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        productVariantId: VARIANT,
        locationId: LOCATION,
        channelId: null,
        recipeVersionId: null,
        asOf: new Date(AS_OF),
        directLaborCost: "2.5548",
      }),
    );
    expect(application.calculateCostCard).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        recipeVersionId: "version-1",
        costSelectionPolicy: "latest_approved_price",
        ruleVersion: "calc-v1",
        composition: COMPOSITION,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      costCardId: CARD_ID,
      snapshotId: SNAPSHOT_ID,
      costCard: { card: { id: CARD_ID }, totals: { unitVariableCost: "2.5610" } },
    });
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(401);
    expect(application.assembleCostCardComposition).not.toHaveBeenCalled();
  });

  it("returns 403 for a role outside the cost-card write set", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.assembleCostCardComposition).not.toHaveBeenCalled();
  });

  it("checks the role before parsing the body (session → role → parse)", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    // An empty body would otherwise be a 400; the role check must win, proving
    // the body is not parsed before authorization.
    const response = await POST(postRequest({}));

    expect(response.status).toBe(403);
  });

  it("allows a location_manager scoped to the body's location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await POST(postRequest(validBody));

    // location_manager is not in the provisional write set (matrix "Read" only).
    expect(response.status).toBe(403);
  });

  it("allows kitchen to draft a cost card", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.assembleCostCardComposition).toHaveBeenCalled();
  });

  it("returns 403 for a cross-origin request", async () => {
    const request = new Request("http://localhost/api/v1/costing/cost-cards", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify(validBody),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(application.assembleCostCardComposition).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing required field", async () => {
    const response = await POST(postRequest({ locationId: LOCATION, asOf: AS_OF }));

    expect(response.status).toBe(400);
    expect(application.assembleCostCardComposition).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-uuid variant", async () => {
    const response = await POST(postRequest({ ...validBody, productVariantId: "nope" }));

    expect(response.status).toBe(400);
    expect(application.assembleCostCardComposition).not.toHaveBeenCalled();
  });

  it("returns 400 for an unparseable asOf", async () => {
    const response = await POST(postRequest({ ...validBody, asOf: "not-a-date" }));

    expect(response.status).toBe(400);
    expect(application.assembleCostCardComposition).not.toHaveBeenCalled();
  });

  it("returns 400 when an optional jsonb field is present but not an object", async () => {
    const response = await POST(postRequest({ ...validBody, taxRuleSnapshot: "nope" }));

    expect(response.status).toBe(400);
    expect(application.assembleCostCardComposition).not.toHaveBeenCalled();
  });

  it("returns 400 when a money field is present as a number", async () => {
    const response = await POST(postRequest({ ...validBody, directLaborCost: 2.55 }));

    expect(response.status).toBe(400);
    expect(application.assembleCostCardComposition).not.toHaveBeenCalled();
  });

  it("returns 400 when a money field is present as a boolean", async () => {
    const response = await POST(postRequest({ ...validBody, directLaborCost: true }));

    expect(response.status).toBe(400);
    expect(application.assembleCostCardComposition).not.toHaveBeenCalled();
  });

  it("returns 400 when currency is present but not a string", async () => {
    const response = await POST(postRequest({ ...validBody, currency: 5 }));

    expect(response.status).toBe(400);
    expect(application.assembleCostCardComposition).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-uuid fxRateId", async () => {
    const response = await POST(postRequest({ ...validBody, fxRateId: "not-a-uuid" }));

    expect(response.status).toBe(400);
    expect(application.assembleCostCardComposition).not.toHaveBeenCalled();
  });

  it("passes costPoolId, unitsPerOrder and the overhead period to the assembler", async () => {
    const COST_POOL = "66666666-6666-4666-8666-666666666666";

    const response = await POST(
      postRequest({
        ...validBody,
        costPoolId: COST_POOL,
        unitsPerOrder: "2.000000",
        periodFrom: "2026-01-01T00:00:00.000Z",
        periodTo: "2026-02-01T00:00:00.000Z",
      }),
    );

    expect(response.status).toBe(200);
    expect(application.assembleCostCardComposition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        costPoolId: COST_POOL,
        unitsPerOrder: "2.000000",
        periodFrom: new Date("2026-01-01T00:00:00.000Z"),
        periodTo: new Date("2026-02-01T00:00:00.000Z"),
      }),
    );
  });

  it("returns 400 for a non-uuid costPoolId", async () => {
    const response = await POST(postRequest({ ...validBody, costPoolId: "not-a-uuid" }));

    expect(response.status).toBe(400);
    expect(application.assembleCostCardComposition).not.toHaveBeenCalled();
  });

  it("returns 400 when unitsPerOrder is present as a number", async () => {
    const response = await POST(postRequest({ ...validBody, unitsPerOrder: 2 }));

    expect(response.status).toBe(400);
    expect(application.assembleCostCardComposition).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid overhead period bound", async () => {
    const response = await POST(postRequest({ ...validBody, periodFrom: "not-a-date" }));

    expect(response.status).toBe(400);
    expect(application.assembleCostCardComposition).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.assembleCostCardComposition).mockRejectedValue(
      new DomainError("no effective price version for this variant, location, channel and date"),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "no effective price version for this variant, location, channel and date",
    });
  });

  it("keeps the caller's location scope in the authorization check", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [OTHER_LOCATION]),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.assembleCostCardComposition).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/costing/cost-cards", () => {
  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns 403 for a role with no cost-card access (front_of_house)", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["front_of_house"]));

    const response = await GET();

    expect(response.status).toBe(403);
    expect(application.listCostCards).not.toHaveBeenCalled();
  });

  it("returns the rows for a role with read access", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));
    vi.mocked(application.listCostCards).mockResolvedValue([]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, rows: [] });
  });
});
