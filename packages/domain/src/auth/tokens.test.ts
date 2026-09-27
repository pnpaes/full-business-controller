import { describe, expect, it } from "vitest";

import { DomainError } from "../errors";
import {
  OPAQUE_TOKEN_BYTES,
  SESSION_TOKEN_BYTES,
  generateInviteToken,
  generateOpaqueToken,
  generatePasswordResetToken,
  generateSessionToken,
  hashInviteToken,
  hashOpaqueToken,
  hashPasswordResetToken,
  hashSessionToken,
  inviteTokenMatches,
  opaqueTokenMatches,
  passwordResetTokenMatches,
  sessionTokenMatches,
} from "./tokens";

describe("opaque tokens", () => {
  it("generates distinct URL-safe tokens of the configured size", () => {
    const first = generateOpaqueToken();
    const second = generateOpaqueToken();
    expect(first).not.toBe(second);
    expect(Buffer.from(first, "base64url")).toHaveLength(OPAQUE_TOKEN_BYTES);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("honours a custom byte length and rejects a non-positive one", () => {
    expect(Buffer.from(generateOpaqueToken(16), "base64url")).toHaveLength(16);
    for (const bytes of [0, -1, 1.5, Number.NaN]) {
      expect(() => generateOpaqueToken(bytes)).toThrow(DomainError);
    }
  });

  it("hashes deterministically to 64 hex characters", () => {
    const token = generateOpaqueToken();
    const hash = hashOpaqueToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOpaqueToken(token)).toBe(hash);
    expect(token).not.toBe(hash);
  });

  it("matches the right token and rejects a wrong token or malformed hash", () => {
    const token = generateOpaqueToken();
    const hash = hashOpaqueToken(token);
    expect(opaqueTokenMatches(token, hash)).toBe(true);
    expect(opaqueTokenMatches(generateOpaqueToken(), hash)).toBe(false);
    expect(opaqueTokenMatches(token, "not-hex")).toBe(false);
    expect(opaqueTokenMatches(token, "0".repeat(64))).toBe(false);
  });
});

describe("session tokens", () => {
  it("generates distinct URL-safe tokens of the configured size", () => {
    const first = generateSessionToken();
    const second = generateSessionToken();
    expect(first).not.toBe(second);
    expect(Buffer.from(first, "base64url")).toHaveLength(SESSION_TOKEN_BYTES);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes deterministically and matches the right token", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionTokenMatches(token, hash)).toBe(true);
    expect(sessionTokenMatches(generateSessionToken(), hash)).toBe(false);
    expect(sessionTokenMatches(token, "not-hex")).toBe(false);
  });
});

describe("password-reset tokens", () => {
  it("generates distinct URL-safe tokens of the configured size", () => {
    const first = generatePasswordResetToken();
    const second = generatePasswordResetToken();
    expect(first).not.toBe(second);
    expect(Buffer.from(first, "base64url")).toHaveLength(OPAQUE_TOKEN_BYTES);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes deterministically and matches the right token", () => {
    const token = generatePasswordResetToken();
    const hash = hashPasswordResetToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(passwordResetTokenMatches(token, hash)).toBe(true);
    expect(passwordResetTokenMatches(generatePasswordResetToken(), hash)).toBe(false);
    expect(passwordResetTokenMatches(token, "not-hex")).toBe(false);
  });

  it("cannot validate the same token across families", () => {
    const token = generateSessionToken();
    expect(sessionTokenMatches(token, hashSessionToken(token))).toBe(true);
    expect(passwordResetTokenMatches(token, hashSessionToken(token))).toBe(false);
    expect(sessionTokenMatches(token, hashPasswordResetToken(token))).toBe(false);
  });

  it("produces tokens and hashes independent from the session family", () => {
    const session = generateSessionToken();
    const reset = generatePasswordResetToken();
    expect(session).not.toBe(reset);
    expect(hashSessionToken(session)).not.toBe(hashPasswordResetToken(reset));
    expect(sessionTokenMatches(reset, hashSessionToken(session))).toBe(false);
    expect(passwordResetTokenMatches(session, hashPasswordResetToken(reset))).toBe(false);
  });
});

describe("employee-invite tokens", () => {
  it("hashes deterministically and matches the right token", () => {
    const token = generateInviteToken();
    const hash = hashInviteToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(inviteTokenMatches(token, hash)).toBe(true);
    expect(inviteTokenMatches(generateInviteToken(), hash)).toBe(false);
    expect(inviteTokenMatches(token, "not-hex")).toBe(false);
  });

  it("cannot validate a reset or session token across families", () => {
    const reset = generatePasswordResetToken();
    const session = generateSessionToken();
    const invite = generateInviteToken();
    expect(inviteTokenMatches(reset, hashPasswordResetToken(reset))).toBe(false);
    expect(inviteTokenMatches(session, hashSessionToken(session))).toBe(false);
    expect(passwordResetTokenMatches(invite, hashInviteToken(invite))).toBe(false);
    expect(sessionTokenMatches(invite, hashInviteToken(invite))).toBe(false);
  });
});
