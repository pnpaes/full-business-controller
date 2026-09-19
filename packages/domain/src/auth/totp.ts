import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { DomainError } from "../errors";

/** RFC 4648 base32 alphabet (uppercase, no padding on encode). */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE32_PATTERN = /^[A-Z2-7]+$/;
/** Unpadded base32 character counts (chars % 8) that decode to whole bytes. */
const CANONICAL_BASE32_REMAINDERS = new Set([0, 2, 4, 5, 7]);

const TOKEN_PATTERN = /^\d{6}$/;
const TOTP_DIGITS = 6;
const TOTP_MODULO = 10 ** TOTP_DIGITS;

/** RFC 6238 time step, in seconds. */
export const TOTP_PERIOD_SECONDS = 30;
/** 160-bit secret, the RFC 4226 §4 recommendation. */
export const TOTP_SECRET_BYTES = 20;

/**
 * Encodes bytes as unpadded uppercase RFC 4648 base32 (the form authenticator
 * apps display for TOTP secrets).
 */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET.charAt((value << (5 - bits)) & 31);
  }

  return output;
}

/**
 * Decodes RFC 4648 base32, tolerating spaces and a missing/partial `=` padding.
 * Rejects invalid characters, empty input and non-canonical leftovers.
 */
export function base32Decode(encoded: string): Uint8Array {
  const normalized = encoded.replace(/\s+/g, "").replace(/=+$/, "").toUpperCase();
  if (normalized.length === 0 || !BASE32_PATTERN.test(normalized)) {
    throw new DomainError("value is not valid base32");
  }
  if (!CANONICAL_BASE32_REMAINDERS.has(normalized.length % 8)) {
    throw new DomainError("value is not canonical base32");
  }

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  // A non-zero trailing group is a non-canonical encoding of the same bytes.
  if (bits > 0 && (value & ((1 << bits) - 1)) !== 0) {
    throw new DomainError("value is not canonical base32");
  }

  return Uint8Array.from(bytes);
}

/** Generates a fresh base32 TOTP secret from the CSPRNG. */
export function generateTotpSecret(bytes = TOTP_SECRET_BYTES): string {
  if (!Number.isInteger(bytes) || bytes < 1) {
    throw new DomainError("TOTP secret length must be a positive integer");
  }
  return base32Encode(randomBytes(bytes));
}

/**
 * RFC 4226 HOTP with HMAC-SHA1 and dynamic truncation, returned as a 6-digit
 * string. `counter` is the RFC 6238 time step (`floor(unixSeconds / 30)`).
 */
export function totpCode(secret: string, counter: number): string {
  if (!Number.isInteger(counter) || counter < 0) {
    throw new DomainError("TOTP counter must be a non-negative integer");
  }

  const key = base32Decode(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const truncated = digest.readUInt32BE(offset) & 0x7fffffff;

  return (truncated % TOTP_MODULO).toString().padStart(TOTP_DIGITS, "0");
}

export interface VerifyTotpOptions {
  /** Verification instant; defaults to now. */
  readonly now?: Date;
  /** Accepted steps either side of the current one; defaults to 1. */
  readonly window?: number;
  /** Highest already-consumed counter for this secret; guards replay. */
  readonly lastUsedCounter?: number;
}

export type TotpVerificationResult =
  | { readonly valid: true; readonly counter: number }
  | {
      readonly valid: false;
      readonly reason: "format" | "mismatch" | "replayed" | "secret";
    };

/**
 * Verifies a 6-digit TOTP token against the secret, allowing `window` steps of
 * clock drift. A matched counter at or below `lastUsedCounter` is rejected as a
 * replay so a token cannot be used twice; the caller persists the returned
 * counter as the new `lastUsedCounter`.
 *
 * With the default `window` of 1 a token is accepted for up to ~90 seconds
 * around its step (the current step plus one either side) — the
 * OWASP-recommended clock-drift tradeoff. Replay protection is the persisted
 * `lastUsedCounter`, not the window width. A non-decodable stored secret is a
 * data fault and fails closed with `reason: "secret"` rather than throwing.
 */
export function verifyTotp(
  secret: string,
  token: string,
  options: VerifyTotpOptions = {},
): TotpVerificationResult {
  if (!TOKEN_PATTERN.test(token)) {
    return { valid: false, reason: "format" };
  }

  const window = options.window ?? 1;
  if (!Number.isInteger(window) || window < 0) {
    throw new DomainError("TOTP window must be a non-negative integer");
  }

  if (!isDecodableBase32(secret)) {
    return { valid: false, reason: "secret" };
  }

  const now = options.now ?? new Date();
  const currentCounter = Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);

  // A fresh match must win over a stale one, so the loop records a replay and
  // keeps scanning the window instead of returning on the first stale hit.
  let sawReplayed = false;
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = currentCounter + offset;
    if (candidate < 0) {
      continue;
    }

    if (!constantTimeEquals(totpCode(secret, candidate), token)) {
      continue;
    }

    if (options.lastUsedCounter !== undefined && candidate <= options.lastUsedCounter) {
      sawReplayed = true;
      continue;
    }
    return { valid: true, counter: candidate };
  }

  return sawReplayed ? { valid: false, reason: "replayed" } : { valid: false, reason: "mismatch" };
}

function isDecodableBase32(secret: string): boolean {
  try {
    base32Decode(secret);
    return true;
  } catch {
    return false;
  }
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}
