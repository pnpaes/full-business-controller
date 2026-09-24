import type { UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresReportingStore: vi.fn(() => ({})),
    computeBenchmarks: vi.fn(),
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
import { parseBenchmarksQuery } from "../analytics-rows";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const FROM = "2026-09-01T00:00:00.000Z";
const TO = "2026-09-30T23:59:59.000Z";
const PATH = "/api/v1/analytics/benchmarks";
const QUERY = `?dimension=location&metric=revenue&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`;

function report(overrides: Record<string, unknown> = {}) {
  return {
    asOf: "2026-09-22T00:00:00.000Z",
    metric: "revenue",
    metricLabel: "Net sales",
    unit: "money",
    dimension: "location",
    dimensionLabel: "Location",
    period: { from: FROM, to: TO },
    scope: { locationIds: null, channelId: null },
    basis: "internal",
    basisNote: "internal",
    organizationAggregate: "0.0000",
    peerMedian: null,
    entities: [],
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
  vi.mocked(application.computeBenchmarks).mockResolvedValue(report() as never);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/analytics/benchmarks", () => {
  it("returns the internal benchmark for the period", async () => {
    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    expect(application.computeBenchmarks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        dimension: "location",
        metric: "revenue",
        period: { from: FROM, to: TO },
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, ...report() });
  });

  it("returns 401 when signed out and 403 for a denied role", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);
    expect((await GET(getRequest())).status).toBe(401);

    vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));
    expect((await GET(getRequest())).status).toBe(403);
  });

  it("passes an in-scope locationId through", async () => {
    const response = await GET(getRequest(`${QUERY}&locationId=${LOCATION}`));
    expect(response.status).toBe(200);
    expect(application.computeBenchmarks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationIds: [LOCATION] }),
    );
  });

  it.each([
    `?metric=revenue&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
    `?dimension=location&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
    `?dimension=location&metric=production_yield&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
    `?dimension=supplier&metric=revenue&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
    `?dimension=location&metric=revenue&from=${encodeURIComponent(TO)}&to=${encodeURIComponent(FROM)}`,
    `${QUERY}&locationId=not-a-uuid`,
  ])("returns 400 for the malformed query %j", async (query) => {
    expect((await GET(getRequest(query))).status).toBe(400);
    expect(application.computeBenchmarks).not.toHaveBeenCalled();
  });
});

describe("parseBenchmarksQuery", () => {
  it("parses the required fields", () => {
    const parsed = parseBenchmarksQuery(
      new URLSearchParams({ dimension: "product", metric: "units", from: FROM, to: TO }),
    );
    expect(parsed.ok && parsed.query).toEqual({
      dimension: "product",
      metric: "units",
      from: FROM,
      to: TO,
    });
  });

  it.each([
    new URLSearchParams({ metric: "revenue", from: FROM, to: TO }),
    new URLSearchParams({ dimension: "location", from: FROM, to: TO }),
    new URLSearchParams({ dimension: "location", metric: "waste", from: FROM, to: TO }),
  ])("rejects the malformed query %j", (searchParams) => {
    expect(parseBenchmarksQuery(searchParams).ok).toBe(false);
  });
});
