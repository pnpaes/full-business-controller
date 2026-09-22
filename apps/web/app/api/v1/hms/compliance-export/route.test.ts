import type { ComplianceExportBundle, UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresHmsStore: vi.fn(() => ({})),
    buildComplianceExport: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});
vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/organization", () => ({ resolveOrganization: vi.fn(() => "org-1") }));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

/** A minimal but complete bundle, with one record per source to prove pass-through. */
function bundle(overrides: Partial<ComplianceExportBundle> = {}): ComplianceExportBundle {
  return {
    generatedAt: "2026-02-10T09:00:00.000Z",
    organizationId: ORG,
    period: { from: null, to: null },
    personalDataFields: [
      "reported_by",
      "recorded_by",
      "owner_id",
      "performed_by",
      "verified_by",
      "involves_personal_data",
    ],
    counts: {
      monitoringReadings: 0,
      incidents: 0,
      correctiveActions: 0,
      checklistRuns: 0,
      maintenanceLogs: 0,
    },
    truncated: {
      monitoringReadings: false,
      incidents: false,
      correctiveActions: false,
      checklistRuns: false,
      maintenanceLogs: false,
    },
    monitoringReadings: [],
    incidents: [],
    correctiveActions: [],
    checklistRuns: [],
    maintenanceLogs: [],
    ...overrides,
  };
}

function getRequest(query = ""): Request {
  return new Request(`http://localhost/api/v1/hms/compliance-export${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresHmsStore).mockReturnValue({} as never);
  vi.mocked(application.buildComplianceExport).mockResolvedValue(bundle());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/hms/compliance-export", () => {
  it("allows an owner and returns the application bundle verbatim", async () => {
    const expected = bundle({
      period: { from: "2026-02-01T00:00:00.000Z", to: "2026-02-28T23:59:59.000Z" },
      counts: {
        monitoringReadings: 1,
        incidents: 1,
        correctiveActions: 0,
        checklistRuns: 0,
        maintenanceLogs: 0,
      },
      monitoringReadings: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          organizationId: ORG,
          monitoringPointId: "66666666-6666-4666-8666-666666666666",
          value: "4.5",
          unit: "c",
          measuredAt: "2026-02-05T07:00:00.000Z",
          recordedBy: USER,
          inRange: true,
          notes: null,
          createdAt: "2026-02-05T07:00:01.000Z",
        },
      ],
    });
    vi.mocked(application.buildComplianceExport).mockResolvedValue(expected);

    const response = await GET(
      getRequest("?from=2026-02-01T00:00:00.000Z&to=2026-02-28T23:59:59.000Z"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, ...expected });
  });

  it("forwards the organization, actor and open period for an unscoped owner", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    // An unscoped caller's empty scope must be forwarded as `undefined`
    // (organization-wide), never as an empty array (which would read as scoped).
    expect(application.buildComplianceExport).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      actorId: USER,
      locationIds: undefined,
    });
  });

  it("allows a general_manager with the organization-wide scope", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["general_manager"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.buildComplianceExport).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      actorId: USER,
      locationIds: undefined,
    });
  });

  it("allows admin", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["admin"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.buildComplianceExport).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      actorId: USER,
      locationIds: undefined,
    });
  });

  it("allows a location_manager and forwards their location scope", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.buildComplianceExport).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      actorId: USER,
      locationIds: [LOCATION],
    });
  });

  it("forwards the period bounds when present", async () => {
    const response = await GET(
      getRequest("?from=2026-02-01T00:00:00.000Z&to=2026-02-28T23:59:59.000Z"),
    );

    expect(response.status).toBe(200);
    expect(application.buildComplianceExport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        from: "2026-02-01T00:00:00.000Z",
        to: "2026-02-28T23:59:59.000Z",
      }),
    );
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.buildComplianceExport).not.toHaveBeenCalled();
  });

  it("returns 403 for analyst, which lacks every source's read", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.buildComplianceExport).not.toHaveBeenCalled();
  });

  it("returns 403 for kitchen", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.buildComplianceExport).not.toHaveBeenCalled();
  });

  it("returns 403 for front_of_house", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["front_of_house"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.buildComplianceExport).not.toHaveBeenCalled();
  });

  it("returns 403 for purchasing", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["purchasing"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.buildComplianceExport).not.toHaveBeenCalled();
  });

  it("returns 403 for finance", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.buildComplianceExport).not.toHaveBeenCalled();
  });

  it("returns 403 for a caller with no roles (fail-closed)", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.buildComplianceExport).not.toHaveBeenCalled();
  });

  it("returns 403 for a caller with an unknown role code", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["shift_lead"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.buildComplianceExport).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed from", async () => {
    const response = await GET(getRequest("?from=yesterday"));

    expect(response.status).toBe(400);
    expect(application.buildComplianceExport).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed to", async () => {
    const response = await GET(getRequest("?to=2026-02-28"));

    expect(response.status).toBe(400);
    expect(application.buildComplianceExport).not.toHaveBeenCalled();
  });

  it("returns 400 when from is after to", async () => {
    const response = await GET(
      getRequest("?from=2026-03-01T00:00:00.000Z&to=2026-02-01T00:00:00.000Z"),
    );

    expect(response.status).toBe(400);
    expect(application.buildComplianceExport).not.toHaveBeenCalled();
  });

  it("ignores a locationId query parameter for a scoped caller", async () => {
    // The route has no `locationId` field; a supplied one must not widen or
    // narrow the caller's server-derived scope.
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest(`?locationId=${OTHER_LOCATION}`));

    expect(response.status).toBe(200);
    expect(application.buildComplianceExport).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      actorId: USER,
      locationIds: [LOCATION],
    });
  });

  it("returns the bundle unchanged, including an empty scoped result", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [OTHER_LOCATION]),
    );
    const empty = bundle();
    vi.mocked(application.buildComplianceExport).mockResolvedValue(empty);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true, ...empty });
    expect(body).not.toHaveProperty("rows");
  });
});
