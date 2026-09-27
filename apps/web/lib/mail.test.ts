import { describe, expect, it, vi } from "vitest";

import { buildPasswordResetUrl, createSendGridMailAdapter, parseMailFrom } from "./mail";
import type { MailLogger } from "./mail";

const TOKEN = "TOKEN-do-not-log-9f3a2b1c4d5e6f70";
const API_KEY = "SG.test_key";
const FROM = "Aquarela <no-reply@example.no>";
const BASE_URL = "https://app.example.no/";

interface LogSpy extends MailLogger {
  readonly warn: ReturnType<typeof vi.fn>;
  readonly error: ReturnType<typeof vi.fn>;
}

function logSpy(): LogSpy {
  return { warn: vi.fn(), error: vi.fn() };
}

/** Every argument of every log call, serialised — the token must never appear. */
function loggedText(logger: LogSpy): string {
  return JSON.stringify([...logger.warn.mock.calls, ...logger.error.mock.calls]);
}

/** SendGrid accepts with 202 and an empty body. */
function fetchAccepted(): ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response("", { status: 202 }));
}

interface SentBody {
  readonly personalizations: readonly { readonly to: readonly { readonly email: string }[] }[];
  readonly from: { readonly email: string; readonly name?: string };
  readonly subject: string;
  readonly content: readonly { readonly type: string; readonly value: string }[];
}

function sentBody(init: RequestInit): SentBody {
  return JSON.parse(String(init.body)) as SentBody;
}

describe("createSendGridMailAdapter", () => {
  it("is not configured and sends nothing (no fetch) when the key is absent", async () => {
    const logger = logSpy();
    const fetchImpl = fetchAccepted();
    const adapter = createSendGridMailAdapter({ fetchImpl, logger });

    expect(adapter.configured).toBe(false);
    await adapter.sendPasswordResetEmail({
      to: "user@example.test",
      token: TOKEN,
      expiresInMinutes: 30,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(loggedText(logger)).not.toContain(TOKEN);
  });

  it("is not configured when any required value is blank or missing", async () => {
    const fetchImpl = fetchAccepted();
    const logger = logSpy();

    for (const options of [
      { apiKey: "", from: FROM, baseUrl: BASE_URL },
      { apiKey: API_KEY, from: "   ", baseUrl: BASE_URL },
      { apiKey: API_KEY, from: FROM, baseUrl: undefined },
    ]) {
      const adapter = createSendGridMailAdapter({ ...options, fetchImpl, logger });
      expect(adapter.configured).toBe(false);
      await adapter.sendPasswordResetEmail({
        to: "user@example.test",
        token: TOKEN,
        expiresInMinutes: 30,
      });
    }

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(loggedText(logger)).not.toContain(TOKEN);
  });

  it("posts the message to SendGrid v3 with a bearer key when configured", async () => {
    const logger = logSpy();
    const fetchImpl = fetchAccepted();
    const adapter = createSendGridMailAdapter({
      apiKey: API_KEY,
      from: FROM,
      baseUrl: BASE_URL,
      fetchImpl,
      logger,
    });

    expect(adapter.configured).toBe(true);
    await adapter.sendPasswordResetEmail({
      to: "user@example.test",
      token: TOKEN,
      expiresInMinutes: 45,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
    });

    const body = sentBody(init);
    expect(body.personalizations[0]?.to[0]?.email).toBe("user@example.test");
    expect(body.from).toEqual({ email: "no-reply@example.no", name: "Aquarela" });
    expect(body.subject.length).toBeGreaterThan(0);
    const plain = body.content.find((part) => part.type === "text/plain")?.value ?? "";
    const html = body.content.find((part) => part.type === "text/html")?.value ?? "";
    // The token is delivered in the body only; the link contains no token (ADR-0003).
    expect(plain).toContain(TOKEN);
    expect(html).toContain(TOKEN);
    expect(plain).toContain("https://app.example.no/reset/complete");
    expect(plain).not.toContain("reset/complete?token");
    expect(html).not.toContain("token=");

    // A successful send is silent; the token is never logged.
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(loggedText(logger)).not.toContain(TOKEN);
  });

  it("throws on a non-202 response with a token-free message and logs nothing", async () => {
    const logger = logSpy();
    const fetchImpl = vi.fn(async () => new Response("rejected", { status: 400 }));
    const adapter = createSendGridMailAdapter({
      apiKey: API_KEY,
      from: FROM,
      baseUrl: BASE_URL,
      fetchImpl,
      logger,
    });

    await expect(
      adapter.sendPasswordResetEmail({
        to: "user@example.test",
        token: TOKEN,
        expiresInMinutes: 30,
      }),
    ).rejects.toThrow(/400/);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(loggedText(logger)).not.toContain(TOKEN);
  });
});

describe("parseMailFrom", () => {
  it("parses a display name and a bare address", () => {
    expect(parseMailFrom("Aquarela <no-reply@example.no>")).toEqual({
      email: "no-reply@example.no",
      name: "Aquarela",
    });
    expect(parseMailFrom("no-reply@example.no")).toEqual({ email: "no-reply@example.no" });
  });
});

describe("buildPasswordResetUrl", () => {
  it("appends the reset path and normalises a trailing slash", () => {
    expect(buildPasswordResetUrl("https://app.example.no/")).toBe(
      "https://app.example.no/reset/complete",
    );
    expect(buildPasswordResetUrl("https://app.example.no")).toBe(
      "https://app.example.no/reset/complete",
    );
  });
});
