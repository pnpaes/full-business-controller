import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { DomainError } from "../errors";

/** 256 bits of entropy for every opaque token family. */
export const OPAQUE_TOKEN_BYTES = 32;

const OPAQUE_TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Domain-separation prefixes. Every token family hashes `context + token`, so a
 * token minted for one family can never validate against another family's stored
 * hash (e.g. a session token cannot be presented as a password-reset token).
 */
const SESSION_TOKEN_CONTEXT = "aquarela:session:";
const PASSWORD_RESET_TOKEN_CONTEXT = "aquarela:password-reset:";
const INVITE_TOKEN_CONTEXT = "aquarela:user-invite:";

/** Generates an opaque, URL-safe token from the CSPRNG. */
export function generateOpaqueToken(bytes = OPAQUE_TOKEN_BYTES): string {
  if (!Number.isInteger(bytes) || bytes < 1) {
    throw new DomainError("opaque token length must be a positive integer");
  }
  return randomBytes(bytes).toString("base64url");
}

/**
 * Hashes an opaque token for storage. Opaque tokens are high-entropy (>= 256
 * bits), so a fast SHA-256 is correct here: Argon2 exists to slow down
 * low-entropy password guessing and is explicitly not used for these tokens.
 * `context` is the family's domain-separation prefix.
 */
export function hashOpaqueToken(token: string, context = ""): string {
  return createHash("sha256")
    .update(context + token, "utf8")
    .digest("hex");
}

/**
 * Constant-time check of a presented token against a stored SHA-256 hex hash
 * for the same token family.
 */
export function opaqueTokenMatches(token: string, tokenHash: string, context = ""): boolean {
  if (!OPAQUE_TOKEN_HASH_PATTERN.test(tokenHash)) {
    return false;
  }

  const expected = Buffer.from(hashOpaqueToken(token, context), "hex");
  const actual = Buffer.from(tokenHash, "hex");
  return timingSafeEqual(expected, actual);
}

/** 256 bits of entropy for an opaque session token (`auth_session.token_hash`). */
export const SESSION_TOKEN_BYTES = OPAQUE_TOKEN_BYTES;

export function generateSessionToken(): string {
  return generateOpaqueToken(SESSION_TOKEN_BYTES);
}

export function hashSessionToken(token: string): string {
  return hashOpaqueToken(token, SESSION_TOKEN_CONTEXT);
}

export function sessionTokenMatches(token: string, tokenHash: string): boolean {
  return opaqueTokenMatches(token, tokenHash, SESSION_TOKEN_CONTEXT);
}

export function generatePasswordResetToken(): string {
  return generateOpaqueToken();
}

export function hashPasswordResetToken(token: string): string {
  return hashOpaqueToken(token, PASSWORD_RESET_TOKEN_CONTEXT);
}

export function passwordResetTokenMatches(token: string, tokenHash: string): boolean {
  return opaqueTokenMatches(token, tokenHash, PASSWORD_RESET_TOKEN_CONTEXT);
}

/**
 * Employee-invite tokens (`DEC-146`): one family for the manager-provisioned
 * account invite, so a reset or session token can never redeem an invite (or
 * vice versa) even though all three are 256-bit opaque strings.
 */
export function generateInviteToken(): string {
  return generateOpaqueToken();
}

export function hashInviteToken(token: string): string {
  return hashOpaqueToken(token, INVITE_TOKEN_CONTEXT);
}

export function inviteTokenMatches(token: string, tokenHash: string): boolean {
  return opaqueTokenMatches(token, tokenHash, INVITE_TOKEN_CONTEXT);
}
