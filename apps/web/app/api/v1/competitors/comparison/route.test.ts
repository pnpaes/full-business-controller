import type { CompetitorPriceComparisonRow, UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresCompetitorStore: vi.fn(() => ({})),
    compareCompetitorPrices: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../lib/auth", () => ({
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/organization", () => ({ resolveOrganization: vi.fn(() => "org-1") }));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../lib/server-session";

import { parseComparisonQuery } from "../competitor-rows";
import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const ITEM_ID = "77777777-7777-4777-8777-777777777777";
const FROM = "2026-03-01T00:00:00.000Z";
const TO = "2026-04-01T00:00:00.000Z";
const PATH = "/api/v1/competitors/comparison";

const comparison: CompetitorPriceComparisonRow = {
  comparable: true,
  observationId: "66666666-6666-4666-8666-666666666666",
  competitorId: "55555555-5555-4555-8555-555555555555",
  itemId: ITEM_ID,
  externalName: "Flat White",
  observedAt: "2026-03-05T09:30:00.000Z",
  competitorPrice: "45.0000",
  competitorCurrency: "NOK",
  currency: "NOK",
  difference: "5.0000",
  ratio: "1.125000",
  dateGapDays: 3,
  ourPrice: "40.0000",
  ourGrossPrice: "50.0000",
  ourPriceBasis: "net",
  ourPriceVersionId: "price-1",
  ourProductVariantId: "variant-1",
  ourPriceEffectiveFrom: "2026-03-02T00:00:00.000Z",
};

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function getRequest(query = ""): Request {
  return new Request(`http://localhost${PATH}${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.compareCompetitorPrices).mockResolvedValue([comparison]);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/competitors/comparison", () => {
  it("returns the paired comparison rows", async () => {
    const response = await GET(getRequest(`?from=${FROM}&to=${TO}`));

    expect(response.status).toBe(200);
    expect(application.compareCompetitorPrices).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, from: FROM, to: TO }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 200,
      offset: 0,
      comparisons: [comparison],
    });
  });

  it("passes an itemId filter through", async () => {
    await GET(getRequest(`?from=${FROM}&to=${TO}&itemId=${ITEM_ID}`));
    expect(application.compareCompetitorPrices).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ itemId: ITEM_ID }),
    );
  });

  it("returns 400 when from/to are missing or malformed", async () => {
    expect((await GET(getRequest())).status).toBe(400);
    expect((await GET(getRequest(`?from=${FROM}`))).status).toBe(400);
    expect((await GET(getRequest("?from=2026-03-01&to=2026-04-01"))).status).toBe(400);
    expect(application.compareCompetitorPrices).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out and 403 for a reader-less role", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);
    expect((await GET(getRequest(`?from=${FROM}&to=${TO}`))).status).toBe(401);

    vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));
    expect((await GET(getRequest(`?from=${FROM}&to=${TO}`))).status).toBe(403);
  });
});

describe("parseComparisonQuery", () => {
  it("requires from and to with paging defaults", () => {
    expect(parseComparisonQuery(new URLSearchParams({ from: FROM, to: TO }))).toEqual({
      ok: true,
      query: { from: FROM, to: TO, limit: 200, offset: 0 },
    });
    expect(parseComparisonQuery(new URLSearchParams({ from: FROM })).ok).toBe(false);
  });
});
