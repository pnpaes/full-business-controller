import type { UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresSimulationStore: vi.fn(() => ({})),
    simulateScenario: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../lib/server-session";

import { POST } from "./route";
import { parseSimulationBody } from "./simulation-body";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const RECIPE = "22222222-2222-4222-8222-222222222222";
const AS_OF = "2026-06-01T00:00:00.000Z";
const FROM = "2026-05-01T00:00:00.000Z";
const TO = "2026-05-31T23:59:59.000Z";

function result(overrides: Record<string, unknown> = {}) {
  return {
    asOf: AS_OF,
    locationId: LOCATION,
    currency: "NOK",
    period: { from: FROM, to: TO },
    baselineCost: "130.5000",
    scenarioCost: "143.5500",
    baselineRevenue: "1000.0000",
    scenarioRevenue: "1100.0000",
    baselineContribution: "869.5000",
    scenarioContribution: "956.4500",
    deltas: {
      cost: { absolute: "13.0500", relativePct: "10.00" },
      revenue: { absolute: "100.0000", relativePct: "10.00" },
      contribution: { absolute: "86.9500", relativePct: "10.00" },
    },
    baselinePostedNetSales: "1000.0000",
    lines: [],
    capacity: {
      baselineRequiredHours: "1.000000",
      scenarioRequiredHours: "1.100000",
      addedSuppliedHours: "0.000000",
      scenarioSuppliedHours: "1.000000",
      gapHours: "0.100000",
      note: "capacity is direct-labour hours only",
    },
    assumptions: ["the model is a what-if"],
    provenance: ["baseline units: summarizeSales"],
    unmodelled: ["channel fees and allocated overhead are not modelled"],
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    asOf: AS_OF,
    locationId: LOCATION,
    baseline: { periodFrom: FROM, periodTo: TO },
    ...overrides,
  };
}

function postRequest(payload: Record<string, unknown> = body()): Request {
  return new Request("http://localhost/api/v1/simulation", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresSimulationStore).mockReturnValue({} as never);
  vi.mocked(application.simulateScenario).mockResolvedValue(result() as never);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("POST /api/v1/simulation", () => {
  it("returns the modelled result", async () => {
    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(application.simulateScenario).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, locationId: LOCATION, asOf: AS_OF }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, ...result() });
  });

  it("passes the scenario deltas through", async () => {
    const response = await POST(
      postRequest(
        body({
          volumeChangePct: "10",
          priceChangePct: "-5",
          menuRemovals: [{ recipeId: RECIPE }],
          menuAdds: [{ recipeId: RECIPE, expectedUnitsPerPeriod: "50" }],
          headcountChange: [
            { roleCode: "kitchen", countDelta: "2", hoursPerPeriod: "160", costCenterId: RECIPE },
          ],
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(application.simulateScenario).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        volumeChangePct: "10",
        priceChangePct: "-5",
        menuRemovals: [{ recipeId: RECIPE }],
        menuAdds: [{ recipeId: RECIPE, expectedUnitsPerPeriod: "50" }],
        headcountChange: [
          { roleCode: "kitchen", countDelta: "2", hoursPerPeriod: "160", costCenterId: RECIPE },
        ],
      }),
    );
  });

  it.each(["owner", "general_manager", "location_manager", "finance", "admin", "analyst"])(
    "allows %s to run a simulation",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest());

      expect(response.status).toBe(200);
    },
  );

  it.each(["kitchen", "front_of_house", "purchasing"])(
    "returns 403 for %s, which may not read consolidated margin",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest());

      expect(response.status).toBe(403);
      expect(application.simulateScenario).not.toHaveBeenCalled();
    },
  );

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await POST(postRequest());

    expect(response.status).toBe(401);
    expect(application.simulateScenario).not.toHaveBeenCalled();
  });

  it("returns 403 for a cross-origin request", async () => {
    const request = new Request("http://localhost/api/v1/simulation", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify(body()),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(application.simulateScenario).not.toHaveBeenCalled();
  });

  it("denies a scoped caller a location outside their scope", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [OTHER_LOCATION]),
    );

    const response = await POST(postRequest());

    expect(response.status).toBe(403);
    expect(application.simulateScenario).not.toHaveBeenCalled();
  });

  it("allows a scoped caller their own location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await POST(postRequest());

    expect(response.status).toBe(200);
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.simulateScenario).mockRejectedValue(
      new DomainError("baseline.periodTo must be on or after baseline.periodFrom"),
    );

    const response = await POST(postRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "baseline.periodTo must be on or after baseline.periodFrom",
    });
  });

  it.each([
    body({ asOf: "not-a-date" }),
    body({ locationId: "not-a-uuid" }),
    body({ baseline: { periodFrom: FROM } }),
    body({ baseline: { periodFrom: TO, periodTo: FROM } }),
    body({ volumeChangePct: "abc" }),
    body({ priceChangePct: "1.2345678" }),
    body({ menuRemovals: [{ recipeId: "nope" }] }),
    body({ menuAdds: [{ recipeId: RECIPE, expectedUnitsPerPeriod: "1.2345678" }] }),
    body({ headcountChange: [{ roleCode: "", countDelta: "1", hoursPerPeriod: "1" }] }),
    body({
      headcountChange: [
        { roleCode: "kitchen", countDelta: "1", hoursPerPeriod: "1", costCenterId: "nope" },
      ],
    }),
  ])("returns 400 for the malformed body %j", async (payload) => {
    const response = await POST(postRequest(payload));

    expect(response.status).toBe(400);
    expect(application.simulateScenario).not.toHaveBeenCalled();
  });
});

describe("parseSimulationBody", () => {
  it("accepts the minimal scenario", () => {
    const parsed = parseSimulationBody(body());
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.scenario).toEqual({
      asOf: AS_OF,
      locationId: LOCATION,
      baseline: { periodFrom: FROM, periodTo: TO },
    });
  });

  it("accepts every optional dimension", () => {
    const parsed = parseSimulationBody(
      body({
        volumeChangePct: "+10",
        priceChangePct: "-20",
        wageChangePct: "5",
        menuAdds: [{ recipeId: RECIPE, expectedUnitsPerPeriod: "50" }],
        menuRemovals: [{ recipeId: RECIPE }],
        headcountChange: [{ roleCode: "kitchen", countDelta: "2", hoursPerPeriod: "160" }],
      }),
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.scenario.headcountChange).toEqual([
      { roleCode: "kitchen", countDelta: "2", hoursPerPeriod: "160" },
    ]);
  });

  it("rejects a non-object body", () => {
    expect(parseSimulationBody(undefined).ok).toBe(false);
  });
});
