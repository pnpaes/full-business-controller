import type {
  EquipmentRecord,
  FileObjectRecord,
  MaintenanceLogRecord,
  UserAccess,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresHmsStore: vi.fn(() => ({})),
    createPostgresFileObjectsStore: vi.fn(() => ({})),
    findEquipment: vi.fn(),
    findFileObject: vi.fn(),
    listMaintenanceLogs: vi.fn(),
    recordMaintenanceLog: vi.fn(),
    storeFileObject: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../../lib/file-storage", () => ({ getFileStorage: vi.fn(() => ({})) }));
vi.mock("../../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../../../lib/auth";
import { getServerSession } from "../../../../../../../lib/server-session";

import { HMS_MAINTENANCE_UPLOAD_POLICY } from "../../../equipment-rows";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const EQUIPMENT_ID = "22222222-2222-4222-8222-222222222222";
const LOG_ID = "55555555-5555-4555-8555-555555555555";
const FILE_ID = "66666666-6666-4666-8666-666666666666";
const PATH = `/api/v1/hms/equipment/${EQUIPMENT_ID}/maintenance-logs`;

function equipmentRecord(overrides: Partial<EquipmentRecord> = {}): EquipmentRecord {
  return {
    id: EQUIPMENT_ID,
    organizationId: ORG,
    locationId: LOCATION,
    code: "OVEN-01",
    name: "Deck oven",
    kind: "oven",
    serialNo: null,
    installedAt: null,
    warrantyUntil: null,
    active: true,
    createdAt: "2026-02-01T08:00:00.000Z",
    createdBy: USER,
    ...overrides,
  };
}

function maintenanceLogRecord(overrides: Partial<MaintenanceLogRecord> = {}): MaintenanceLogRecord {
  return {
    id: LOG_ID,
    organizationId: ORG,
    equipmentId: EQUIPMENT_ID,
    kind: "service",
    performedAt: "2026-02-10T09:00:00.000Z",
    performedBy: USER,
    notes: null,
    fileObjectId: null,
    createdAt: "2026-02-10T09:00:01.000Z",
    createdBy: USER,
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function context(id: string = EQUIPMENT_ID): {
  readonly params: Promise<{ readonly id: string }>;
} {
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

const validBody = { kind: "service", performedAt: "2026-02-10T09:00:00.000Z" };

function fileRecord(overrides: Partial<FileObjectRecord> = {}): FileObjectRecord {
  return {
    id: FILE_ID,
    organizationId: ORG,
    storageKey: `${ORG}/key.jpg`,
    filename: "service.jpg",
    mime: "image/jpeg",
    sizeBytes: 8,
    checksumSha256: "a".repeat(64),
    retentionPolicy: "hms_maintenance_evidence",
    uploadedBy: USER,
    uploadedAt: "2026-02-10T09:00:00.000Z",
    linkedEntityType: "equipment",
    linkedEntityId: EQUIPMENT_ID,
    createdAt: "2026-02-10T09:00:00.000Z",
    ...overrides,
  };
}

function uploadRequest(
  fields: Record<string, string> = validBody,
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
        file.filename ?? "service.jpg",
        { type: file.type ?? "image/jpeg" },
      ),
    );
  }
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
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
    method: "POST",
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
  vi.mocked(application.findEquipment).mockResolvedValue(equipmentRecord());
  vi.mocked(application.findFileObject).mockResolvedValue(fileRecord());
  vi.mocked(application.listMaintenanceLogs).mockResolvedValue([]);
  vi.mocked(application.recordMaintenanceLog).mockResolvedValue(maintenanceLogRecord());
  vi.mocked(application.storeFileObject).mockResolvedValue(fileRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/hms/equipment/[id]/maintenance-logs", () => {
  it("lists the equipment's maintenance logs", async () => {
    vi.mocked(application.listMaintenanceLogs).mockResolvedValue([maintenanceLogRecord()]);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [
        {
          id: LOG_ID,
          equipmentId: EQUIPMENT_ID,
          kind: "service",
          performedAt: "2026-02-10T09:00:00.000Z",
          performedBy: USER,
          notes: null,
          fileObjectId: null,
          createdAt: "2026-02-10T09:00:01.000Z",
          createdBy: USER,
        },
      ],
    });
    expect(application.listMaintenanceLogs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        equipmentId: EQUIPMENT_ID,
        limit: 50,
        offset: 0,
      }),
    );
  });

  it("resolves the equipment org-scoped for an unscoped caller too", async () => {
    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(application.findEquipment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, equipmentId: EQUIPMENT_ID }),
    );
    expect(application.listMaintenanceLogs).toHaveBeenCalled();
  });

  it("returns 404 for an unscoped caller's unknown or cross-organization equipment", async () => {
    vi.mocked(application.findEquipment).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
    expect(application.listMaintenanceLogs).not.toHaveBeenCalled();
  });

  it("lets a location_manager scoped to the equipment's location list its logs", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(application.findEquipment).toHaveBeenCalled();
    expect(application.listMaintenanceLogs).toHaveBeenCalled();
  });

  it("denies a location-scoped caller equipment at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findEquipment).mockResolvedValue(
      equipmentRecord({ locationId: OTHER_LOCATION }),
    );

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(403);
    expect(application.listMaintenanceLogs).not.toHaveBeenCalled();
  });

  it("returns 404 for a location-scoped caller's unknown equipment", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findEquipment).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
    expect(application.listMaintenanceLogs).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
    expect(application.listMaintenanceLogs).not.toHaveBeenCalled();
  });

  it("returns 403 for purchasing", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["purchasing"]));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(403);
    expect(application.listMaintenanceLogs).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.listMaintenanceLogs).not.toHaveBeenCalled();
  });

  it("returns 400 for an out-of-range offset", async () => {
    const response = await GET(getRequest("?offset=999999999999"), context());

    expect(response.status).toBe(400);
    expect(application.listMaintenanceLogs).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/hms/equipment/[id]/maintenance-logs", () => {
  it("records a maintenance log for the equipment and session actor", async () => {
    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(200);
    expect(application.recordMaintenanceLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        equipmentId: EQUIPMENT_ID,
        kind: "service",
        performedAt: "2026-02-10T09:00:00.000Z",
        performedBy: USER,
        notes: null,
        fileObjectId: null,
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      maintenanceLogId: LOG_ID,
      fileObjectId: null,
    });
  });

  it("lets kitchen record a maintenance log", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(200);
    expect(application.recordMaintenanceLog).toHaveBeenCalled();
  });

  it("returns 403 for analyst, which reads but never records", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(403);
    expect(application.recordMaintenanceLog).not.toHaveBeenCalled();
  });

  it("returns 403 for finance", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(403);
    expect(application.recordMaintenanceLog).not.toHaveBeenCalled();
  });

  it("returns 403 for purchasing", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["purchasing"]));

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(403);
    expect(application.recordMaintenanceLog).not.toHaveBeenCalled();
  });

  it("returns 404 for a cross-organization equipment id", async () => {
    vi.mocked(application.findEquipment).mockResolvedValue(undefined);

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(404);
    expect(application.recordMaintenanceLog).not.toHaveBeenCalled();
  });

  it("denies a location-scoped caller equipment at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findEquipment).mockResolvedValue(
      equipmentRecord({ locationId: OTHER_LOCATION }),
    );

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(403);
    expect(application.recordMaintenanceLog).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad performedAt", async () => {
    const response = await POST(
      postRequest({ ...validBody, performedAt: "2026-02-10" }),
      context(),
    );

    expect(response.status).toBe(400);
    expect(application.recordMaintenanceLog).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad kind", async () => {
    const response = await POST(postRequest({ ...validBody, kind: "overhaul" }), context());

    expect(response.status).toBe(400);
    expect(application.recordMaintenanceLog).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await POST(postRequest(validBody), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.recordMaintenanceLog).not.toHaveBeenCalled();
  });

  it("resolves a client fileObjectId organization-scoped before recording it", async () => {
    const response = await POST(postRequest({ ...validBody, fileObjectId: FILE_ID }), context());

    expect(response.status).toBe(200);
    expect(application.findFileObject).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      fileObjectId: FILE_ID,
    });
    expect(application.recordMaintenanceLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fileObjectId: FILE_ID }),
    );
  });

  it("returns 404 for an unknown or cross-organization fileObjectId", async () => {
    vi.mocked(application.findFileObject).mockResolvedValue(undefined);

    const response = await POST(postRequest({ ...validBody, fileObjectId: FILE_ID }), context());

    expect(response.status).toBe(404);
    expect(application.recordMaintenanceLog).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.recordMaintenanceLog).mockRejectedValue(
      new DomainError("kind must be one of service, repair, inspection"),
    );

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "kind must be one of service, repair, inspection",
    });
  });
});

