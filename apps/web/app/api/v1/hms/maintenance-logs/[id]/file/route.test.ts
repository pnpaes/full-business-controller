import type {
  EquipmentRecord,
  FileObjectRecord,
  MaintenanceLogRecord,
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
    findEquipment: vi.fn(),
    findMaintenanceLog: vi.fn(),
    readFileObject: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../../lib/file-storage", () => ({ getFileStorage: vi.fn(() => ({})) }));
vi.mock("../../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const EQUIPMENT_ID = "22222222-2222-4222-8222-222222222222";
const LOG_ID = "55555555-5555-4555-8555-555555555555";
const FILE_ID = "66666666-6666-4666-8666-666666666666";
const PATH = `/api/v1/hms/maintenance-logs/${LOG_ID}/file`;

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

function logRecord(overrides: Partial<MaintenanceLogRecord> = {}): MaintenanceLogRecord {
  return {
    id: LOG_ID,
    organizationId: ORG,
    equipmentId: EQUIPMENT_ID,
    kind: "service",
    performedAt: "2026-02-10T09:00:00.000Z",
    performedBy: USER,
    notes: null,
    fileObjectId: FILE_ID,
    createdAt: "2026-02-10T09:00:01.000Z",
    createdBy: USER,
    ...overrides,
  };
}

function storedFile(overrides: Partial<FileObjectRecord> = {}): StoredFile {
  return {
    metadata: {
      id: FILE_ID,
      organizationId: ORG,
      storageKey: `${ORG}/key.jpg`,
      filename: "service.jpg",
      mime: "image/jpeg",
      sizeBytes: 3,
      checksumSha256: "a".repeat(64),
      retentionPolicy: "hms_maintenance_evidence",
      uploadedBy: USER,
      uploadedAt: "2026-02-10T09:00:00.000Z",
      linkedEntityType: "equipment",
      linkedEntityId: EQUIPMENT_ID,
      createdAt: "2026-02-10T09:00:00.000Z",
      ...overrides,
    },
    bytes: new TextEncoder().encode("img"),
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function context(id: string = LOG_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresHmsStore).mockReturnValue({} as never);
  vi.mocked(application.createPostgresFileObjectsStore).mockReturnValue({} as never);
  vi.mocked(application.findMaintenanceLog).mockResolvedValue(logRecord());
  vi.mocked(application.findEquipment).mockResolvedValue(equipmentRecord());
  vi.mocked(application.readFileObject).mockResolvedValue(storedFile());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/hms/maintenance-logs/[id]/file", () => {
  it("streams the stored evidence as a private attachment", async () => {
    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("img");
  });

  it.each(["owner", "general_manager", "analyst", "kitchen", "front_of_house", "admin"])(
    "allows %s (a maintenance reader) to download",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(new Request(`http://localhost${PATH}`), context());

      expect(response.status).toBe(200);
    },
  );

  it.each(["finance", "purchasing"])(
    "returns 403 for %s, which has no maintenance access",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(new Request(`http://localhost${PATH}`), context());

      expect(response.status).toBe(403);
      expect(application.readFileObject).not.toHaveBeenCalled();
    },
  );

  it("denies a location-scoped caller equipment at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findEquipment).mockResolvedValue(
      equipmentRecord({ locationId: OTHER_LOCATION }),
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

  it("returns 404 for an unknown or cross-organization log", async () => {
    vi.mocked(application.findMaintenanceLog).mockResolvedValue(undefined);

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(404);
    expect(application.readFileObject).not.toHaveBeenCalled();
  });

  it("returns 404 when the log has no stored evidence", async () => {
    vi.mocked(application.findMaintenanceLog).mockResolvedValue(logRecord({ fileObjectId: null }));

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(404);
    expect(application.readFileObject).not.toHaveBeenCalled();
  });

  it("returns 404 when the file object is outside the organization", async () => {
    vi.mocked(application.readFileObject).mockResolvedValue(undefined);

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(404);
  });

  it("returns 400 for a non-UUID log id", async () => {
    const response = await GET(new Request(`http://localhost${PATH}`), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findMaintenanceLog).not.toHaveBeenCalled();
  });
});
