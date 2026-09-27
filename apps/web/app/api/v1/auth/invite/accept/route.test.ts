import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return { ...actual, acceptInvite: vi.fn() };
});

vi.mock("../../../../../../lib/auth", () => ({ getAuthStore: vi.fn(() => ({})) }));
vi.mock("../../../../../../lib/deps", () => ({
  getAuthDeps: vi.fn(() => ({ sessionTtlMinutes: 60, inviteTtlMinutes: 10080 })),
}));
vi.mock("../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../lib/limiters", () => ({
  limiters: {
    inviteAccept: { check: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })) },
  },
}));

import * as application from "@aquarela/application";
import { AUTH_ERROR_GENERIC } from "@aquarela/domain";

import { limiters } from "../../../../../../lib/limiters";

import { POST } from "./route";

const ORG = "org-1";

function request(body: unknown, sameOrigin = true): Request {
  return new Request("http://localhost/api/v1/auth/invite/accept", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sameOrigin ? { "sec-fetch-site": "same-origin" } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(limiters.inviteAccept.check).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
});

describe("POST /api/v1/auth/invite/accept", () => {
  it("sets the session cookie on success and never echoes the token", async () => {
    vi.mocked(application.acceptInvite).mockResolvedValue({
      ok: true,
      session: {
        token: "session-token-value",
        sessionId: "s1",
        expiresAt: new Date("2026-09-27T13:00:00.000Z"),
      },
    });

    const response = await POST(
      request({ token: "invite-token-value", password: "correct horse battery staple" }),
    );

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("aquarela_session=");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true, expiresAt: "2026-09-27T13:00:00.000Z" });
    expect(JSON.stringify(body)).not.toContain("invite-token-value");
    expect(JSON.stringify(body)).not.toContain("session-token-value");
    expect(application.acceptInvite).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        token: "invite-token-value",
        newPassword: "correct horse battery staple",
      }),
    );
  });

  it("returns the identical generic 401 for any rejected token", async () => {
    vi.mocked(application.acceptInvite).mockResolvedValue({
      ok: false,
      error: "Invalid credentials",
    });

    const response = await POST(request({ token: "whatever", password: "a password" }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: AUTH_ERROR_GENERIC });
  });

  it("returns 400 for a missing token or password without running the command", async () => {
    expect((await POST(request({ password: "a password" }))).status).toBe(400);
    expect((await POST(request({ token: "t" }))).status).toBe(400);
    expect(application.acceptInvite).not.toHaveBeenCalled();
  });

  it("returns 403 for a cross-origin request", async () => {
    const response = await POST(request({ token: "t", password: "a password" }, false));
    expect(response.status).toBe(403);
    expect(application.acceptInvite).not.toHaveBeenCalled();
  });

  it("returns 429 when the fail-closed throttle denies", async () => {
    vi.mocked(limiters.inviteAccept.check).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 42,
    });
    const response = await POST(request({ token: "t", password: "a password" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(application.acceptInvite).not.toHaveBeenCalled();
  });
});
