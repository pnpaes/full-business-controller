import type { UserAccess } from "@aquarela/application";
import { AUTH_ERROR_GENERIC, DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    inviteEmployeeUser: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(),
}));
vi.mock("../../../../../../lib/deps", () => ({
  getAuthDeps: vi.fn(() => ({ sessionTtlMinutes: 1 })),
  deliverInviteEmail: vi.fn(async () => undefined),
}));
vi.mock("../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
// The throttle is stubbed allowed here so the route test stays off the shared
// store; the fail-closed posture is covered by the limiter's own tests.
vi.mock("../../../../../../lib/limiters", () => ({
  limiters: {
    inviteEmployee: { check: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })) },
  },
}));

import * as application from "@aquarela/application";

import { getAuthStore, requireSession } from "../../../../../../lib/auth";
import { deliverInviteEmail } from "../../../../../../lib/deps";
import { AuthHttpError } from "../../../../../../lib/errors";

import { POST } from "./route";

const ORG = "org-1";
const USER = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE = "22222222-2222-4222-8222-222222222222";
const EMAIL = "newhire@example.test";

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/v1/administration/users/invite", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

function store(employee: { userId: string | null } | undefined): void {
  vi.mocked(getAuthStore).mockReturnValue({
    findEmployeeLink: vi.fn(async () => employee),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "t",
  } as never);
  vi.mocked(application.inviteEmployeeUser).mockResolvedValue({
    userId: "user-9",
    employeeId: EMPLOYEE,
    token: "SECRET-INVITE-TOKEN",
    expiresAt: new Date("2026-10-04T12:00:00.000Z"),
  });
  store({ userId: null });
});

describe("POST /api/v1/administration/users/invite", () => {
  it("invites the employee, delivers the token and never returns it", async () => {
    const response = await POST(request({ employeeId: EMPLOYEE, email: EMAIL }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, userId: "user-9", employeeId: EMPLOYEE });
    expect(JSON.stringify(body)).not.toContain("SECRET-INVITE-TOKEN");

    expect(application.inviteEmployeeUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        employeeId: EMPLOYEE,
        email: EMAIL,
      }),
    );
    expect(deliverInviteEmail).toHaveBeenCalledWith({
      organizationId: ORG,
      userId: "user-9",
      email: EMAIL,
      token: "SECRET-INVITE-TOKEN",
    });
  });

  it("returns 403 for a role outside the users gate", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));
    const response = await POST(request({ employeeId: EMPLOYEE, email: EMAIL }));
    expect(response.status).toBe(403);
    expect(application.inviteEmployeeUser).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));
    expect((await POST(request({ employeeId: EMPLOYEE, email: EMAIL }))).status).toBe(401);
  });

  it("returns 400 for a non-UUID employee id or a missing email", async () => {
    expect((await POST(request({ employeeId: "not-a-uuid", email: EMAIL }))).status).toBe(400);
    expect((await POST(request({ employeeId: EMPLOYEE }))).status).toBe(400);
    expect(application.inviteEmployeeUser).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown or cross-organization employee", async () => {
    store(undefined);
    const response = await POST(request({ employeeId: EMPLOYEE, email: EMAIL }));
    expect(response.status).toBe(404);
    expect(application.inviteEmployeeUser).not.toHaveBeenCalled();
  });

  it("maps a DomainError from the command to a generic 400 that hides the reason", async () => {
    vi.mocked(application.inviteEmployeeUser).mockRejectedValue(
      new DomainError("employee already has an active account"),
    );
    const response = await POST(request({ employeeId: EMPLOYEE, email: EMAIL }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: AUTH_ERROR_GENERIC });
  });

  it("maps a NotFoundError from the command to 404", async () => {
    vi.mocked(application.inviteEmployeeUser).mockRejectedValue(
      new NotFoundError("employee not found"),
    );
    const response = await POST(request({ employeeId: EMPLOYEE, email: EMAIL }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: AUTH_ERROR_GENERIC });
  });
});
