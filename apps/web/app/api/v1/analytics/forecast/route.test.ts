import type { UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresReportingStore: vi.fn(() => ({})),
    computeForecast: vi.fn(),
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
import { parseForecastQuery } from "../analytics-rows";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const PATH = "/api/v1/analytics/forecast";
const QUERY = "?metric=revenue&grain=month";

function result(overrides: Record<string, unknown> = {}) {
  return {
    asOf: "2026-09-22T00:00:00.000Z",
    metric: "revenue",
    metricLabel: "Net sales",
    unit: "money",
    grain: "month",
    scope: { locationIds: null, channelId: null },
    status: "ok",
    method: "least-squares",
    history: [],
    projection: [],
    model: null,
    accuracy: null,
    insufficient: null,
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
  vi.mocked(application.computeForecast).mockResolvedValue(result() as never);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/analytics/forecast", () => {
  it("returns the forecast and passes the window through", async () => {
    const response = await GET(getRequest(`${QUERY}&historyPeriods=6&horizonPeriods=2`));
    expect(response.status).toBe(200);
    expect(application.computeForecast).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        metric: "revenue",
        grain: "month",
        historyPeriods: 6,
        horizonPeriods: 2,
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, ...result() });
  });

  it("returns 401 when signed out and 403 for a denied role", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);
    expect((await GET(getRequest())).status).toBe(401);

    vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));
    expect((await GET(getRequest())).status).toBe(403);
  });

  it.each([
    "?grain=month",
    "?metric=revenue",
    "?metric=revenue&grain=quarter",
    `${QUERY}&historyPeriods=0`,
    `${QUERY}&horizonPeriods=61`,
    `${QUERY}&locationId=not-a-uuid`,
  ])("returns 400 for the malformed query %j", async (query) => {
    expect((await GET(getRequest(query))).status).toBe(400);
    expect(application.computeForecast).not.toHaveBeenCalled();
  });
});

describe("parseForecastQuery", () => {
  it("parses the required fields and optional windows", () => {
    const parsed = parseForecastQuery(
      new URLSearchParams({
        metric: "production_yield",
        grain: "week",
        historyPeriods: "8",
        horizonPeriods: "2",
      }),
    );
    expect(parsed.ok && parsed.query).toEqual({
      metric: "production_yield",
      grain: "week",
      historyPeriods: 8,
      horizonPeriods: 2,
    });
  });

  it("rejects an unknown metric", () => {
    expect(parseForecastQuery(new URLSearchParams({ metric: "x", grain: "month" })).ok).toBe(false);
  });
});
