import type { CompetitorObservationRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresCompetitorStore: vi.fn(() => ({})),
    listCompetitorObservations: vi.fn(),
    recordCompetitorObservation: vi.fn(),
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

import { requireSession } from "../../../../../lib/auth";
import { getServerSession } from "../../../../../lib/server-session";

import { parseObservationListQuery, parseRecordObservationBody } from "../competitor-rows";
import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const COMPETITOR_ID = "55555555-5555-4555-8555-555555555555";
const OBSERVATION_ID = "66666666-6666-4666-8666-666666666666";
const OBSERVED_AT = "2026-03-05T09:30:00.000Z";
const PATH = "/api/v1/competitors/observations";

function observationRecord(
  overrides: Partial<CompetitorObservationRecord> = {},
): CompetitorObservationRecord {
  return {
    id: OBSERVATION_ID,
    organizationId: ORG,
    competitorId: COMPETITOR_ID,
    observedAt: OBSERVED_AT,
    source: "menu photo",
    sourceUrl: null,
    itemId: null,
    externalName: "Flat White",
    price: null,
    currency: null,
    offerNotes: null,
    reviewStatus: "pending",
    reviewedBy: null,
    reviewedAt: null,
    competitorSourceId: null,
    captureMethod: null,
    productCategory: null,
    season: null,
    provenance: {},
    contentHash: null,
    createdAt: "2026-03-05T09:30:00.000Z",
    ...overrides,
  };
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function getRequest(query = ""): Request {
  return new Request(`http://localhost${PATH}${query}`);
}

function postRequest(body: unknown): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.listCompetitorObservations).mockResolvedValue([]);
  vi.mocked(application.recordCompetitorObservation).mockResolvedValue(observationRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/competitors/observations", () => {
  it("asks for the reviewed set by default (no status passed)", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listCompetitorObservations).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ status: expect.anything() }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 200,
      offset: 0,
      observations: [],
    });
  });

  it("passes an explicit pending filter and the window through", async () => {
    await GET(
      getRequest(
        `?status=pending&competitorId=${COMPETITOR_ID}&from=2026-03-01T00:00:00.000Z&to=2026-04-01T00:00:00.000Z`,
      ),
    );

    expect(application.listCompetitorObservations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "pending",
        competitorId: COMPETITOR_ID,
        from: "2026-03-01T00:00:00.000Z",
        to: "2026-04-01T00:00:00.000Z",
      }),
    );
  });

  it("returns 401 when signed out, 403 for a read-less role, 400 for a bad filter", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);
    expect((await GET(getRequest())).status).toBe(401);

    vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));
    expect((await GET(getRequest())).status).toBe(403);

    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
    expect((await GET(getRequest("?status=bogus"))).status).toBe(400);
  });
});

