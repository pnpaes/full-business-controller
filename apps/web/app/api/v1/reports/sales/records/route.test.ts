import type { UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresReportingStore: vi.fn(() => ({})),
    listSalesReportRecords: vi.fn(),
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
import { parseSalesReportRecordsQuery } from "../../reporting-rows";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const FROM = "2026-09-01T00:00:00.000Z";
const TO = "2026-09-30T23:59:59.000Z";
const PATH = "/api/v1/reports/sales/records";
const QUERY = `?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&grain=month`;

function records(overrides: Record<string, unknown> = {}) {
  return {
    asOf: "2026-09-22T00:00:00.000Z",
    scope: { locationIds: null, channelId: null, category: null, productVariantId: null },
    period: { from: FROM, to: TO },
    grain: "month",
    currency: "NOK",
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
  vi.mocked(application.listSalesReportRecords).mockResolvedValue(records() as never);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/reports/sales/records", () => {
  it("returns the drill-down for the period", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listSalesReportRecords).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
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
    "returns 403 for %s, which may not read consolidated margin",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest());

      expect(response.status).toBe(403);
      expect(application.listSalesReportRecords).not.toHaveBeenCalled();
    },
  );

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listSalesReportRecords).not.toHaveBeenCalled();
  });

  it("passes the optional dimension filters through for an unscoped caller", async () => {
    const response = await GET(
      getRequest(
        `${QUERY}&locationId=${LOCATION}&channelId=${LOCATION}&category=coffee&productVariantId=${LOCATION}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(application.listSalesReportRecords).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        locationIds: [LOCATION],
        channelId: LOCATION,
        category: "coffee",
        productVariantId: LOCATION,
      }),
    );
  });

  it("denies a scoped caller an explicit out-of-scope locationId", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest(`${QUERY}&locationId=${OTHER_LOCATION}`));

    expect(response.status).toBe(403);
    expect(application.listSalesReportRecords).not.toHaveBeenCalled();
  });

  it("denies a scoped caller an out-of-scope entry in the locationIds list", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest(`${QUERY}&locationIds=${LOCATION},${OTHER_LOCATION}`));

    expect(response.status).toBe(403);
    expect(application.listSalesReportRecords).not.toHaveBeenCalled();
  });

  it("pins a single-location caller to their location when no filter is given", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listSalesReportRecords).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationIds: [LOCATION] }),
    );
  });

  it("accepts a multi-location caller's full scope when no filter is given (F3)", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION, OTHER_LOCATION]),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listSalesReportRecords).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationIds: [LOCATION, OTHER_LOCATION] }),
    );
  });

  it("accepts an explicit multi-location scope list (F3)", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION, OTHER_LOCATION]),
    );

    const response = await GET(getRequest(`${QUERY}&locationIds=${LOCATION},${OTHER_LOCATION}`));

    expect(response.status).toBe(200);
    expect(application.listSalesReportRecords).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationIds: [LOCATION, OTHER_LOCATION] }),
    );
  });

  it("lets an explicit single location narrow an explicit list (F3)", async () => {
    const response = await GET(
      getRequest(`${QUERY}&locationId=${LOCATION}&locationIds=${LOCATION},${OTHER_LOCATION}`),
    );

    expect(response.status).toBe(200);
    expect(application.listSalesReportRecords).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationIds: [LOCATION] }),
    );
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.listSalesReportRecords).mockRejectedValue(
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
    `${QUERY}&locationIds=not-a-uuid`,
    `${QUERY}&locationIds=${LOCATION},`,
    `${QUERY}&channelId=not-a-uuid`,
    `${QUERY}&productVariantId=not-a-uuid`,
    `${QUERY}&limit=0`,
    `${QUERY}&limit=501`,
    `${QUERY}&offset=501`,
  ])("returns 400 for the malformed query %j", async (query) => {
    const response = await GET(getRequest(query));

    expect(response.status).toBe(400);
    expect(application.listSalesReportRecords).not.toHaveBeenCalled();
  });
});

describe("parseSalesReportRecordsQuery", () => {
  it("parses the period, grain, bounded paging and the location scope list", () => {
    const parsed = parseSalesReportRecordsQuery(
      new URLSearchParams({
        from: FROM,
        to: TO,
        grain: "day",
        locationIds: `${LOCATION},${OTHER_LOCATION}`,
        limit: "25",
        offset: "5",
      }),
    );

    expect(parsed.ok && parsed.query).toEqual({
      from: FROM,
      to: TO,
      grain: "day",
      locationIds: [LOCATION, OTHER_LOCATION],
      limit: 25,
      offset: 5,
    });
  });

  it("defaults limit and offset when omitted", () => {
    const parsed = parseSalesReportRecordsQuery(
      new URLSearchParams({ from: FROM, to: TO, grain: "month" }),
    );

    expect(parsed.ok && parsed.query.limit).toBe(100);
    expect(parsed.ok && parsed.query.offset).toBe(0);
  });

  it("ignores a groupBy parameter (the drill-down does not group)", () => {
    const parsed = parseSalesReportRecordsQuery(
      new URLSearchParams({ from: FROM, to: TO, grain: "month", groupBy: "category" }),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.query).not.toHaveProperty("groupBy");
  });

  it.each([
    new URLSearchParams({ from: FROM, to: TO, grain: "month", limit: "0" }),
    new URLSearchParams({ from: FROM, to: TO, grain: "month", limit: "501" }),
    new URLSearchParams({ from: FROM, to: TO, grain: "month", offset: "501" }),
    new URLSearchParams({ from: FROM, to: TO, grain: "month", limit: "x" }),
    new URLSearchParams({ from: FROM, to: TO, grain: "quarter" }),
    new URLSearchParams({ from: FROM, to: TO, grain: "month", locationIds: `${LOCATION},` }),
    new URLSearchParams({ from: FROM, to: TO, grain: "month", locationIds: "nope" }),
  ])("rejects the malformed query %j", (searchParams) => {
    expect(parseSalesReportRecordsQuery(searchParams).ok).toBe(false);
  });
});
