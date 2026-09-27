import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    beginPasswordReset: vi.fn(),
    createPostgresAuthStore: vi.fn(() => ({})),
  };
});

vi.mock("../../../../../../lib/auth", () => ({ getAuthStore: vi.fn(() => ({})) }));
vi.mock("../../../../../../lib/deps", () => ({
  getAuthDeps: vi.fn(() => ({ sessionTtlMinutes: 1, passwordResetTtlMinutes: 30 })),
}));
vi.mock("../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../lib/guards", () => ({
  withMutationGuards: async (_request: Request, _limiter: unknown, run: () => Promise<Response>) =>
    run(),
}));

import * as application from "@aquarela/application";

import { POST } from "./route";

const ORG = "org-1";
const PATH = "/api/v1/auth/password-reset/begin";

function postRequest(body: unknown): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.beginPasswordReset).mockResolvedValue({ ok: true });
});

describe("POST /api/v1/auth/password-reset/begin", () => {
  it("returns only { ok: true } for a known identifier and forwards the request", async () => {
    const response = await POST(postRequest({ identifier: "person@example.test" }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    // Enumeration-safe: nothing but `ok` — no token, no status, no user.
    expect(Object.keys(body)).toEqual(["ok"]);
    expect(body.ok).toBe(true);
    expect(application.beginPasswordReset).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, identifier: "person@example.test" }),
    );
  });

  it("returns the identical generic { ok: true } for an unknown identifier", async () => {
    const response = await POST(postRequest({ identifier: "nobody@example.test" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("returns 400 for a missing identifier without running the command", async () => {
    const response = await POST(postRequest({}));

    expect(response.status).toBe(400);
    expect(application.beginPasswordReset).not.toHaveBeenCalled();
  });
});
