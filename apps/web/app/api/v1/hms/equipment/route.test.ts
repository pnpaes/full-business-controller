import type { EquipmentRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresHmsStore: vi.fn(() => ({})),
    listEquipment: vi.fn(),
    registerEquipment: vi.fn(),
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
const EQUIPMENT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_EQUIPMENT_ID = "44444444-4444-4444-8444-444444444444";

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

function getRequest(query = ""): Request {
  return new Request(`http://localhost/api/v1/hms/equipment${query}`);
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/hms/equipment", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  locationId: LOCATION,
  code: "OVEN-01",
  name: "Deck oven",
  kind: "oven",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresHmsStore).mockReturnValue({} as never);
  vi.mocked(application.listEquipment).mockResolvedValue([]);
  vi.mocked(application.registerEquipment).mockResolvedValue(equipmentRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/hms/equipment", () => {
  it("lists the organization's equipment", async () => {
    vi.mocked(application.listEquipment).mockResolvedValue([equipmentRecord()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [
        {
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
        },
      ],
    });
    expect(application.listEquipment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes the location, kind and active filters through", async () => {
    const response = await GET(
      getRequest(`?locationId=${LOCATION}&kind=oven&active=true&limit=10`),
    );

    expect(response.status).toBe(200);
    expect(application.listEquipment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        locationId: LOCATION,
        kind: "oven",
        active: true,
        limit: 10,
        offset: 0,
      }),
    );
  });

  it("restricts a single-location-scoped caller to their own location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.listEquipment).mockResolvedValue([
      equipmentRecord(),
      equipmentRecord({ id: OTHER_EQUIPMENT_ID, locationId: OTHER_LOCATION }),
    ]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listEquipment).toHaveBeenCalledWith(
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
    expect(application.listEquipment).not.toHaveBeenCalled();
  });

  it("lets analyst read the register", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listEquipment).toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listEquipment).not.toHaveBeenCalled();
  });

  it("returns 403 for finance", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.listEquipment).not.toHaveBeenCalled();
  });

  it("returns 403 for purchasing", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["purchasing"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.listEquipment).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed filter", async () => {
    const response = await GET(getRequest("?locationId=nope"));

    expect(response.status).toBe(400);
    expect(application.listEquipment).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed active flag", async () => {
    const response = await GET(getRequest("?active=maybe"));

    expect(response.status).toBe(400);
    expect(application.listEquipment).not.toHaveBeenCalled();
  });

  it("returns 400 for an out-of-range offset", async () => {
    const response = await GET(getRequest("?offset=999999999999"));

    expect(response.status).toBe(400);
    expect(application.listEquipment).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/hms/equipment", () => {
  it("registers equipment for the session actor and served organization", async () => {
    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.registerEquipment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        locationId: LOCATION,
        code: "OVEN-01",
        name: "Deck oven",
        kind: "oven",
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      equipmentId: EQUIPMENT_ID,
      active: true,
    });
  });

  it("passes the optional dates and active flag through", async () => {
    const response = await POST(
      postRequest({
        ...validBody,
        serialNo: "SN-123",
        installedAt: "2026-01-15",
        warrantyUntil: "2028-01-15",
        active: false,
      }),
    );

    expect(response.status).toBe(200);
    expect(application.registerEquipment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        serialNo: "SN-123",
        installedAt: "2026-01-15",
        warrantyUntil: "2028-01-15",
        active: false,
      }),
    );
  });

  it("returns 400 for a missing required field", async () => {
    const response = await POST(postRequest({ ...validBody, name: "" }));

    expect(response.status).toBe(400);
    expect(application.registerEquipment).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad installedAt", async () => {
    const response = await POST(postRequest({ ...validBody, installedAt: "2026-02-30" }));

    expect(response.status).toBe(400);
    expect(application.registerEquipment).not.toHaveBeenCalled();
  });

  it("returns 403 for kitchen, which may not write equipment", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.registerEquipment).not.toHaveBeenCalled();
  });

  it("returns 403 for analyst, which reads but never writes", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.registerEquipment).not.toHaveBeenCalled();
  });

  it("returns 403 for purchasing", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["purchasing"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.registerEquipment).not.toHaveBeenCalled();
  });

  it("allows a location_manager scoped to the body's location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.registerEquipment).toHaveBeenCalled();
  });

  it("denies a location_manager scoped to another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [OTHER_LOCATION]),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.registerEquipment).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
    vi.mocked(application.registerEquipment).mockRejectedValue(new DomainError("code is required"));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "code is required" });
  });
});
