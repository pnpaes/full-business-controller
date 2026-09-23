import type { UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresReportingStore: vi.fn(() => ({})),
    buildOperationsReport: vi.fn(),
    listOperationsReportRecords: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../lib/server-session";
import { parseOperationsReportQuery } from "../reporting-rows";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const FROM = "2026-09-01T00:00:00.000Z";
const TO = "2026-09-30T23:59:59.000Z";
const PATH = "/api/v1/reports/operations";
const QUERY = `?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&grain=month`;

function report(overrides: Record<string, unknown> = {}) {
  return {
    asOf: "2026-09-22T00:00:00.000Z",
    scope: { locationIds: null },
    period: { from: FROM, to: TO },
    grain: "month",
    currency: "NOK",
    stockValue: { asOf: "2026-09-22T00:00:00.000Z", rows: [], total: { valueOnHand: "0.0000" } },
    stockVariance: {
      rows: [],
      totals: { counts: 0, varianceQty: "0.000000", adjustmentValue: "0.0000" },
    },
    production: {
      rows: [],
      totals: {
        batches: 0,
        plannedOutput: "0.000000",
        actualOutput: "0.000000",
        yieldVariancePct: null,
        yieldRatio: null,
        inputValue: "0.0000",
        outputValue: "0.0000",
      },
    },
    waste: { rows: [], totals: { events: 0, quantity: "0.000000", value: null } },
    truncated: false,
    notes: ["stock value is a point-in-time ledger balance as of the report's as-of instant"],
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function getRequest(query = QUERY): Request {
  return new Request(`http://localhost${PATH}${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresReportingStore).mockReturnValue({} as never);
  vi.mocked(application.buildOperationsReport).mockResolvedValue(report() as never);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/reports/operations", () => {
  it("returns the report for the period", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.buildOperationsReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, from: FROM, to: TO, grain: "month" }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, ...report() });
  });

  it.each(["owner", "general_manager", "location_manager", "finance", "admin", "analyst"])(
    "allows %s to read the report",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest());

      expect(response.status).toBe(200);
    },
  );

  it.each(["kitchen", "front_of_house", "purchasing"])(
    "returns 403 for %s, which may not read consolidated reporting",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest());

      expect(response.status).toBe(403);
      expect(application.buildOperationsReport).not.toHaveBeenCalled();
    },
  );

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.buildOperationsReport).not.toHaveBeenCalled();
  });

  it("passes an explicit locationId through for an unscoped caller", async () => {
    const response = await GET(getRequest(`${QUERY}&locationId=${LOCATION}`));

    expect(response.status).toBe(200);
    expect(application.buildOperationsReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationIds: [LOCATION] }),
    );
  });

  it("denies a scoped caller an explicit out-of-scope locationId", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest(`${QUERY}&locationId=${OTHER_LOCATION}`));

    expect(response.status).toBe(403);
    expect(application.buildOperationsReport).not.toHaveBeenCalled();
  });

  it("pins a single-location caller to their location when no filter is given", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.buildOperationsReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationIds: [LOCATION] }),
    );
  });

  it("requires a locationId from a multi-location caller with no filter", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION, OTHER_LOCATION]),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(400);
    expect(application.buildOperationsReport).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.buildOperationsReport).mockRejectedValue(
      new DomainError("from must be on or before to"),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "from must be on or before to" });
  });

  it.each([
    `?to=${encodeURIComponent(TO)}&grain=month`,
    `?from=${encodeURIComponent(FROM)}&grain=month`,
    `?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&grain=quarter`,
    `?from=${encodeURIComponent(TO)}&to=${encodeURIComponent(FROM)}&grain=month`,
    `${QUERY}&locationId=not-a-uuid`,
  ])("returns 400 for the malformed query %j", async (query) => {
    const response = await GET(getRequest(query));

    expect(response.status).toBe(400);
    expect(application.buildOperationsReport).not.toHaveBeenCalled();
  });
});

describe("parseOperationsReportQuery", () => {
  it("parses the required fields and optional location", () => {
    const parsed = parseOperationsReportQuery(
      new URLSearchParams({ from: FROM, to: TO, grain: "week", locationId: LOCATION }),
    );

    expect(parsed.ok && parsed.query).toEqual({
      from: FROM,
      to: TO,
      grain: "week",
      locationId: LOCATION,
    });
  });

  it.each([
    new URLSearchParams({ to: TO, grain: "month" }),
    new URLSearchParams({ from: FROM, grain: "month" }),
    new URLSearchParams({ from: FROM, to: TO }),
    new URLSearchParams({ from: FROM, to: TO, grain: "quarter" }),
    new URLSearchParams({ from: TO, to: FROM, grain: "month" }),
    new URLSearchParams({ from: FROM, to: TO, grain: "month", locationId: "nope" }),
  ])("rejects the malformed query %j", (searchParams) => {
    expect(parseOperationsReportQuery(searchParams).ok).toBe(false);
  });
});
