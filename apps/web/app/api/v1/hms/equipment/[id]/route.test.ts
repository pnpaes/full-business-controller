import type { EquipmentRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresHmsStore: vi.fn(() => ({})),
    findEquipment: vi.fn(),
    updateEquipment: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../../lib/auth";
import { getServerSession } from "../../../../../../lib/server-session";

import { GET, PATCH } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "33333333-3333-4333-8333-333333333333";
const EQUIPMENT_ID = "22222222-2222-4222-8222-222222222222";

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

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function context(id: string = EQUIPMENT_ID): {
  readonly params: Promise<{ readonly id: string }>;
} {
  return { params: Promise.resolve({ id }) };
}

function getRequest(): Request {
  return new Request(`http://localhost/api/v1/hms/equipment/${EQUIPMENT_ID}`);
}

function patchRequest(body: unknown): Request {
  return new Request(`http://localhost/api/v1/hms/equipment/${EQUIPMENT_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

const equipmentRow = {
  id: EQUIPMENT_ID,
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
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresHmsStore).mockReturnValue({} as never);
  vi.mocked(application.findEquipment).mockResolvedValue(equipmentRecord());
  vi.mocked(application.updateEquipment).mockResolvedValue(equipmentRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/hms/equipment/[id]", () => {
  it("returns one equipment row", async () => {
    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, equipment: equipmentRow });
    expect(application.findEquipment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, equipmentId: EQUIPMENT_ID }),
    );
  });

  it("returns 404 for unknown or cross-organization equipment", async () => {
    vi.mocked(application.findEquipment).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
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
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
    expect(application.findEquipment).not.toHaveBeenCalled();
  });

  it("returns 403 for purchasing", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["purchasing"]));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(403);
    expect(application.findEquipment).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findEquipment).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/hms/equipment/[id]", () => {
  it("amends equipment for the session actor", async () => {
    const response = await PATCH(patchRequest({ name: "Deck oven A" }), context());

    expect(response.status).toBe(200);
    expect(application.updateEquipment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        equipmentId: EQUIPMENT_ID,
        name: "Deck oven A",
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, equipment: equipmentRow });
  });

  it("does not resolve equipment for an unscoped caller", async () => {
    const response = await PATCH(patchRequest({ active: false }), context());

    expect(response.status).toBe(200);
    expect(application.findEquipment).not.toHaveBeenCalled();
  });

  it("lets a location_manager scoped to the row's location amend it", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await PATCH(patchRequest({ name: "Deck oven A" }), context());

    expect(response.status).toBe(200);
    expect(application.findEquipment).toHaveBeenCalled();
    expect(application.updateEquipment).toHaveBeenCalled();
  });

  it("denies a location-scoped caller equipment at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findEquipment).mockResolvedValue(
      equipmentRecord({ locationId: OTHER_LOCATION }),
    );

    const response = await PATCH(patchRequest({ name: "Deck oven A" }), context());

    expect(response.status).toBe(403);
    expect(application.updateEquipment).not.toHaveBeenCalled();
  });

  it("returns 404 for a location-scoped caller's unknown equipment", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findEquipment).mockResolvedValue(undefined);

    const response = await PATCH(patchRequest({ name: "Deck oven A" }), context());

    expect(response.status).toBe(404);
    expect(application.updateEquipment).not.toHaveBeenCalled();
  });

  it("returns 403 for kitchen, which may not write equipment", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await PATCH(patchRequest({ name: "Deck oven A" }), context());

    expect(response.status).toBe(403);
    expect(application.updateEquipment).not.toHaveBeenCalled();
  });

  it("returns 403 for analyst, which reads but never writes", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await PATCH(patchRequest({ name: "Deck oven A" }), context());

    expect(response.status).toBe(403);
    expect(application.updateEquipment).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await PATCH(patchRequest({ name: "Deck oven A" }), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.updateEquipment).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad installedAt", async () => {
    const response = await PATCH(patchRequest({ installedAt: "2026-13-40" }), context());

    expect(response.status).toBe(400);
    expect(application.updateEquipment).not.toHaveBeenCalled();
  });

  it("maps a NotFoundError to 404", async () => {
    vi.mocked(application.updateEquipment).mockRejectedValue(
      new NotFoundError("equipment not found in organization"),
    );

    const response = await PATCH(patchRequest({ name: "Deck oven A" }), context());

    expect(response.status).toBe(404);
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.updateEquipment).mockRejectedValue(new DomainError("name is required"));

    const response = await PATCH(patchRequest({ name: "Deck oven A" }), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "name is required" });
  });
});
