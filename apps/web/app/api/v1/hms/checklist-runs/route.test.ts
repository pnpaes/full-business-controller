import type { ChecklistRunRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresHmsStore: vi.fn(() => ({})),
    findChecklistTemplate: vi.fn(),
    listChecklistRuns: vi.fn(),
    recordChecklistRun: vi.fn(),
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
const TEMPLATE_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_RUN_ID = "55555555-5555-4555-8555-555555555555";

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

function getRequest(query = ""): Request {
  return new Request(`http://localhost/api/v1/hms/checklist-runs${query}`);
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/hms/checklist-runs", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  templateId: TEMPLATE_ID,
  locationId: LOCATION,
  runAt: "2026-02-01T07:00:00.000Z",
  results: [{ key: "fridge_temp", outcome: "pass" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresHmsStore).mockReturnValue({} as never);
  vi.mocked(application.findChecklistTemplate).mockResolvedValue({ id: TEMPLATE_ID } as never);
  vi.mocked(application.listChecklistRuns).mockResolvedValue([]);
  vi.mocked(application.recordChecklistRun).mockResolvedValue(runRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/hms/checklist-runs", () => {
  it("lists the organization's runs", async () => {
    vi.mocked(application.listChecklistRuns).mockResolvedValue([runRecord()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [RUN],
    });
    expect(application.listChecklistRuns).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes the template, location and status filters through", async () => {
    const response = await GET(
      getRequest(`?templateId=${TEMPLATE_ID}&locationId=${LOCATION}&status=completed&limit=10`),
    );

    expect(response.status).toBe(200);
    expect(application.listChecklistRuns).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        templateId: TEMPLATE_ID,
        locationId: LOCATION,
        status: "completed",
        limit: 10,
        offset: 0,
      }),
    );
  });

  it("restricts a location-scoped caller to their own location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [LOCATION]),
    );
    vi.mocked(application.listChecklistRuns).mockResolvedValue([
      runRecord(),
      runRecord({ id: OTHER_RUN_ID, locationId: OTHER_LOCATION }),
    ]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listChecklistRuns).toHaveBeenCalledWith(
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
    expect(application.listChecklistRuns).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listChecklistRuns).not.toHaveBeenCalled();
  });

  it("allows analyst to read checklists", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listChecklistRuns).toHaveBeenCalled();
  });

  it("returns 403 for purchasing", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["purchasing"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.listChecklistRuns).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed filter", async () => {
    const response = await GET(getRequest("?templateId=nope"));

    expect(response.status).toBe(400);
    expect(application.listChecklistRuns).not.toHaveBeenCalled();
  });

  it("returns 400 for an out-of-range offset", async () => {
    const response = await GET(getRequest("?offset=999999999999"));

    expect(response.status).toBe(400);
    expect(application.listChecklistRuns).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/hms/checklist-runs", () => {
  it("records a run for the session actor and served organization", async () => {
    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.findChecklistTemplate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, templateId: TEMPLATE_ID }),
    );
    expect(application.recordChecklistRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        performedBy: USER,
        templateId: TEMPLATE_ID,
        locationId: LOCATION,
        runAt: "2026-02-01T07:00:00.000Z",
        results: [{ key: "fridge_temp", outcome: "pass" }],
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      runId: RUN_ID,
      status: "in_progress",
    });
  });

  it("allows kitchen to record a run", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.recordChecklistRun).toHaveBeenCalled();
  });

  it("returns 403 for analyst, which may read but not record", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.recordChecklistRun).not.toHaveBeenCalled();
  });

  it("returns 403 for purchasing", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["purchasing"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.recordChecklistRun).not.toHaveBeenCalled();
  });

  it("returns 404 for a cross-organization template id", async () => {
    vi.mocked(application.findChecklistTemplate).mockResolvedValue(undefined);

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(404);
    expect(application.recordChecklistRun).not.toHaveBeenCalled();
  });

  it("denies a location-scoped caller a run at another location", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(
      access(["location_manager"], [OTHER_LOCATION]),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.recordChecklistRun).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad status", async () => {
    const response = await POST(postRequest({ ...validBody, status: "done" }));

    expect(response.status).toBe(400);
    expect(application.findChecklistTemplate).not.toHaveBeenCalled();
    expect(application.recordChecklistRun).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-array results", async () => {
    const response = await POST(postRequest({ ...validBody, results: "nope" }));

    expect(response.status).toBe(400);
    expect(application.findChecklistTemplate).not.toHaveBeenCalled();
    expect(application.recordChecklistRun).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad item outcome", async () => {
    const response = await POST(
      postRequest({ ...validBody, results: [{ key: "fridge_temp", outcome: "nope" }] }),
    );

    expect(response.status).toBe(400);
    expect(application.findChecklistTemplate).not.toHaveBeenCalled();
    expect(application.recordChecklistRun).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.recordChecklistRun).mockRejectedValue(
      new DomainError("results[0].outcome must be one of pass, fail, not_applicable"),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "results[0].outcome must be one of pass, fail, not_applicable",
    });
  });
});
