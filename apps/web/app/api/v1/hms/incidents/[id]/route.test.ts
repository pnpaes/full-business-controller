import type { FileObjectRecord, IncidentRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresHmsStore: vi.fn(() => ({})),
    createPostgresFileObjectsStore: vi.fn(() => ({})),
    createPostgresTaskStore: vi.fn(() => ({})),
    findIncident: vi.fn(),
    listAssignableUsers: vi.fn(),
    storeFileObject: vi.fn(),
    updateIncident: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../lib/file-storage", () => ({ getFileStorage: vi.fn(() => ({})) }));
vi.mock("../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../../lib/auth";
import { getServerSession } from "../../../../../../lib/server-session";

import { HMS_INCIDENT_UPLOAD_POLICY } from "../../incident-rows";

import { GET, PATCH } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const INCIDENT_ID = "22222222-2222-4222-8222-222222222222";
const PATH = `/api/v1/hms/incidents/${INCIDENT_ID}`;

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

function context(id: string = INCIDENT_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function getRequest(): Request {
  return new Request(`http://localhost${PATH}`);
}

function patchRequest(body: unknown): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

const FILE_ID = "66666666-6666-4666-8666-666666666666";

function fileRecord(overrides: Partial<FileObjectRecord> = {}): FileObjectRecord {
  return {
    id: FILE_ID,
    organizationId: ORG,
    storageKey: `${ORG}/key.jpg`,
    filename: "scene.jpg",
    mime: "image/jpeg",
    sizeBytes: 8,
    checksumSha256: "a".repeat(64),
    retentionPolicy: "hms_incident_evidence",
    uploadedBy: USER,
    uploadedAt: "2026-02-01T08:00:00.000Z",
    linkedEntityType: "hms_incident",
    linkedEntityId: INCIDENT_ID,
    createdAt: "2026-02-01T08:00:00.000Z",
    ...overrides,
  };
}

function uploadRequest(
  fields: Record<string, string> = {},
  file?: { bytes?: Uint8Array; filename?: string; type?: string },
): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  if (file !== undefined) {
    form.append(
      "file",
      new File(
        [Uint8Array.from(file.bytes ?? new TextEncoder().encode("photo"))],
        file.filename ?? "scene.jpg",
        { type: file.type ?? "image/jpeg" },
      ),
    );
  }
  return new Request(`http://localhost${PATH}`, {
    method: "PATCH",
    headers: { "sec-fetch-site": "same-origin" },
    body: form,
  });
}

/**
 * A multipart-shaped request whose `Content-Length` is far over the policy cap,
 * with a spy on `formData`. The route must reject from the header before ever
 * reading the body.
 */
function oversizeRequest(maxBytes: number): {
  readonly request: Request;
  readonly formData: ReturnType<typeof vi.fn>;
} {
  const formData = vi.fn(async () => {
    throw new Error("formData must not be reached");
  });
  const request = {
    url: `http://localhost${PATH}`,
    method: "PATCH",
    headers: new Headers({
      "content-type": "multipart/form-data; boundary=----x",
      "content-length": String(maxBytes + 1024 * 1024),
      "sec-fetch-site": "same-origin",
    }),
    formData,
  } as unknown as Request;
  return { request, formData };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresHmsStore).mockReturnValue({} as never);
  vi.mocked(application.createPostgresFileObjectsStore).mockReturnValue({} as never);
  vi.mocked(application.createPostgresTaskStore).mockReturnValue({} as never);
  vi.mocked(application.findIncident).mockResolvedValue(incidentRecord());
  vi.mocked(application.listAssignableUsers).mockResolvedValue([]);
  vi.mocked(application.updateIncident).mockResolvedValue(incidentRecord());
  vi.mocked(application.storeFileObject).mockResolvedValue(fileRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/hms/incidents/[id]", () => {
  it("returns one incident", async () => {
    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      incident: {
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
    });
    expect(application.findIncident).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, incidentId: INCIDENT_ID }),
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
  });

  it("returns 404 for a location-scoped caller's unknown incident", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findIncident).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
  });

  it("returns 404 for an unscoped caller's unknown incident", async () => {
    vi.mocked(application.findIncident).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
    expect(application.findIncident).not.toHaveBeenCalled();
  });

  it("returns 403 for analyst, which has no incident access", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(403);
    expect(application.findIncident).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findIncident).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/hms/incidents/[id]", () => {
  it("updates an incident for the session actor", async () => {
    vi.mocked(application.updateIncident).mockResolvedValue(
      incidentRecord({ status: "closed", closedAt: "2026-02-02T09:00:00.000Z" }),
    );

    const response = await PATCH(patchRequest({ status: "closed" }), context());

    expect(response.status).toBe(200);
    expect(application.updateIncident).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        incidentId: INCIDENT_ID,
        status: "closed",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      incident: { status: "closed" },
    });
  });

  it("lets admin close an incident", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["admin"]));

    const response = await PATCH(patchRequest({ status: "closed" }), context());

    expect(response.status).toBe(200);
    expect(application.updateIncident).toHaveBeenCalled();
  });

  it("accepts an owner who is an active user of the organization", async () => {
    const ownerId = "55555555-5555-4555-8555-555555555555";
    vi.mocked(application.listAssignableUsers).mockResolvedValue([
      { id: ownerId, displayName: "Bo", username: "bo" },
    ]);
    vi.mocked(application.updateIncident).mockResolvedValue(incidentRecord({ ownerId }));

    const response = await PATCH(patchRequest({ ownerId }), context());

    expect(response.status).toBe(200);
    expect(application.updateIncident).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ incidentId: INCIDENT_ID, ownerId }),
    );
  });

  it("rejects an owner who is unknown or in another organization", async () => {
    vi.mocked(application.listAssignableUsers).mockResolvedValue([]);

    const response = await PATCH(
      patchRequest({ ownerId: "55555555-5555-4555-8555-555555555555" }),
      context(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "ownerId must be an active user in the organization",
    });
    expect(application.updateIncident).not.toHaveBeenCalled();
  });

  it("returns 403 for kitchen, which may not edit or close an incident", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await PATCH(patchRequest({ status: "closed" }), context());

    expect(response.status).toBe(403);
    expect(application.updateIncident).not.toHaveBeenCalled();
  });

  it("returns 403 for finance", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await PATCH(patchRequest({ title: "Renamed" }), context());

    expect(response.status).toBe(403);
    expect(application.updateIncident).not.toHaveBeenCalled();
  });

  it("denies a location-scoped caller an incident at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findIncident).mockResolvedValue(
      incidentRecord({ locationId: OTHER_LOCATION }),
    );

    const response = await PATCH(patchRequest({ status: "closed" }), context());

    expect(response.status).toBe(403);
    expect(application.updateIncident).not.toHaveBeenCalled();
  });

  it("returns 404 for a location-scoped caller's unknown incident", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findIncident).mockResolvedValue(undefined);

    const response = await PATCH(patchRequest({ status: "closed" }), context());

    expect(response.status).toBe(404);
    expect(application.updateIncident).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed body", async () => {
    const response = await PATCH(patchRequest({ title: "" }), context());

    expect(response.status).toBe(400);
    expect(application.updateIncident).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await PATCH(patchRequest({ status: "closed" }), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.updateIncident).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.updateIncident).mockRejectedValue(
      new DomainError("status must be one of open, investigating, resolved, closed"),
    );

    const response = await PATCH(patchRequest({ status: "nope" }), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "status must be one of open, investigating, resolved, closed",
    });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.updateIncident).mockRejectedValue(
      new NotFoundError("incident not found in organization"),
    );

    const response = await PATCH(patchRequest({ status: "closed" }), context());

    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/v1/hms/incidents/[id] (evidence upload, DEC-134)", () => {
  it("stores the evidence linked to the incident and applies the field patch", async () => {
    const response = await PATCH(uploadRequest({ title: "Renamed" }, {}), context());

    expect(response.status).toBe(200);
    expect(application.storeFileObject).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        filename: "scene.jpg",
        mime: "image/jpeg",
        retentionPolicy: "hms_incident_evidence",
        linkedEntityType: "hms_incident",
        linkedEntityId: INCIDENT_ID,
      }),
    );
    expect(application.updateIncident).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ incidentId: INCIDENT_ID, title: "Renamed" }),
    );
    await expect(response.json()).resolves.toMatchObject({ ok: true, fileObjectId: FILE_ID });
  });

  it("attaches evidence with no field change (pure evidence attach)", async () => {
    const response = await PATCH(uploadRequest(undefined, {}), context());

    expect(response.status).toBe(200);
    expect(application.storeFileObject).toHaveBeenCalled();
    expect(application.updateIncident).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      ok: true,
      incidentId: INCIDENT_ID,
      fileObjectId: FILE_ID,
    });
  });

  it.each(["text/plain", "application/zip", "video/mp4"])(
    "returns 400 and stores nothing for the disallowed type %s",
    async (type) => {
      const response = await PATCH(uploadRequest({ title: "Renamed" }, { type }), context());

      expect(response.status).toBe(400);
      expect(application.storeFileObject).not.toHaveBeenCalled();
      expect(application.updateIncident).not.toHaveBeenCalled();
    },
  );

  it("returns 400 and stores nothing for an oversize upload", async () => {
    const bytes = new Uint8Array(HMS_INCIDENT_UPLOAD_POLICY.maxBytes + 1);

    const response = await PATCH(uploadRequest({ title: "Renamed" }, { bytes }), context());

    expect(response.status).toBe(400);
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });

  it("rejects an oversize multipart body from Content-Length without reading it", async () => {
    const { request, formData } = oversizeRequest(HMS_INCIDENT_UPLOAD_POLICY.maxBytes);

    const response = await PATCH(request, context());

    expect(response.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });

  it("returns 400 for a multipart body with neither fields nor a file", async () => {
    const response = await PATCH(uploadRequest(), context());

    expect(response.status).toBe(400);
    expect(application.storeFileObject).not.toHaveBeenCalled();
    expect(application.updateIncident).not.toHaveBeenCalled();
  });

  it("returns 403 for kitchen, which may not amend an incident", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await PATCH(uploadRequest(undefined, {}), context());

    expect(response.status).toBe(403);
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });

  it("returns 404 for a cross-organization incident and stores nothing", async () => {
    vi.mocked(application.findIncident).mockResolvedValue(undefined);

    const response = await PATCH(uploadRequest(undefined, {}), context());

    expect(response.status).toBe(404);
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });

  it("denies a location-scoped caller an incident at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findIncident).mockResolvedValue(
      incidentRecord({ locationId: OTHER_LOCATION }),
    );

    const response = await PATCH(uploadRequest(undefined, {}), context());

    expect(response.status).toBe(403);
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });
});
