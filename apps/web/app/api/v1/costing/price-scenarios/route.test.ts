import type { PriceScenarioOutcome, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresCostingReadStore: vi.fn(() => ({})),
    createPostgresPriceScenarioStore: vi.fn(() => ({})),
    calculatePriceScenario: vi.fn(),
    listPriceScenarios: vi.fn(),
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

import { getServerSession } from "../../../../../lib/server-session";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const VARIANT = "11111111-1111-4111-8111-111111111111";
const LOCATION = "22222222-2222-4222-8222-222222222222";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const SCENARIO_ID = "44444444-4444-4444-8444-444444444444";
const SNAPSHOT_ID = "55555555-5555-4555-8555-555555555555";

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

const OUTCOME: PriceScenarioOutcome = {
  grossPrice: "49.0000",
  netPrice: "42.6087",
  unitVariableCost: "9.3348",
  channelVariableCost: "0.0000",
  unitContribution: "33.2739",
  contributionMarginPct: "0.780918",
  requiredNetPrice: null,
  requiredGrossPrice: null,
  includedTax: null,
  presentedNetPrice: "42.61",
  presentedGrossPrice: "49.00",
  breakEvenUnits: null,
};

const validBody = {
  productVariantId: VARIANT,
  unitVariableCost: "9.3348",
  taxBasis: "inclusive",
  taxRate: "0.150000",
  grossPrice: "49.0000",
};

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/costing/price-scenarios", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresPriceScenarioStore).mockReturnValue({} as never);
  vi.mocked(application.calculatePriceScenario).mockResolvedValue({
    priceScenarioId: SCENARIO_ID,
    snapshotId: SNAPSHOT_ID,
    outcome: OUTCOME,
  });
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("POST /api/v1/costing/price-scenarios", () => {
  it("calculates a draft scenario for the session actor and returns its outcome", async () => {
    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.calculatePriceScenario).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        productVariantId: VARIANT,
        unitVariableCost: "9.3348",
        taxBasis: "inclusive",
        taxRate: "0.150000",
        grossPrice: "49.0000",
        locationId: null,
        channelId: null,
        costSelectionPolicy: "latest_approved_price",
        ruleVersion: "calc-v1",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      priceScenarioId: SCENARIO_ID,
      snapshotId: SNAPSHOT_ID,
      outcome: { netPrice: "42.6087", unitContribution: "33.2739" },
    });
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(401);
    expect(application.calculatePriceScenario).not.toHaveBeenCalled();
  });

  it("returns 403 for a role outside the Prices write set (finance Review)", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.calculatePriceScenario).not.toHaveBeenCalled();
  });

  it("checks the role before parsing the body (session → role → parse)", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await POST(postRequest({}));

    expect(response.status).toBe(403);
  });

  it("returns 403 for a cross-origin request", async () => {
    const request = new Request("http://localhost/api/v1/costing/price-scenarios", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify(validBody),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(application.calculatePriceScenario).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing required field", async () => {
    const response = await POST(postRequest({ productVariantId: VARIANT, taxBasis: "inclusive" }));

    expect(response.status).toBe(400);
    expect(application.calculatePriceScenario).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-uuid product variant", async () => {
    const response = await POST(postRequest({ ...validBody, productVariantId: "nope" }));

    expect(response.status).toBe(400);
    expect(application.calculatePriceScenario).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown tax basis", async () => {
    const response = await POST(postRequest({ ...validBody, taxBasis: "vat" }));

    expect(response.status).toBe(400);
    expect(application.calculatePriceScenario).not.toHaveBeenCalled();
  });

  it("returns 400 when an optional value is present as a number", async () => {
    const response = await POST(postRequest({ ...validBody, grossPrice: 49 }));

    expect(response.status).toBe(400);
    expect(application.calculatePriceScenario).not.toHaveBeenCalled();
  });

  it("passes a complete channel fee through to the command", async () => {
    const response = await POST(
      postRequest({
        ...validBody,
        discount: "5.0000",
        fixedCost: "1000.0000",
        volumeAssumption: "500.000000",
        channelFee: {
          percentageFeeRate: "0.025000",
          feeBasisAmount: "49.0000",
          fixedOrderFeePerUnit: "1.0000",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(application.calculatePriceScenario).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        discount: "5.0000",
        fixedCost: "1000.0000",
        volumeAssumption: "500.000000",
        channelFee: {
          percentageFeeRate: "0.025000",
          feeBasisAmount: "49.0000",
          fixedOrderFeePerUnit: "1.0000",
        },
      }),
    );
  });

  it("returns 400 for a partial channel fee object", async () => {
    const response = await POST(
      postRequest({ ...validBody, channelFee: { percentageFeeRate: "0.025000" } }),
    );

    expect(response.status).toBe(400);
    expect(application.calculatePriceScenario).not.toHaveBeenCalled();
  });

  it("allows a location_manager scoped to the body's location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await POST(postRequest({ ...validBody, locationId: LOCATION }));

    expect(response.status).toBe(200);
    expect(application.calculatePriceScenario).toHaveBeenCalled();
  });

  it("keeps the caller's location scope in the authorization check", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [OTHER_LOCATION]),
    );

    const response = await POST(postRequest({ ...validBody, locationId: LOCATION }));

    expect(response.status).toBe(403);
    expect(application.calculatePriceScenario).not.toHaveBeenCalled();
  });

  it("maps a DomainError from the command to 400 with its message", async () => {
    vi.mocked(application.calculatePriceScenario).mockRejectedValue(
      new DomainError("product variant belongs to another organization"),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "product variant belongs to another organization",
    });
  });
});

describe("GET /api/v1/costing/price-scenarios", () => {
  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET();

    expect(response.status).toBe(401);
  });
});
