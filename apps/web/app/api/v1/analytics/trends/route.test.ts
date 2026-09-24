import type { UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresReportingStore: vi.fn(() => ({})),
    computeTrends: vi.fn(),
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
import { parseTrendsQuery } from "../analytics-rows";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const PATH = "/api/v1/analytics/trends";
const QUERY = "?metric=revenue&grain=month";

function trend(overrides: Record<string, unknown> = {}) {
  return {
    asOf: "2026-09-22T00:00:00.000Z",
    metric: "revenue",
    metricLabel: "Net sales",
    unit: "money",
    grain: "month",
    scope: { locationIds: null, channelId: null },
    method: "period-over-period",
    flatBandFraction: "0.050000",
    points: [],
    notes: [],
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
  vi.mocked(application.computeTrends).mockResolvedValue(trend() as never);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/analytics/trends", () => {
  it("returns the trend series for the metric", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.computeTrends).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, metric: "revenue", grain: "month" }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, ...trend() });
  });

  it.each(["owner", "general_manager", "location_manager", "finance", "admin", "analyst"])(
    "allows %s",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));
      expect((await GET(getRequest())).status).toBe(200);
    },
  );

  it.each(["kitchen", "front_of_house", "purchasing"])("returns 403 for %s", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));
    const response = await GET(getRequest());
    expect(response.status).toBe(403);
    expect(application.computeTrends).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);
    expect((await GET(getRequest())).status).toBe(401);
  });

  it("passes the optional filters and periods through", async () => {
    const response = await GET(
      getRequest(`${QUERY}&locationId=${LOCATION}&channelId=${LOCATION}&periods=3`),
    );
    expect(response.status).toBe(200);
    expect(application.computeTrends).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationIds: [LOCATION], channelId: LOCATION, periods: 3 }),
    );
  });

  it("denies a scoped caller an out-of-scope locationId", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    const response = await GET(getRequest(`${QUERY}&locationId=${OTHER_LOCATION}`));
    expect(response.status).toBe(403);
  });

  it("pins a single-location caller to their location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    await GET(getRequest());
    expect(application.computeTrends).toHaveBeenCalledWith(
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
    expect(application.computeTrends).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.computeTrends).mockRejectedValue(new DomainError("bad period"));
    const response = await GET(getRequest());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad period" });
  });

  it.each([
    "?grain=month",
    "?metric=revenue",
    "?metric=profit&grain=month",
    "?metric=revenue&grain=quarter",
    `${QUERY}&locationId=not-a-uuid`,
    `${QUERY}&channelId=not-a-uuid`,
    `${QUERY}&periods=0`,
    `${QUERY}&periods=61`,
  ])("returns 400 for the malformed query %j", async (query) => {
    const response = await GET(getRequest(query));
    expect(response.status).toBe(400);
    expect(application.computeTrends).not.toHaveBeenCalled();
  });
});

describe("parseTrendsQuery", () => {
  it("parses the required fields and optional filters", () => {
    const parsed = parseTrendsQuery(
      new URLSearchParams({ metric: "units", grain: "week", locationId: LOCATION, periods: "4" }),
    );
    expect(parsed.ok && parsed.query).toEqual({
      metric: "units",
      grain: "week",
      locationId: LOCATION,
      periods: 4,
    });
  });

  it.each([
    new URLSearchParams({ grain: "month" }),
    new URLSearchParams({ metric: "revenue" }),
    new URLSearchParams({ metric: "profit", grain: "month" }),
    new URLSearchParams({ metric: "revenue", grain: "quarter" }),
    new URLSearchParams({ metric: "revenue", grain: "month", periods: "0" }),
  ])("rejects the malformed query %j", (searchParams) => {
    expect(parseTrendsQuery(searchParams).ok).toBe(false);
  });
});
