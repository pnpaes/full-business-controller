import type { TaskRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresTaskStore: vi.fn(() => ({})),
    findTask: vi.fn(),
    assignTask: vi.fn(),
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
import { AuthHttpError } from "../../../../../../lib/errors";

import { parseAssignTaskBody } from "../../task-rows";

import { POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const TASK_ID = "55555555-5555-4555-8555-555555555555";
const OWNER_ID = "66666666-6666-4666-8666-666666666666";

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

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function context(id: string): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function request(body: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresTaskStore).mockReturnValue({} as never);
  vi.mocked(application.findTask).mockResolvedValue(taskRecord());
  vi.mocked(application.assignTask).mockResolvedValue(taskRecord({ ownerId: OWNER_ID }));
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/tasks/[id]/assign", () => {
  it("assigns the task to the named user", async () => {
    const response = await POST(request({ ownerId: OWNER_ID }), context(TASK_ID));

    expect(response.status).toBe(200);
    expect(application.assignTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        taskId: TASK_ID,
        ownerId: OWNER_ID,
      }),
    );
  });

  it("unassigns with an explicit null", async () => {
    const response = await POST(request({ ownerId: null }), context(TASK_ID));

    expect(response.status).toBe(200);
    expect(application.assignTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ownerId: null }),
    );
  });

  it.each(["owner", "general_manager", "admin", "location_manager"])(
    "allows %s to assign",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(request({ ownerId: OWNER_ID }), context(TASK_ID));

      expect(response.status).toBe(200);
      expect(application.assignTask).toHaveBeenCalled();
    },
  );

  it("returns 403 for a read-only role", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await POST(request({ ownerId: OWNER_ID }), context(TASK_ID));

    expect(response.status).toBe(403);
    expect(application.assignTask).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id, a missing ownerId or a bad uuid", async () => {
    expect((await POST(request({ ownerId: OWNER_ID }), context("not-a-uuid"))).status).toBe(400);
    expect((await POST(request({}), context(TASK_ID))).status).toBe(400);
    expect((await POST(request({ ownerId: "nope" }), context(TASK_ID))).status).toBe(400);
    expect(application.assignTask).not.toHaveBeenCalled();
  });

  it("returns 404 when the task does not exist in the organization", async () => {
    vi.mocked(application.findTask).mockResolvedValue(undefined);

    const response = await POST(request({ ownerId: OWNER_ID }), context(TASK_ID));

    expect(response.status).toBe(404);
    expect(application.assignTask).not.toHaveBeenCalled();
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await POST(request({ ownerId: OWNER_ID }), context(TASK_ID));
    expect(response.status).toBe(401);
  });

  it("maps a terminal-task DomainError to 400", async () => {
    vi.mocked(application.assignTask).mockRejectedValue(
      new DomainError("cannot assign a task that is resolved or dismissed"),
    );

    const response = await POST(request({ ownerId: OWNER_ID }), context(TASK_ID));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "cannot assign a task that is resolved or dismissed",
    });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.assignTask).mockRejectedValue(
      new NotFoundError("task not found in organization"),
    );

    const response = await POST(request({ ownerId: OWNER_ID }), context(TASK_ID));
    expect(response.status).toBe(404);
  });
});

describe("parseAssignTaskBody", () => {
  it("accepts a uuid or an explicit null", () => {
    expect(parseAssignTaskBody({ ownerId: OWNER_ID }).ok).toBe(true);
    const cleared = parseAssignTaskBody({ ownerId: null });
    expect(cleared.ok && cleared.input).toEqual({ ownerId: null });
  });

  it.each([undefined, {}, { ownerId: "nope" }, { ownerId: 3 }])(
    "rejects the malformed body %j",
    (body) => {
      expect(parseAssignTaskBody(body as Record<string, unknown> | undefined).ok).toBe(false);
    },
  );
});
