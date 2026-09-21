import type { CorrectiveActionRecord, IncidentRecord, UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresHmsStore: vi.fn(() => ({})),
    findIncident: vi.fn(),
    listCorrectiveActions: vi.fn(),
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
const INCIDENT_ID = "22222222-2222-4222-8222-222222222222";
const ACTION_ID = "55555555-5555-4555-8555-555555555555";
const OWNER_ID = "66666666-6666-4666-8666-666666666666";

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

function getRequest(query = ""): Request {
  return new Request(`http://localhost/api/v1/hms/corrective-actions${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresHmsStore).mockReturnValue({} as never);
  vi.mocked(application.findIncident).mockResolvedValue(incidentRecord());
  vi.mocked(application.listCorrectiveActions).mockResolvedValue([]);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/hms/corrective-actions", () => {
  it("lists the organization's corrective actions for an unscoped caller", async () => {
    vi.mocked(application.listCorrectiveActions).mockResolvedValue([actionRecord()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [{ id: ACTION_ID, incidentId: INCIDENT_ID, status: "open" }],
    });
    expect(application.findIncident).not.toHaveBeenCalled();
    expect(application.listCorrectiveActions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes the incident/status/owner filters through", async () => {
    const response = await GET(
      getRequest(`?incidentId=${INCIDENT_ID}&status=done&ownerId=${OWNER_ID}&limit=10`),
    );

    expect(response.status).toBe(200);
    expect(application.listCorrectiveActions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        incidentId: INCIDENT_ID,
        status: "done",
        ownerId: OWNER_ID,
        limit: 10,
        offset: 0,
      }),
    );
  });

  it("returns 403 for a scoped caller that omits incidentId", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest("?status=open"));

    expect(response.status).toBe(403);
    expect(application.findIncident).not.toHaveBeenCalled();
    expect(application.listCorrectiveActions).not.toHaveBeenCalled();
  });

  it("scopes a scoped caller through the named incident", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest(`?incidentId=${INCIDENT_ID}`));

    expect(response.status).toBe(200);
    expect(application.findIncident).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, incidentId: INCIDENT_ID }),
    );
    expect(application.listCorrectiveActions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, incidentId: INCIDENT_ID }),
    );
  });

  it("denies a scoped caller an incident at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findIncident).mockResolvedValue(
      incidentRecord({ locationId: OTHER_LOCATION }),
    );

    const response = await GET(getRequest(`?incidentId=${INCIDENT_ID}`));

    expect(response.status).toBe(403);
    expect(application.listCorrectiveActions).not.toHaveBeenCalled();
  });

  it("returns 404 for a scoped caller's unknown incident", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findIncident).mockResolvedValue(undefined);

    const response = await GET(getRequest(`?incidentId=${INCIDENT_ID}`));

    expect(response.status).toBe(404);
    expect(application.listCorrectiveActions).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listCorrectiveActions).not.toHaveBeenCalled();
  });

  it("returns 403 for analyst", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.listCorrectiveActions).not.toHaveBeenCalled();
  });

  it("returns 403 for finance", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.listCorrectiveActions).not.toHaveBeenCalled();
  });

  it("returns 403 for purchasing", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["purchasing"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.listCorrectiveActions).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed filter", async () => {
    const response = await GET(getRequest("?ownerId=nope"));

    expect(response.status).toBe(400);
    expect(application.listCorrectiveActions).not.toHaveBeenCalled();
  });
});
