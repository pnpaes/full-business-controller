import type { UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresReportingStore: vi.fn(() => ({})),
    computeSuggestions: vi.fn(),
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
import { parseSuggestionsQuery } from "../analytics-rows";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const FROM = "2026-09-01T00:00:00.000Z";
const TO = "2026-09-30T23:59:59.000Z";
const PATH = "/api/v1/analytics/suggestions";
const QUERY = `?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`;

function report(overrides: Record<string, unknown> = {}) {
  return {
    asOf: "2026-09-22T00:00:00.000Z",
    period: { from: FROM, to: TO },
    scope: { locationIds: null, channelId: null },
    posture: "advisory_only",
    postureNote: "advisory",
    suggestions: [],
    evaluated: [],
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
  vi.mocked(application.computeSuggestions).mockResolvedValue(report() as never);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/analytics/suggestions", () => {
  it("returns the advisory suggestions for the period", async () => {
    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    expect(application.computeSuggestions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
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

  it("passes the optional grain, trendPeriods and in-scope locationId through", async () => {
    const response = await GET(
      getRequest(`${QUERY}&grain=week&trendPeriods=6&locationId=${LOCATION}`),
    );
    expect(response.status).toBe(200);
    expect(application.computeSuggestions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ grain: "week", trendPeriods: 6, locationIds: [LOCATION] }),
    );
  });

  it.each([
    `?to=${encodeURIComponent(TO)}`,
    `?from=${encodeURIComponent(FROM)}`,
    `?from=${encodeURIComponent(TO)}&to=${encodeURIComponent(FROM)}`,
    `${QUERY}&grain=quarter`,
    `${QUERY}&trendPeriods=1`,
    `${QUERY}&locationId=not-a-uuid`,
  ])("returns 400 for the malformed query %j", async (query) => {
    expect((await GET(getRequest(query))).status).toBe(400);
    expect(application.computeSuggestions).not.toHaveBeenCalled();
  });
});

describe("parseSuggestionsQuery", () => {
  it("parses the period and optional filters", () => {
    const parsed = parseSuggestionsQuery(
      new URLSearchParams({ from: FROM, to: TO, grain: "month", trendPeriods: "4" }),
    );
    expect(parsed.ok && parsed.query).toEqual({
      from: FROM,
      to: TO,
      grain: "month",
      trendPeriods: 4,
    });
  });

  it.each([
    new URLSearchParams({ to: TO }),
    new URLSearchParams({ from: FROM }),
    new URLSearchParams({ from: FROM, to: TO, grain: "quarter" }),
  ])("rejects the malformed query %j", (searchParams) => {
    expect(parseSuggestionsQuery(searchParams).ok).toBe(false);
  });
});
