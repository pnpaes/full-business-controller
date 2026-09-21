import type { CorrectiveActionRecord, IncidentRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresHmsStore: vi.fn(() => ({})),
    findIncident: vi.fn(),
    listCorrectiveActions: vi.fn(),
    recordCorrectiveAction: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../../../lib/auth";
import { getServerSession } from "../../../../../../../lib/server-session";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const INCIDENT_ID = "22222222-2222-4222-8222-222222222222";
const ACTION_ID = "55555555-5555-4555-8555-555555555555";
const PATH = `/api/v1/hms/incidents/${INCIDENT_ID}/corrective-actions`;

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

function actionRecord(overrides: Partial<CorrectiveActionRecord> = {}): CorrectiveActionRecord {
  return {
    id: ACTION_ID,
    organizationId: ORG,
    incidentId: INCIDENT_ID,
    monitoringReadingId: null,
    description: "Re-train staff on wet-floor signage",
    ownerId: null,
    dueDate: null,
    status: "open",
    completedAt: null,
    verifiedBy: null,
    verifiedAt: null,
    createdAt: "2026-02-01T09:00:00.000Z",
    createdBy: USER,
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function context(id: string = INCIDENT_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
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

const validBody = { description: "Re-train staff on wet-floor signage" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresHmsStore).mockReturnValue({} as never);
  vi.mocked(application.findIncident).mockResolvedValue(incidentRecord());
  vi.mocked(application.listCorrectiveActions).mockResolvedValue([]);
  vi.mocked(application.recordCorrectiveAction).mockResolvedValue(actionRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/hms/incidents/[id]/corrective-actions", () => {
  it("lists the incident's corrective actions", async () => {
    vi.mocked(application.listCorrectiveActions).mockResolvedValue([actionRecord()]);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [
        {
          id: ACTION_ID,
          incidentId: INCIDENT_ID,
          monitoringReadingId: null,
          description: "Re-train staff on wet-floor signage",
          ownerId: null,
          dueDate: null,
          status: "open",
          completedAt: null,
          verifiedBy: null,
          verifiedAt: null,
          createdAt: "2026-02-01T09:00:00.000Z",
          createdBy: USER,
        },
      ],
    });
    expect(application.listCorrectiveActions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        incidentId: INCIDENT_ID,
        limit: 50,
        offset: 0,
      }),
    );
  });

  it("passes the status and owner filters through", async () => {
    const ownerId = "66666666-6666-4666-8666-666666666666";

    const response = await GET(getRequest(`?status=done&ownerId=${ownerId}`), context());

    expect(response.status).toBe(200);
    expect(application.listCorrectiveActions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ incidentId: INCIDENT_ID, status: "done", ownerId }),
    );
  });

  it("denies a location-scoped caller an incident at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findIncident).mockResolvedValue(
      incidentRecord({ locationId: OTHER_LOCATION }),
    );

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(403);
    expect(application.listCorrectiveActions).not.toHaveBeenCalled();
  });

  it("returns 404 for a location-scoped caller's unknown incident", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findIncident).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
    expect(application.listCorrectiveActions).not.toHaveBeenCalled();
  });

  it("lets an unscoped caller list without incident resolution", async () => {
    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(application.findIncident).not.toHaveBeenCalled();
    expect(application.listCorrectiveActions).toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
    expect(application.listCorrectiveActions).not.toHaveBeenCalled();
  });

  it("returns 403 for analyst", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(403);
    expect(application.listCorrectiveActions).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.listCorrectiveActions).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed page", async () => {
    const response = await GET(getRequest("?limit=0"), context());

    expect(response.status).toBe(400);
    expect(application.listCorrectiveActions).not.toHaveBeenCalled();
  });

  it("returns 400 for an out-of-range offset", async () => {
    const response = await GET(getRequest("?offset=999999999999"), context());

    expect(response.status).toBe(400);
    expect(application.listCorrectiveActions).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/hms/incidents/[id]/corrective-actions", () => {
  it("records a corrective action linked to the incident", async () => {
    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(200);
    expect(application.recordCorrectiveAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        incidentId: INCIDENT_ID,
        description: "Re-train staff on wet-floor signage",
        ownerId: null,
        dueDate: null,
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      correctiveActionId: ACTION_ID,
      status: "open",
    });
  });

  it("lets a location_manager scoped to the incident's location record one", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(200);
    expect(application.recordCorrectiveAction).toHaveBeenCalled();
  });

  it("returns 403 for kitchen, which may not create a corrective action", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(403);
    expect(application.recordCorrectiveAction).not.toHaveBeenCalled();
  });

  it("denies a location-scoped caller an incident at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findIncident).mockResolvedValue(
      incidentRecord({ locationId: OTHER_LOCATION }),
    );

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(403);
    expect(application.recordCorrectiveAction).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown incident", async () => {
    vi.mocked(application.findIncident).mockResolvedValue(undefined);

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(404);
    expect(application.recordCorrectiveAction).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing description", async () => {
    const response = await POST(postRequest({ description: "" }), context());

    expect(response.status).toBe(400);
    expect(application.recordCorrectiveAction).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await POST(postRequest(validBody), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.recordCorrectiveAction).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.recordCorrectiveAction).mockRejectedValue(
      new DomainError("at least one of incidentId or monitoringReadingId is required"),
    );

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "at least one of incidentId or monitoringReadingId is required",
    });
  });
});
