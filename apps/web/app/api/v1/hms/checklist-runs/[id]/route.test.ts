import type { ChecklistRunRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresHmsStore: vi.fn(() => ({})),
    findChecklistRun: vi.fn(),
    updateChecklistRun: vi.fn(),
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
const TEMPLATE_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const PATH = `/api/v1/hms/checklist-runs/${RUN_ID}`;

const RUN = {
  id: RUN_ID,
  templateId: TEMPLATE_ID,
  locationId: LOCATION,
  runAt: "2026-02-01T07:00:00.000Z",
  performedBy: USER,
  status: "in_progress",
  results: [{ key: "fridge_temp", outcome: "pass" }],
  notes: null,
  createdAt: "2026-02-01T07:00:01.000Z",
  createdBy: USER,
};

function runRecord(overrides: Partial<ChecklistRunRecord> = {}): ChecklistRunRecord {
  return { ...RUN, organizationId: ORG, ...overrides };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function context(id: string = RUN_ID): { readonly params: Promise<{ readonly id: string }> } {
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
  vi.mocked(application.findChecklistRun).mockResolvedValue(runRecord());
  vi.mocked(application.updateChecklistRun).mockResolvedValue(runRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/hms/checklist-runs/[id]", () => {
  it("returns one run", async () => {
    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, run: RUN });
    expect(application.findChecklistRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, runId: RUN_ID }),
    );
  });

  it("denies a location-scoped caller a run at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findChecklistRun).mockResolvedValue(
      runRecord({ locationId: OTHER_LOCATION }),
    );

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(403);
  });

  it("returns 404 for a location-scoped caller's unknown run", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findChecklistRun).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
  });

  it("returns 404 for an unscoped caller's unknown run", async () => {
    vi.mocked(application.findChecklistRun).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
    expect(application.findChecklistRun).not.toHaveBeenCalled();
  });

  it("allows analyst to read", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(application.findChecklistRun).toHaveBeenCalled();
  });

  it("returns 403 for purchasing", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["purchasing"]));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(403);
    expect(application.findChecklistRun).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findChecklistRun).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/hms/checklist-runs/[id]", () => {
  it("updates a run for the session actor", async () => {
    vi.mocked(application.updateChecklistRun).mockResolvedValue(runRecord({ status: "completed" }));

    const response = await PATCH(patchRequest({ status: "completed" }), context());

    expect(response.status).toBe(200);
    expect(application.updateChecklistRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        runId: RUN_ID,
        status: "completed",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      run: { status: "completed" },
    });
  });

  it("allows kitchen to amend a run", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await PATCH(patchRequest({ status: "completed" }), context());

    expect(response.status).toBe(200);
    expect(application.updateChecklistRun).toHaveBeenCalled();
  });

  it("returns 403 for analyst, which may read but not amend a run", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await PATCH(patchRequest({ status: "completed" }), context());

    expect(response.status).toBe(403);
    expect(application.updateChecklistRun).not.toHaveBeenCalled();
  });

  it("returns 403 for finance", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await PATCH(patchRequest({ status: "completed" }), context());

    expect(response.status).toBe(403);
    expect(application.updateChecklistRun).not.toHaveBeenCalled();
  });

  it("denies a location-scoped caller a run at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findChecklistRun).mockResolvedValue(
      runRecord({ locationId: OTHER_LOCATION }),
    );

    const response = await PATCH(patchRequest({ status: "completed" }), context());

    expect(response.status).toBe(403);
    expect(application.updateChecklistRun).not.toHaveBeenCalled();
  });

  it("returns 404 for a location-scoped caller's unknown run", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.findChecklistRun).mockResolvedValue(undefined);

    const response = await PATCH(patchRequest({ status: "completed" }), context());

    expect(response.status).toBe(404);
    expect(application.updateChecklistRun).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad status", async () => {
    const response = await PATCH(patchRequest({ status: "done" }), context());

    expect(response.status).toBe(400);
    expect(application.updateChecklistRun).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-array results", async () => {
    const response = await PATCH(patchRequest({ results: 3 }), context());

    expect(response.status).toBe(400);
    expect(application.updateChecklistRun).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await PATCH(patchRequest({ status: "completed" }), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.updateChecklistRun).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.updateChecklistRun).mockRejectedValue(
      new DomainError("no updatable fields provided"),
    );

    const response = await PATCH(patchRequest({}), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "no updatable fields provided" });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.updateChecklistRun).mockRejectedValue(
      new NotFoundError("checklist run not found in organization"),
    );

    const response = await PATCH(patchRequest({ status: "completed" }), context());

    expect(response.status).toBe(404);
  });
});
