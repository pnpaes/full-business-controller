import type { ChecklistTemplateRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresHmsStore: vi.fn(() => ({})),
    listChecklistTemplates: vi.fn(),
    registerChecklistTemplate: vi.fn(),
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
const TEMPLATE_ID = "22222222-2222-4222-8222-222222222222";

const TEMPLATE = {
  id: TEMPLATE_ID,
  name: "Daily opening",
  category: "opening",
  frequency: "daily",
  items: [{ key: "fridge_temp", label: "Fridge temperature" }],
  active: true,
  supersedesId: null,
  createdAt: "2026-02-01T08:00:00.000Z",
  createdBy: USER,
};

function templateRecord(overrides: Partial<ChecklistTemplateRecord> = {}): ChecklistTemplateRecord {
  return { ...TEMPLATE, organizationId: ORG, ...overrides };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function getRequest(query = ""): Request {
  return new Request(`http://localhost/api/v1/hms/checklist-templates${query}`);
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/hms/checklist-templates", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  name: "Daily opening",
  category: "opening",
  frequency: "daily",
  items: [{ key: "fridge_temp", label: "Fridge temperature" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresHmsStore).mockReturnValue({} as never);
  vi.mocked(application.listChecklistTemplates).mockResolvedValue([]);
  vi.mocked(application.registerChecklistTemplate).mockResolvedValue(templateRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/hms/checklist-templates", () => {
  it("lists the organization's templates", async () => {
    vi.mocked(application.listChecklistTemplates).mockResolvedValue([templateRecord()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [TEMPLATE],
    });
    expect(application.listChecklistTemplates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes the category and active filters through", async () => {
    const response = await GET(getRequest("?category=opening&active=true&limit=10"));

    expect(response.status).toBe(200);
    expect(application.listChecklistTemplates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        category: "opening",
        active: true,
        limit: 10,
        offset: 0,
      }),
    );
  });

  it("applies no location scope — templates are organization-wide", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listChecklistTemplates).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ locationId: expect.anything() }),
    );
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listChecklistTemplates).not.toHaveBeenCalled();
  });

  it("allows analyst to read checklists", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listChecklistTemplates).toHaveBeenCalled();
  });

  it("returns 403 for finance", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.listChecklistTemplates).not.toHaveBeenCalled();
  });

  it("returns 403 for purchasing", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["purchasing"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.listChecklistTemplates).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed filter", async () => {
    const response = await GET(getRequest("?active=maybe"));

    expect(response.status).toBe(400);
    expect(application.listChecklistTemplates).not.toHaveBeenCalled();
  });

  it("returns 400 for an out-of-range offset", async () => {
    const response = await GET(getRequest("?offset=999999999999"));

    expect(response.status).toBe(400);
    expect(application.listChecklistTemplates).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/hms/checklist-templates", () => {
  it("registers a template for the session actor and served organization", async () => {
    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.registerChecklistTemplate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        name: "Daily opening",
        category: "opening",
        frequency: "daily",
        items: [{ key: "fridge_temp", label: "Fridge temperature" }],
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      templateId: TEMPLATE_ID,
      active: true,
    });
  });

  it("allows admin to author a template", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["admin"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.registerChecklistTemplate).toHaveBeenCalled();
  });

  it("returns 403 for kitchen, which may not author a template", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.registerChecklistTemplate).not.toHaveBeenCalled();
  });

  it("returns 403 for analyst, which may read but not author a template", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.registerChecklistTemplate).not.toHaveBeenCalled();
  });

  it("returns 403 for purchasing", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["purchasing"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.registerChecklistTemplate).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad category", async () => {
    const response = await POST(postRequest({ ...validBody, category: "not_a_category" }));

    expect(response.status).toBe(400);
    expect(application.registerChecklistTemplate).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad frequency", async () => {
    const response = await POST(postRequest({ ...validBody, frequency: "hourly" }));

    expect(response.status).toBe(400);
    expect(application.registerChecklistTemplate).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-array items", async () => {
    const response = await POST(postRequest({ ...validBody, items: "not-an-array" }));

    expect(response.status).toBe(400);
    expect(application.registerChecklistTemplate).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.registerChecklistTemplate).mockRejectedValue(
      new DomainError("items[0].key is required"),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "items[0].key is required" });
  });
});