describe("POST /api/v1/hms/equipment/[id]/maintenance-logs (multipart upload)", () => {
  it("stores the evidence linked to the equipment and records the log with it", async () => {
    vi.mocked(application.recordMaintenanceLog).mockResolvedValue(
      maintenanceLogRecord({ fileObjectId: FILE_ID }),
    );

    const response = await POST(uploadRequest(undefined, {}), context());

    expect(response.status).toBe(200);
    expect(application.storeFileObject).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        filename: "service.jpg",
        mime: "image/jpeg",
        retentionPolicy: "hms_maintenance_evidence",
        linkedEntityType: "equipment",
        linkedEntityId: EQUIPMENT_ID,
      }),
    );
    expect(application.recordMaintenanceLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ equipmentId: EQUIPMENT_ID, fileObjectId: FILE_ID }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      maintenanceLogId: LOG_ID,
      fileObjectId: FILE_ID,
    });
  });

  it.each(["text/plain", "application/zip", "video/mp4"])(
    "returns 400 and stores nothing for the disallowed type %s",
    async (type) => {
      const response = await POST(uploadRequest(undefined, { type }), context());

      expect(response.status).toBe(400);
      expect(application.storeFileObject).not.toHaveBeenCalled();
      expect(application.recordMaintenanceLog).not.toHaveBeenCalled();
    },
  );

  it("returns 400 and stores nothing for an oversize upload", async () => {
    const bytes = new Uint8Array(HMS_MAINTENANCE_UPLOAD_POLICY.maxBytes + 1);

    const response = await POST(uploadRequest(undefined, { bytes }), context());

    expect(response.status).toBe(400);
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });

  it("rejects an oversize multipart body from Content-Length without reading it", async () => {
    const { request, formData } = oversizeRequest(HMS_MAINTENANCE_UPLOAD_POLICY.maxBytes);

    const response = await POST(request, context());

    expect(response.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });

  it("records metadata only when no file part is present", async () => {
    const response = await POST(uploadRequest(), context());

    expect(response.status).toBe(200);
    expect(application.storeFileObject).not.toHaveBeenCalled();
    expect(application.recordMaintenanceLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fileObjectId: null }),
    );
  });

  it("returns 400 for a bad kind and stores nothing", async () => {
    const response = await POST(uploadRequest({ ...validBody, kind: "overhaul" }, {}), context());

    expect(response.status).toBe(400);
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });

  it("returns 404 for a cross-organization equipment and stores nothing", async () => {
    vi.mocked(application.findEquipment).mockResolvedValue(undefined);

    const response = await POST(uploadRequest(undefined, {}), context());

    expect(response.status).toBe(404);
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });

  it("returns 403 for a location-scoped caller at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findEquipment).mockResolvedValue(
      equipmentRecord({ locationId: OTHER_LOCATION }),
    );

    const response = await POST(uploadRequest(undefined, {}), context());

    expect(response.status).toBe(403);
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });
});
