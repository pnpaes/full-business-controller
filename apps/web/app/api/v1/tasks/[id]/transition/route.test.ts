import type { TaskRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresTaskStore: vi.fn(() => ({})),
    findTask: vi.fn(),
    transitionTask: vi.fn(),
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

import { parseTransitionTaskBody } from "../../task-rows";

import { POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const TASK_ID = "55555555-5555-4555-8555-555555555555";

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
    status: "in_progress",
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
  vi.mocked(application.findTask).mockResolvedValue(taskRecord({ status: "open" }));
  vi.mocked(application.transitionTask).mockResolvedValue(taskRecord({ status: "in_progress" }));
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/tasks/[id]/transition", () => {
  it("transitions the task for the session actor", async () => {
    const response = await POST(request({ status: "in_progress" }), context(TASK_ID));

    expect(response.status).toBe(200);
    expect(application.transitionTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        taskId: TASK_ID,
        status: "in_progress",
      }),
    );
  });

  it.each(["owner", "general_manager", "admin", "location_manager"])(
    "allows %s to transition",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(request({ status: "in_progress" }), context(TASK_ID));

      expect(response.status).toBe(200);
      expect(application.transitionTask).toHaveBeenCalled();
    },
  );

  it.each(["kitchen", "front_of_house", "analyst"])(
    "returns 403 for %s, which may not transition",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(request({ status: "in_progress" }), context(TASK_ID));

      expect(response.status).toBe(403);
      expect(application.transitionTask).not.toHaveBeenCalled();
    },
  );

  it("returns 400 for a non-UUID id or a malformed body", async () => {
    const badId = await POST(request({ status: "in_progress" }), context("not-a-uuid"));
    expect(badId.status).toBe(400);

    const badBody = await POST(request({ status: "done" }), context(TASK_ID));
    expect(badBody.status).toBe(400);
    expect(application.transitionTask).not.toHaveBeenCalled();
  });

  it("returns 404 when the task does not exist in the organization", async () => {
    vi.mocked(application.findTask).mockResolvedValue(undefined);

    const response = await POST(request({ status: "in_progress" }), context(TASK_ID));

    expect(response.status).toBe(404);
    expect(application.transitionTask).not.toHaveBeenCalled();
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await POST(request({ status: "in_progress" }), context(TASK_ID));
    expect(response.status).toBe(401);
  });

  it("maps an illegal transition DomainError to 400 with its message", async () => {
    vi.mocked(application.transitionTask).mockRejectedValue(
      new DomainError("illegal task status transition: open -> resolved"),
    );

    const response = await POST(request({ status: "in_progress" }), context(TASK_ID));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "illegal task status transition: open -> resolved",
    });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.transitionTask).mockRejectedValue(
      new NotFoundError("task not found in organization"),
    );

    const response = await POST(request({ status: "in_progress" }), context(TASK_ID));
    expect(response.status).toBe(404);
  });
});

describe("parseTransitionTaskBody", () => {
  it("accepts a schema status", () => {
    const parsed = parseTransitionTaskBody({ status: "dismissed" });
    expect(parsed.ok && parsed.input).toEqual({ status: "dismissed" });
  });

  it.each([undefined, {}, { status: "done" }, { status: 3 }])(
    "rejects the malformed body %j",
    (body) => {
      expect(parseTransitionTaskBody(body as Record<string, unknown> | undefined).ok).toBe(false);
    },
  );
});