describe("POST /api/v1/competitors/observations", () => {
  it("records a pending observation for the session actor", async () => {
    const response = await POST(
      postRequest({
        competitorId: COMPETITOR_ID,
        observedAt: OBSERVED_AT,
        source: "menu photo",
        externalName: "Flat White",
        price: "42.5",
        currency: "NOK",
      }),
    );

    expect(response.status).toBe(200);
    expect(application.recordCompetitorObservation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        competitorId: COMPETITOR_ID,
        observedAt: OBSERVED_AT,
        price: "42.5",
        currency: "NOK",
      }),
    );
  });

  it.each([
    {},
    { competitorId: "nope", observedAt: OBSERVED_AT, source: "x", externalName: "y" },
    { competitorId: COMPETITOR_ID, observedAt: "2026-03-05", source: "x", externalName: "y" },
    {
      competitorId: COMPETITOR_ID,
      observedAt: OBSERVED_AT,
      source: "x",
      externalName: "y",
      price: -1,
    },
    {
      competitorId: COMPETITOR_ID,
      observedAt: OBSERVED_AT,
      source: "x",
      externalName: "y",
      currency: "NO",
    },
  ])("returns 400 for the malformed body %j", async (body) => {
    expect((await POST(postRequest(body))).status).toBe(400);
    expect(application.recordCompetitorObservation).not.toHaveBeenCalled();
  });

  it("maps a DomainError (foreign competitor) to 400", async () => {
    vi.mocked(application.recordCompetitorObservation).mockRejectedValue(
      new DomainError("competitor not found in organization"),
    );
    const response = await POST(
      postRequest({
        competitorId: COMPETITOR_ID,
        observedAt: OBSERVED_AT,
        source: "note",
        externalName: "Flat White",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "competitor not found in organization",
    });
  });

  it("passes the §4C source link, capture method and provenance through", async () => {
    const response = await POST(
      postRequest({
        competitorId: COMPETITOR_ID,
        observedAt: OBSERVED_AT,
        source: "website",
        externalName: "Flat White",
        competitorSourceId: "88888888-8888-4888-8888-888888888888",
        captureMethod: "automated",
        productCategory: "coffee",
        season: "autumn",
        provenance: { url: "https://rival.example/menu" },
      }),
    );

    expect(response.status).toBe(200);
    expect(application.recordCompetitorObservation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        competitorSourceId: "88888888-8888-4888-8888-888888888888",
        captureMethod: "automated",
        productCategory: "coffee",
        season: "autumn",
        provenance: { url: "https://rival.example/menu" },
      }),
    );
  });

  it("returns 400 for a bad capture method and a non-object provenance", async () => {
    const base = {
      competitorId: COMPETITOR_ID,
      observedAt: OBSERVED_AT,
      source: "website",
      externalName: "Flat White",
    };
    expect((await POST(postRequest({ ...base, captureMethod: "bogus" }))).status).toBe(400);
    expect((await POST(postRequest({ ...base, provenance: [] }))).status).toBe(400);
    expect(application.recordCompetitorObservation).not.toHaveBeenCalled();
  });
});

describe("observation parsers", () => {
  it("omits status when none is given and accepts all/pending", () => {
    expect(parseObservationListQuery(new URLSearchParams())).toEqual({
      ok: true,
      query: { limit: 200, offset: 0 },
    });
    expect(parseObservationListQuery(new URLSearchParams({ status: "pending" }))).toMatchObject({
      ok: true,
      query: { status: "pending" },
    });
    expect(parseObservationListQuery(new URLSearchParams({ status: "all" })).ok).toBe(true);
    expect(parseObservationListQuery(new URLSearchParams({ status: "bogus" })).ok).toBe(false);
  });

  it("parses a record body, canonicalising currency and rejecting a float price", () => {
    const parsed = parseRecordObservationBody({
      competitorId: COMPETITOR_ID,
      observedAt: OBSERVED_AT,
      source: "menu photo",
      externalName: "Flat White",
      currency: "nok",
    });
    expect(parsed.ok && parsed.input.currency).toBe("NOK");

    expect(
      parseRecordObservationBody({
        competitorId: COMPETITOR_ID,
        observedAt: OBSERVED_AT,
        source: "x",
        externalName: "y",
        price: 42.5,
      }).ok,
    ).toBe(false);
  });

  it("parses the §4C source fields and rejects malformed ones", () => {
    const parsed = parseRecordObservationBody({
      competitorId: COMPETITOR_ID,
      observedAt: OBSERVED_AT,
      source: "website",
      externalName: "Flat White",
      competitorSourceId: "88888888-8888-4888-8888-888888888888",
      captureMethod: "manual",
      provenance: { url: "https://rival.example/menu" },
    });
    expect(parsed.ok && parsed.input.captureMethod).toBe("manual");
    expect(parsed.ok && parsed.input.provenance).toEqual({ url: "https://rival.example/menu" });

    expect(
      parseRecordObservationBody({
        competitorId: COMPETITOR_ID,
        observedAt: OBSERVED_AT,
        source: "x",
        externalName: "y",
        competitorSourceId: "not-a-uuid",
      }).ok,
    ).toBe(false);
  });
});
