import type {
  FileObjectRecord,
  IncidentRecord,
  StoredFile,
  UserAccess,
} from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresHmsStore: vi.fn(() => ({})),
    createPostgresFileObjectsStore: vi.fn(() => ({})),
    findIncident: vi.fn(),
    readFileObject: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../../../../lib/file-storage", () => ({
  getFileStorage: vi.fn(() => ({})),
}));
vi.mock("../../../../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../../../../lib/server-session", () => ({
  getServerSession: vi.fn(),
}));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const INCIDENT_ID = "22222222-2222-4222-8222-222222222222";
const EVIDENCE_ID = "55555555-5555-4555-8555-555555555555";
const PATH = `/api/v1/hms/incidents/${INCIDENT_ID}/evidence/${EVIDENCE_ID}/file`;

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

function storedFile(overrides: Partial<FileObjectRecord> = {}): StoredFile {
  return {
    metadata: {
      id: EVIDENCE_ID,
      organizationId: ORG,
      storageKey: `${ORG}/key.jpg`,
      filename: "scene.jpg",
      mime: "image/jpeg",
      sizeBytes: 3,
      checksumSha256: "a".repeat(64),
      retentionPolicy: "hms_incident_evidence",
      uploadedBy: USER,
      uploadedAt: "2026-02-01T08:00:00.000Z",
      linkedEntityType: "hms_incident",
      linkedEntityId: INCIDENT_ID,
      createdAt: "2026-02-01T08:00:00.000Z",
      ...overrides,
    },
    bytes: new TextEncoder().encode("img"),
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function context(
  id: string = INCIDENT_ID,
  evidenceId: string = EVIDENCE_ID,
): { readonly params: Promise<{ readonly id: string; readonly evidenceId: string }> } {
  return { params: Promise.resolve({ id, evidenceId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresHmsStore).mockReturnValue({} as never);
  vi.mocked(application.createPostgresFileObjectsStore).mockReturnValue({} as never);
  vi.mocked(application.findIncident).mockResolvedValue(incidentRecord());
  vi.mocked(application.readFileObject).mockResolvedValue(storedFile());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/hms/incidents/[id]/evidence/[evidenceId]/file", () => {
  it("streams the stored evidence as a private attachment", async () => {
    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("img");
    expect(application.readFileObject).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, fileObjectId: EVIDENCE_ID }),
    );
  });

  it.each(["owner", "general_manager", "location_manager", "kitchen", "front_of_house", "admin"])(
    "allows %s (an incident reader) to download",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(new Request(`http://localhost${PATH}`), context());

      expect(response.status).toBe(200);
    },
  );

  it.each(["analyst", "finance", "purchasing"])(
    "returns 403 for %s, which has no incident access",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(new Request(`http://localhost${PATH}`), context());

      expect(response.status).toBe(403);
      expect(application.readFileObject).not.toHaveBeenCalled();
    },
  );

  it("denies a location-scoped caller an incident at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findIncident).mockResolvedValue(
      incidentRecord({ locationId: OTHER_LOCATION }),
    );

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(403);
    expect(application.readFileObject).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined as never);

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(401);
  });

  it("returns 404 for an unknown or cross-organization incident", async () => {
    vi.mocked(application.findIncident).mockResolvedValue(undefined);

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(404);
    expect(application.readFileObject).not.toHaveBeenCalled();
  });

  it("returns 404 when the file object is unknown or outside the organization", async () => {
    vi.mocked(application.readFileObject).mockResolvedValue(undefined);

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(404);
  });

  it("returns 404 when the file object is linked to another entity", async () => {
    vi.mocked(application.readFileObject).mockResolvedValue(
      storedFile({ linkedEntityId: "99999999-9999-4999-8999-999999999999" }),
    );

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(404);
  });

  it("returns 404 when the file object is linked to a different entity type", async () => {
    vi.mocked(application.readFileObject).mockResolvedValue(
      storedFile({ linkedEntityType: "equipment" }),
    );

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(404);
  });

  it("returns 400 for a non-UUID evidence id", async () => {
    const response = await GET(
      new Request(`http://localhost${PATH}`),
      context(INCIDENT_ID, "not-a-uuid"),
    );

    expect(response.status).toBe(400);
    expect(application.findIncident).not.toHaveBeenCalled();
  });
});
