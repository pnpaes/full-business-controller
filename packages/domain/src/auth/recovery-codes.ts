import { randomBytes } from "node:crypto";

import { DomainError } from "../errors";
import { hashPassword, verifyPassword } from "./argon2";
import type { Argon2CostOptions } from "./argon2";
import { base32Encode } from "./totp";

/** 80 bits of entropy per code, enough that brute force is hopeless. */
const RECOVERY_CODE_BYTES = 10;
const RECOVERY_CODE_GROUP = 4;
const DEFAULT_RECOVERY_CODE_COUNT = 10;

/**
 * Generates human-transcribable single-use recovery codes, grouped in fours
 * (e.g. `K7QF-2M9X-...`). Single use is enforced by the caller: after
 * `verifyRecoveryCode` returns an index, that hash is removed from
 * `user_totp.recovery_codes_hash`.
 */
export function generateRecoveryCodes(count = DEFAULT_RECOVERY_CODE_COUNT): string[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new DomainError("recovery code count must be a positive integer");
  }

  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(RECOVERY_CODE_BYTES));
    return raw.replace(new RegExp(`(.{${RECOVERY_CODE_GROUP}})(?=.)`, "g"), "$1-");
  });
}

/**
 * Argon2id-hashes every code for `user_totp.recovery_codes_hash text[]`.
 * Hashing strips grouping/separators, so a user may type a code with or without
 * hyphens or spaces.
 */
export async function hashRecoveryCodes(
  codes: readonly string[],
  options?: Argon2CostOptions,
): Promise<string[]> {
  return Promise.all(codes.map((code) => hashPassword(normalizeRecoveryCode(code), options)));
}

/**
 * Constant-shape lookup: returns the index of the matching hash or `null`.
 * Every hash is verified even after a match, so timing does not reveal the
 * code's position in the array.
 */
export async function verifyRecoveryCode(
  hashes: readonly string[],
  candidate: string,
): Promise<number | null> {
  const normalized = normalizeRecoveryCode(candidate);
  if (normalized.length === 0) {
    return null;
  }

  let matched: number | null = null;
  for (const [index, hash] of hashes.entries()) {
    const matches = await verifyPassword(hash, normalized);
    if (matches && matched === null) {
      matched = index;
    }
  }

  return matched;
}

function normalizeRecoveryCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}
