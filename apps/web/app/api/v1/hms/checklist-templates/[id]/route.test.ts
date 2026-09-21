import type { ChecklistTemplateRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresHmsStore: vi.fn(() => ({})),
    findChecklistTemplate: vi.fn(),
    updateChecklistTemplate: vi.fn(),
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
const TEMPLATE_ID = "22222222-2222-4222-8222-222222222222";
const PATH = `/api/v1/hms/checklist-templates/${TEMPLATE_ID}`;

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

function context(id: string = TEMPLATE_ID): { readonly params: Promise<{ readonly id: string }> } {
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresHmsStore).mockReturnValue({} as never);
  vi.mocked(application.findChecklistTemplate).mockResolvedValue(templateRecord());
  vi.mocked(application.updateChecklistTemplate).mockResolvedValue(templateRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/hms/checklist-templates/[id]", () => {
  it("returns one template", async () => {
    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, template: TEMPLATE });
    expect(application.findChecklistTemplate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, templateId: TEMPLATE_ID }),
    );
  });

  it("serves a template to a location-scoped caller — no location scope applies", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
  });

  it("returns 404 for an unknown template", async () => {
    vi.mocked(application.findChecklistTemplate).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
    expect(application.findChecklistTemplate).not.toHaveBeenCalled();
  });

  it("allows analyst to read", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(application.findChecklistTemplate).toHaveBeenCalled();
  });

  it("returns 403 for purchasing", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["purchasing"]));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(403);
    expect(application.findChecklistTemplate).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findChecklistTemplate).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/hms/checklist-templates/[id]", () => {
  it("updates a template for the session actor", async () => {
    vi.mocked(application.updateChecklistTemplate).mockResolvedValue(
      templateRecord({ name: "Renamed" }),
    );

    const response = await PATCH(patchRequest({ name: "Renamed" }), context());

    expect(response.status).toBe(200);
    expect(application.updateChecklistTemplate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        templateId: TEMPLATE_ID,
        name: "Renamed",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      template: { name: "Renamed" },
    });
  });

  it("returns 403 for kitchen, which may not author a template", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await PATCH(patchRequest({ name: "Renamed" }), context());

    expect(response.status).toBe(403);
    expect(application.updateChecklistTemplate).not.toHaveBeenCalled();
  });

  it("returns 403 for analyst, which may read but not author a template", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await PATCH(patchRequest({ name: "Renamed" }), context());

    expect(response.status).toBe(403);
    expect(application.updateChecklistTemplate).not.toHaveBeenCalled();
  });

  it("returns 403 for finance", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await PATCH(patchRequest({ name: "Renamed" }), context());

    expect(response.status).toBe(403);
    expect(application.updateChecklistTemplate).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad category", async () => {
    const response = await PATCH(patchRequest({ category: "nope" }), context());

    expect(response.status).toBe(400);
    expect(application.updateChecklistTemplate).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-array items", async () => {
    const response = await PATCH(patchRequest({ items: {} }), context());

    expect(response.status).toBe(400);
    expect(application.updateChecklistTemplate).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await PATCH(patchRequest({ name: "Renamed" }), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.updateChecklistTemplate).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.updateChecklistTemplate).mockRejectedValue(
      new DomainError("no updatable fields provided"),
    );

    const response = await PATCH(patchRequest({}), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "no updatable fields provided" });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.updateChecklistTemplate).mockRejectedValue(
      new NotFoundError("checklist template not found in organization"),
    );

    const response = await PATCH(patchRequest({ name: "Renamed" }), context());

    expect(response.status).toBe(404);
  });
});
