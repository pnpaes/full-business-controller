import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("./mail", () => ({
  createSendGridMailAdapter: vi.fn(() => ({
    configured: true,
    sendPasswordResetEmail: mocks.sendPasswordResetEmail,
  })),
}));

vi.mock("@aquarela/logger", () => ({
  createLogger: vi.fn(() => ({ warn: mocks.warn, error: mocks.error })),
}));

vi.mock("./config", () => ({
  getConfig: vi.fn(() => ({
    SESSION_TTL_MINUTES: 480,
    PASSWORD_RESET_TTL_MINUTES: 30,
    SENDGRID_API_KEY: "SG.test_key",
    MAIL_FROM: "Aquarela <no-reply@example.no>",
    APP_BASE_URL: "https://app.example.no",
  })),
}));

import { createSendGridMailAdapter } from "./mail";

import { getAuthDeps } from "./deps";

const TOKEN = "TOKEN-do-not-log-9f3a2b1c4d5e6f70";

function loggedText(): string {
  return JSON.stringify([...mocks.warn.mock.calls, ...mocks.error.mock.calls]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendPasswordResetEmail.mockResolvedValue(undefined);
});

describe("getAuthDeps deliverResetToken", () => {
  it("hands the recipient and token to the configured mail port, and logs nothing", async () => {
    const deps = getAuthDeps();

    await deps.deliverResetToken?.({
      organizationId: "org-1",
      userId: "user-1",
      email: "user@example.test",
      token: TOKEN,
    });

    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledWith({
      to: "user@example.test",
      token: TOKEN,
      expiresInMinutes: 30,
    });
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(loggedText()).not.toContain(TOKEN);
  });

  it("swallows a transport failure, logs it without the token, and stays generic", async () => {
    mocks.sendPasswordResetEmail.mockRejectedValueOnce(
      new Error("sendgrid email delivery failed with status 400"),
    );
    const deps = getAuthDeps();

    await expect(
      deps.deliverResetToken?.({
        organizationId: "org-1",
        userId: "user-1",
        email: "user@example.test",
        token: TOKEN,
      }),
    ).resolves.toBeUndefined();

    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(loggedText()).not.toContain(TOKEN);
  });

  it("does not send for an account without an email address", async () => {
    const deps = getAuthDeps();

    await deps.deliverResetToken?.({
      organizationId: "org-1",
      userId: "user-1",
      email: null,
      token: TOKEN,
    });

    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(loggedText()).not.toContain(TOKEN);
  });

  it("builds the adapter from the validated SendGrid configuration", () => {
    getAuthDeps();

    expect(createSendGridMailAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "SG.test_key",
        from: "Aquarela <no-reply@example.no>",
        baseUrl: "https://app.example.no",
      }),
    );
  });
});
