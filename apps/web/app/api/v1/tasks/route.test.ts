import type { TaskRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresTaskStore: vi.fn(() => ({})),
    listTasks: vi.fn(),
    createTask: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../lib/organization", () => ({ resolveOrganization: vi.fn(() => "org-1") }));
vi.mock("../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../lib/auth";
import { AuthHttpError } from "../../../../lib/errors";
import { getServerSession } from "../../../../lib/server-session";

import { GET, POST } from "./route";
import { parseCreateTaskBody, parseTaskListQuery } from "./task-rows";

const ORG = "org-1";
const USER = "user-1";
const TASK_ID = "55555555-5555-4555-8555-555555555555";
const OWNER_ID = "66666666-6666-4666-8666-666666666666";
const PATH = "/api/v1/tasks";

function taskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: TASK_ID,
    organizationId: ORG,
    type: "follow_up",
    linkedEntityType: null,
    linkedEntityId: null,
    ownerId: null,
    dueDate: null,
    priority: "normal",
    status: "open",
    resolution: null,
    createdAt: "2026-09-24T09:00:00.000Z",
    updatedAt: null,
    ...overrides,
  };
}

function row(overrides: Partial<TaskRecord> = {}): Record<string, unknown> {
  const record: Record<string, unknown> = { ...taskRecord(overrides) };
  delete record.organizationId;
  return record;
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresTaskStore).mockReturnValue({} as never);
  vi.mocked(application.listTasks).mockResolvedValue([]);
  vi.mocked(application.createTask).mockResolvedValue(taskRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/tasks", () => {
  it("lists the organization's tasks", async () => {
    vi.mocked(application.listTasks).mockResolvedValue([taskRecord()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 100,
      offset: 0,
      tasks: [row()],
    });
    expect(application.listTasks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 100, offset: 0 }),
    );
  });

  it("passes the status, owner and due-before filters through", async () => {
    const response = await GET(
      getRequest(`?status=resolved&ownerId=${OWNER_ID}&dueBefore=2026-10-01&limit=10&offset=5`),
    );

    expect(response.status).toBe(200);
    expect(application.listTasks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        status: "resolved",
        ownerId: OWNER_ID,
        dueBefore: "2026-10-01",
        limit: 10,
        offset: 5,
      }),
    );
  });

  it.each([
    "owner",
    "general_manager",
    "location_manager",
    "kitchen",
    "front_of_house",
    "purchasing",
    "finance",
    "admin",
    "analyst",
    "product_owner",
    "technical_owner",
    "data_owner",
  ])("allows %s to read tasks", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listTasks).toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listTasks).not.toHaveBeenCalled();
  });

  it("returns 403 for a caller with no role", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.listTasks).not.toHaveBeenCalled();
  });

  it.each([
    "?status=bogus",
    "?status=done",
    "?ownerId=not-a-uuid",
    "?dueBefore=2026-13-01",
    "?limit=0",
    "?limit=201",
    "?offset=201",
  ])("returns 400 for the malformed query %j", async (query) => {
    const response = await GET(getRequest(query));

    expect(response.status).toBe(400);
    expect(application.listTasks).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/tasks", () => {
  it("creates a task for the session actor and served organization", async () => {
    const response = await POST(
      postRequest({ type: "follow_up", priority: "high", dueDate: "2026-10-01" }),
    );

    expect(response.status).toBe(200);
    expect(application.createTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        type: "follow_up",
        priority: "high",
        dueDate: "2026-10-01",
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, task: row() });
  });

  it.each(["owner", "general_manager", "admin", "location_manager"])(
    "allows %s to create a task",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest({ type: "follow_up", priority: "normal" }));

      expect(response.status).toBe(200);
      expect(application.createTask).toHaveBeenCalled();
    },
  );

  it.each(["kitchen", "front_of_house", "analyst", "finance", "purchasing"])(
    "returns 403 for %s, which may not create a task",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest({ type: "follow_up", priority: "normal" }));

      expect(response.status).toBe(403);
      expect(application.createTask).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { type: "   ", priority: "normal" },
    { type: "follow_up" },
    { type: "follow_up", priority: "normal", dueDate: "2026-13-01" },
    { type: "follow_up", priority: "normal", ownerId: "nope" },
  ])("returns 400 for the malformed body %j", async (body) => {
    const response = await POST(postRequest(body));

    expect(response.status).toBe(400);
    expect(application.createTask).not.toHaveBeenCalled();
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await POST(postRequest({ type: "follow_up", priority: "normal" }));

    expect(response.status).toBe(401);
    expect(application.createTask).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.createTask).mockRejectedValue(
      new DomainError("linkedEntityType and linkedEntityId must be set together"),
    );

    const response = await POST(
      postRequest({ type: "follow_up", priority: "normal", linkedEntityType: "x" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "linkedEntityType and linkedEntityId must be set together",
    });
  });
});

describe("parseTaskListQuery", () => {
  it("parses the optional filters and paging", () => {
    const parsed = parseTaskListQuery(
      new URLSearchParams({
        status: "dismissed",
        ownerId: OWNER_ID,
        dueBefore: "2026-10-01",
        limit: "25",
        offset: "2",
      }),
    );

    expect(parsed.ok && parsed.query).toEqual({
      status: "dismissed",
      ownerId: OWNER_ID,
      dueBefore: "2026-10-01",
      limit: 25,
      offset: 2,
    });
  });

  it("defaults the page to the application limit and offset 0", () => {
    const parsed = parseTaskListQuery(new URLSearchParams());
    expect(parsed.ok && parsed.query).toEqual({ limit: 100, offset: 0 });
  });

  it.each([
    new URLSearchParams({ status: "done" }),
    new URLSearchParams({ ownerId: "nope" }),
    new URLSearchParams({ dueBefore: "2026-02-31" }),
    new URLSearchParams({ limit: "0" }),
  ])("rejects the malformed query %j", (searchParams) => {
    expect(parseTaskListQuery(searchParams).ok).toBe(false);
  });
});

describe("parseCreateTaskBody", () => {
  it("parses a full create body", () => {
    const parsed = parseCreateTaskBody({
      type: "follow_up",
      priority: "high",
      dueDate: "2026-10-01",
      ownerId: OWNER_ID,
      linkedEntityType: "hms_incident",
      linkedEntityId: TASK_ID,
    });

    expect(parsed.ok && parsed.input).toEqual({
      type: "follow_up",
      priority: "high",
      dueDate: "2026-10-01",
      ownerId: OWNER_ID,
      linkedEntityType: "hms_incident",
      linkedEntityId: TASK_ID,
    });
  });

  it("defaults the optional fields to null", () => {
    const parsed = parseCreateTaskBody({ type: "follow_up", priority: "normal" });
    expect(parsed.ok && parsed.input).toEqual({
      type: "follow_up",
      priority: "normal",
      dueDate: null,
      ownerId: null,
      linkedEntityType: null,
      linkedEntityId: null,
    });
  });

  it.each([
    undefined,
    {},
    { type: "  ", priority: "normal" },
    { type: "follow_up", priority: "" },
    { type: "follow_up", priority: "normal", dueDate: "2026-02-31" },
    { type: "follow_up", priority: "normal", ownerId: "nope" },
  ])("rejects the malformed body %j", (body) => {
    expect(parseCreateTaskBody(body as Record<string, unknown> | undefined).ok).toBe(false);
  });
});
