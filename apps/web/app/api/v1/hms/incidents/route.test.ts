import type { IncidentRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresHmsStore: vi.fn(() => ({})),
    listIncidents: vi.fn(),
    registerIncident: vi.fn(),
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

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const INCIDENT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_INCIDENT_ID = "44444444-4444-4444-8444-444444444444";

function incidentRecord(overrides: Partial<IncidentRecord> = {}): IncidentRecord {
  return {
    id: INCIDENT_ID,
    organizationId: ORG,
    locationId: LOCATION,
    category: "near_miss",
    severity: "medium",
    occurredAt: "2026-02-01T07:00:00.000Z",
    reportedAt: "2026-02-01T08:00:00.000Z",
    reportedBy: USER,
    ownerId: null,
    title: "Slipped on wet floor",
    description: null,
    dueDate: null,
    involvesPersonalData: false,
    status: "open",
    closedAt: null,
    createdAt: "2026-02-01T08:00:01.000Z",
    createdBy: USER,
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function getRequest(query = ""): Request {
  return new Request(`http://localhost/api/v1/hms/incidents${query}`);
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/hms/incidents", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  locationId: LOCATION,
  category: "near_miss",
  severity: "medium",
  occurredAt: "2026-02-01T07:00:00.000Z",
  reportedAt: "2026-02-01T08:00:00.000Z",
  title: "Slipped on wet floor",
  involvesPersonalData: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresHmsStore).mockReturnValue({} as never);
  vi.mocked(application.listIncidents).mockResolvedValue([]);
  vi.mocked(application.registerIncident).mockResolvedValue(incidentRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/hms/incidents", () => {
  it("lists the organization's incidents", async () => {
    vi.mocked(application.listIncidents).mockResolvedValue([incidentRecord()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [
        {
          id: INCIDENT_ID,
          locationId: LOCATION,
          category: "near_miss",
          severity: "medium",
          occurredAt: "2026-02-01T07:00:00.000Z",
          reportedAt: "2026-02-01T08:00:00.000Z",
          reportedBy: USER,
          ownerId: null,
          title: "Slipped on wet floor",
          description: null,
          dueDate: null,
          involvesPersonalData: false,
          status: "open",
          closedAt: null,
          createdAt: "2026-02-01T08:00:01.000Z",
          createdBy: USER,
        },
      ],
    });
    expect(application.listIncidents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes the status and location filters through", async () => {
    const response = await GET(getRequest(`?status=closed&locationId=${LOCATION}&limit=10`));

    expect(response.status).toBe(200);
    expect(application.listIncidents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        status: "closed",
        locationId: LOCATION,
        limit: 10,
        offset: 0,
      }),
    );
  });

  it("restricts a location-scoped caller to their own location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.listIncidents).mockResolvedValue([
      incidentRecord(),
      incidentRecord({ id: OTHER_INCIDENT_ID, locationId: OTHER_LOCATION }),
    ]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listIncidents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, locationId: LOCATION }),
    );
    await expect(response.json()).resolves.toMatchObject({
      rows: [{ locationId: LOCATION }],
    });
  });

  it("denies an explicit filter outside the caller's location scope", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest(`?locationId=${OTHER_LOCATION}`));

    expect(response.status).toBe(403);
    expect(application.listIncidents).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listIncidents).not.toHaveBeenCalled();
  });

  it("returns 403 for analyst, which has no incident access", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.listIncidents).not.toHaveBeenCalled();
  });

  it("returns 403 for finance", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.listIncidents).not.toHaveBeenCalled();
  });

  it("returns 403 for purchasing", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["purchasing"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.listIncidents).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed filter", async () => {
    const response = await GET(getRequest("?locationId=nope"));

    expect(response.status).toBe(400);
    expect(application.listIncidents).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/hms/incidents", () => {
  it("registers an incident for the session actor and served organization", async () => {
    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.registerIncident).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        reportedBy: USER,
        locationId: LOCATION,
        category: "near_miss",
        severity: "medium",
        occurredAt: "2026-02-01T07:00:00.000Z",
        reportedAt: "2026-02-01T08:00:00.000Z",
        involvesPersonalData: false,
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      incidentId: INCIDENT_ID,
      status: "open",
    });
  });

  it("returns 400 for a missing required field", async () => {
    const response = await POST(postRequest({ ...validBody, title: "" }));

    expect(response.status).toBe(400);
    expect(application.registerIncident).not.toHaveBeenCalled();
  });

  it("returns 403 for admin, which has no implicit create access", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["admin"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.registerIncident).not.toHaveBeenCalled();
  });

  it("allows kitchen to raise an incident", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.registerIncident).toHaveBeenCalled();
  });

  it("allows a location_manager scoped to the body's location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.registerIncident).toHaveBeenCalled();
  });

  it("denies a location_manager scoped to another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [OTHER_LOCATION]),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.registerIncident).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.registerIncident).mockRejectedValue(
      new DomainError("severity must be one of low, medium, high, critical"),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "severity must be one of low, medium, high, critical",
    });
  });
});
