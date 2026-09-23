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

vi.mock("../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../../lib/server-session";
import { parseOperationsReportRecordsQuery } from "../../reporting-rows";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const FROM = "2026-09-01T00:00:00.000Z";
const TO = "2026-09-30T23:59:59.000Z";
const PATH = "/api/v1/reports/operations/records";
const QUERY = `?section=waste&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&grain=month`;

function records(overrides: Record<string, unknown> = {}) {
  return {
    asOf: "2026-09-22T00:00:00.000Z",
    scope: { locationIds: null },
    period: { from: FROM, to: TO },
    grain: "month",
    currency: "NOK",
    section: "waste",
    records: [],
    truncated: false,
    limit: 100,
    offset: 0,
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
  vi.mocked(application.listOperationsReportRecords).mockResolvedValue(records() as never);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/reports/operations/records", () => {
  it("returns the section drill-down for the period", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listOperationsReportRecords).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        section: "waste",
        from: FROM,
        to: TO,
        grain: "month",
        limit: 100,
        offset: 0,
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, ...records() });
  });

  it.each(["owner", "general_manager", "location_manager", "finance", "admin", "analyst"])(
    "allows %s to read the drill-down",
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
      expect(application.listOperationsReportRecords).not.toHaveBeenCalled();
    },
  );

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listOperationsReportRecords).not.toHaveBeenCalled();
  });

  it("passes the report's stock-value asOf through to the drill-down", async () => {
    const response = await GET(
      getRequest(
        `?section=stock_value&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&grain=month&asOf=${encodeURIComponent(FROM)}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(application.listOperationsReportRecords).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ section: "stock_value", asOf: FROM }),
    );
  });

  it("passes the section and an explicit locationId through for an unscoped caller", async () => {
    const response = await GET(
      getRequest(
        `?section=production&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&grain=month&locationId=${LOCATION}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(application.listOperationsReportRecords).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ section: "production", locationIds: [LOCATION] }),
    );
  });

  it("denies a scoped caller an explicit out-of-scope locationId", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest(`${QUERY}&locationId=${OTHER_LOCATION}`));

    expect(response.status).toBe(403);
    expect(application.listOperationsReportRecords).not.toHaveBeenCalled();
  });

  it("denies a scoped caller an out-of-scope entry in the locationIds list", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest(`${QUERY}&locationIds=${LOCATION},${OTHER_LOCATION}`));

    expect(response.status).toBe(403);
    expect(application.listOperationsReportRecords).not.toHaveBeenCalled();
  });

  it("pins a single-location caller to their location when no filter is given", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listOperationsReportRecords).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationIds: [LOCATION] }),
    );
  });

  it("accepts a multi-location caller's full scope when no filter is given", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION, OTHER_LOCATION]),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listOperationsReportRecords).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationIds: [LOCATION, OTHER_LOCATION] }),
    );
  });

  it("lets an explicit single location narrow an explicit list", async () => {
    const response = await GET(
      getRequest(`${QUERY}&locationId=${LOCATION}&locationIds=${LOCATION},${OTHER_LOCATION}`),
    );

    expect(response.status).toBe(200);
    expect(application.listOperationsReportRecords).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationIds: [LOCATION] }),
    );
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.listOperationsReportRecords).mockRejectedValue(
      new DomainError('unknown operations report section "stock_turn"'),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'unknown operations report section "stock_turn"',
    });
  });

  it.each([
    `?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&grain=month`,
    `?section=stock_turn&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&grain=month`,
    `?section=waste&to=${encodeURIComponent(TO)}&grain=month`,
    `?section=waste&from=${encodeURIComponent(FROM)}&grain=month`,
    `?section=waste&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&grain=quarter`,
    `?section=waste&from=${encodeURIComponent(TO)}&to=${encodeURIComponent(FROM)}&grain=month`,
    `${QUERY}&locationId=not-a-uuid`,
    `${QUERY}&locationIds=not-a-uuid`,
    `${QUERY}&locationIds=${LOCATION},`,
    `${QUERY}&asOf=not-an-instant`,
    `${QUERY}&limit=0`,
    `${QUERY}&limit=501`,
    `${QUERY}&offset=501`,
  ])("returns 400 for the malformed query %j", async (query) => {
    const response = await GET(getRequest(query));

    expect(response.status).toBe(400);
    expect(application.listOperationsReportRecords).not.toHaveBeenCalled();
  });
});

describe("parseOperationsReportRecordsQuery", () => {
  it("parses the section, period, grain, scope list and bounded paging", () => {
    const parsed = parseOperationsReportRecordsQuery(
      new URLSearchParams({
        section: "stock_value",
        from: FROM,
        to: TO,
        grain: "day",
        locationIds: `${LOCATION},${OTHER_LOCATION}`,
        limit: "25",
        offset: "5",
      }),
    );

    expect(parsed.ok && parsed.query).toEqual({
      section: "stock_value",
      from: FROM,
      to: TO,
      grain: "day",
      locationIds: [LOCATION, OTHER_LOCATION],
      limit: 25,
      offset: 5,
    });
  });

  it("defaults limit and offset when omitted", () => {
    const parsed = parseOperationsReportRecordsQuery(
      new URLSearchParams({ section: "production", from: FROM, to: TO, grain: "month" }),
    );

    expect(parsed.ok && parsed.query.limit).toBe(100);
    expect(parsed.ok && parsed.query.offset).toBe(0);
  });

  it("parses and validates the optional stock-value asOf", () => {
    const parsed = parseOperationsReportRecordsQuery(
      new URLSearchParams({
        section: "stock_value",
        from: FROM,
        to: TO,
        grain: "month",
        asOf: FROM,
      }),
    );
    expect(parsed.ok && parsed.query.asOf).toBe(FROM);

    const malformed = parseOperationsReportRecordsQuery(
      new URLSearchParams({
        section: "stock_value",
        from: FROM,
        to: TO,
        grain: "month",
        asOf: "not-an-instant",
      }),
    );
    expect(malformed.ok).toBe(false);
  });

  it.each([
    new URLSearchParams({ from: FROM, to: TO, grain: "month" }),
    new URLSearchParams({ section: "stock_turn", from: FROM, to: TO, grain: "month" }),
    new URLSearchParams({ section: "waste", from: FROM, to: TO, grain: "month", limit: "0" }),
    new URLSearchParams({ section: "waste", from: FROM, to: TO, grain: "month", limit: "501" }),
    new URLSearchParams({ section: "waste", from: FROM, to: TO, grain: "month", offset: "501" }),
    new URLSearchParams({
      section: "waste",
      from: FROM,
      to: TO,
      grain: "month",
      locationIds: "nope",
    }),
  ])("rejects the malformed query %j", (searchParams) => {
    expect(parseOperationsReportRecordsQuery(searchParams).ok).toBe(false);
  });
});
