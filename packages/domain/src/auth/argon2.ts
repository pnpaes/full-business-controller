import { hash as argon2Hash, parseOptions, verify as argon2Verify } from "@node-rs/argon2";
import type { Algorithm, Options, Version } from "@node-rs/argon2";

import { DomainError } from "../errors";

/**
 * Argon2id is the only algorithm this module produces or accepts (ADR-0003,
 * "Password storage"). `Algorithm` is an ambient `const enum`, which cannot be
 * accessed under `isolatedModules`, so the numeric value is pinned here.
 */
const ARGON2ID: Algorithm = 2 as Algorithm;

/** PHC `v=19` (Argon2 version 0x13), the current normative version. */
const ARGON2_VERSION: Version = 1 as Version;

/** Only the cost knobs are injectable; the algorithm stays Argon2id. */
export type Argon2CostOptions = Partial<Pick<Options, "memoryCost" | "timeCost" | "parallelism">>;

type ResolvedArgon2Options = Required<
  Pick<Options, "memoryCost" | "timeCost" | "parallelism" | "algorithm">
>;

/**
 * OWASP-minimum Argon2id parameters (memory 19456 KiB, iterations 2, threads 1).
 *
 * ADR-0003 targets roughly 250 ms per hash on the target hardware; on the
 * developer machines these defaults land far below that, so the real policy may
 * be raised later. They are the tunable defaults: tests (and any future policy
 * bump) pass cheaper or stronger options explicitly, never a different
 * algorithm.
 */
export const DEFAULT_ARGON2_OPTIONS: Readonly<Required<Argon2CostOptions>> = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * A real Argon2id hash of a fixed, non-secret throwaway string, generated with
 * `DEFAULT_ARGON2_OPTIONS` (PHC: `$argon2id$v=19$m=19456,t=2,p=1$...`). It
 * exists only so the unknown-account login path pays the same verification cost
 * as a wrong password. The plaintext is deliberately not a usable password.
 */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$lsyg7PV41+MUEWbu/5G6Tg$qUqGPEE/rS6xmJlWoI+rxX0nV/1mmDtl40q1idQacxA";

function assertCostOption(name: keyof Argon2CostOptions, value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new DomainError(`argon2 ${name} must be a positive integer`);
  }
}

function resolveOptions(options?: Argon2CostOptions): ResolvedArgon2Options {
  const memoryCost = options?.memoryCost ?? DEFAULT_ARGON2_OPTIONS.memoryCost;
  const timeCost = options?.timeCost ?? DEFAULT_ARGON2_OPTIONS.timeCost;
  const parallelism = options?.parallelism ?? DEFAULT_ARGON2_OPTIONS.parallelism;

  assertCostOption("memoryCost", memoryCost);
  assertCostOption("timeCost", timeCost);
  assertCostOption("parallelism", parallelism);

  return { memoryCost, timeCost, parallelism, algorithm: ARGON2ID };
}

/**
 * Hashes a plaintext password with Argon2id and a per-hash random salt. Errors
 * never include the plaintext.
 */
export async function hashPassword(plain: string, options?: Argon2CostOptions): Promise<string> {
  return argon2Hash(plain, resolveOptions(options));
}

/**
 * Verifies a plaintext password against an encoded Argon2id hash. Returns
 * `false` for a wrong password or an unusable stored hash; never throws on
 * either (and never leaks the hash).
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2Verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Verifies against the supplied hash, or against a fixed dummy hash when the
 * account is unknown (`hash === null`). The dummy path has the same cost, so
 * response timing does not reveal account existence (ADR-0003, "Generic login
 * errors").
 *
 * The caller MUST always invoke this with `null` when the account is absent and
 * MUST NOT short-circuit on the user lookup (for example, returning the generic
 * error as soon as `findByEmail` yields nothing). The timing equalisation — and
 * therefore the generic-error guarantee against account enumeration — depends
 * on exactly one hash verification always running. Behaviour is unchanged.
 */
export async function verifyPasswordOrDummy(hash: string | null, plain: string): Promise<boolean> {
  return verifyPassword(hash ?? DUMMY_PASSWORD_HASH, plain);
}

/**
 * Returns `true` when an encoded hash was produced with weaker parameters than
 * the current policy (algorithm/version drift, or memory/time/threads below the
 * target), so login can rehash on success. An unparseable hash also reports
 * `true`, because it needs replacing.
 */
export function needsRehash(hash: string, options?: Argon2CostOptions): boolean {
  const target = resolveOptions(options);
  try {
    const parsed = parseOptions(hash);
    return (
      parsed.algorithm !== ARGON2ID ||
      parsed.version !== ARGON2_VERSION ||
      parsed.memoryCost < target.memoryCost ||
      parsed.timeCost < target.timeCost ||
      parsed.parallelism < target.parallelism
    );
  } catch {
    return true;
  }
}
