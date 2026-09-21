import type { EquipmentRecord, MaintenanceLogRecord, UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresHmsStore: vi.fn(() => ({})),
    findEquipment: vi.fn(),
    listMaintenanceLogs: vi.fn(),
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
const EQUIPMENT_ID = "22222222-2222-4222-8222-222222222222";
const LOG_ID = "55555555-5555-4555-8555-555555555555";

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

function getRequest(query = ""): Request {
  return new Request(`http://localhost/api/v1/hms/maintenance-logs${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresHmsStore).mockReturnValue({} as never);
  vi.mocked(application.findEquipment).mockResolvedValue(equipmentRecord());
  vi.mocked(application.listMaintenanceLogs).mockResolvedValue([]);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/hms/maintenance-logs", () => {
  it("lists the organization's maintenance logs", async () => {
    vi.mocked(application.listMaintenanceLogs).mockResolvedValue([maintenanceLogRecord()]);

    const response = await GET(getRequest());

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
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes the equipment and kind filters through", async () => {
    const response = await GET(getRequest(`?equipmentId=${EQUIPMENT_ID}&kind=repair&limit=10`));

    expect(response.status).toBe(200);
    expect(application.listMaintenanceLogs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        equipmentId: EQUIPMENT_ID,
        kind: "repair",
        limit: 10,
        offset: 0,
      }),
    );
  });

  it("does not resolve equipment for an unscoped caller", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.findEquipment).not.toHaveBeenCalled();
  });

  it("requires a scoped caller to name an equipmentId", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.listMaintenanceLogs).not.toHaveBeenCalled();
  });

  it("lets a scoped caller list logs for equipment in their location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest(`?equipmentId=${EQUIPMENT_ID}`));

    expect(response.status).toBe(200);
    expect(application.findEquipment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, equipmentId: EQUIPMENT_ID }),
    );
    expect(application.listMaintenanceLogs).toHaveBeenCalled();
  });

  it("denies a scoped caller equipment at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findEquipment).mockResolvedValue(
      equipmentRecord({ locationId: OTHER_LOCATION }),
    );

    const response = await GET(getRequest(`?equipmentId=${EQUIPMENT_ID}`));

    expect(response.status).toBe(403);
    expect(application.listMaintenanceLogs).not.toHaveBeenCalled();
  });

  it("returns 404 for a scoped caller's unknown equipmentId", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findEquipment).mockResolvedValue(undefined);

    const response = await GET(getRequest(`?equipmentId=${EQUIPMENT_ID}`));

    expect(response.status).toBe(404);
    expect(application.listMaintenanceLogs).not.toHaveBeenCalled();
  });

  it("resolves a named equipmentId org-scoped for an unscoped caller too", async () => {
    const response = await GET(getRequest(`?equipmentId=${EQUIPMENT_ID}`));

    expect(response.status).toBe(200);
    expect(application.findEquipment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, equipmentId: EQUIPMENT_ID }),
    );
    expect(application.listMaintenanceLogs).toHaveBeenCalled();
  });

  it("returns 404 for an unscoped caller's unknown or cross-organization equipmentId", async () => {
    vi.mocked(application.findEquipment).mockResolvedValue(undefined);

    const response = await GET(getRequest(`?equipmentId=${EQUIPMENT_ID}`));

    expect(response.status).toBe(404);
    expect(application.findEquipment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, equipmentId: EQUIPMENT_ID }),
    );
    expect(application.listMaintenanceLogs).not.toHaveBeenCalled();
  });

  it("lets analyst read the maintenance log", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listMaintenanceLogs).toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listMaintenanceLogs).not.toHaveBeenCalled();
  });

  it("returns 403 for finance", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.listMaintenanceLogs).not.toHaveBeenCalled();
  });

  it("returns 403 for purchasing", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["purchasing"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.listMaintenanceLogs).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed equipmentId filter", async () => {
    const response = await GET(getRequest("?equipmentId=nope"));

    expect(response.status).toBe(400);
    expect(application.listMaintenanceLogs).not.toHaveBeenCalled();
  });

  it("returns 400 for an out-of-range offset", async () => {
    const response = await GET(getRequest("?offset=999999999999"));

    expect(response.status).toBe(400);
    expect(application.listMaintenanceLogs).not.toHaveBeenCalled();
  });
});
