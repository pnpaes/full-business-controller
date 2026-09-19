import { hash as argon2Hash } from "@node-rs/argon2";
import type { Algorithm, Version } from "@node-rs/argon2";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ARGON2_OPTIONS,
  hashPassword,
  needsRehash,
  verifyPassword,
  verifyPasswordOrDummy,
} from "./argon2";
import type { Argon2CostOptions } from "./argon2";

const CHEAP: Argon2CostOptions = { memoryCost: 8, timeCost: 1, parallelism: 1 };

describe("argon2", () => {
  it("hashes with Argon2id and verifies the plaintext", async () => {
    const hash = await hashPassword("correct horse battery staple", CHEAP);
    expect(hash.startsWith("$argon2id$")).toBe(true);
    await expect(verifyPassword(hash, "correct horse battery staple")).resolves.toBe(true);
  });

  it("rejects a wrong password and salts every hash", async () => {
    const first = await hashPassword("same-password", CHEAP);
    const second = await hashPassword("same-password", CHEAP);
    expect(first).not.toBe(second);
    await expect(verifyPassword(first, "not-the-password")).resolves.toBe(false);
  });

  it("returns false for an unusable stored hash without throwing", async () => {
    await expect(verifyPassword("not-a-hash", "whatever")).resolves.toBe(false);
  });

  it("runs the dummy comparison on the unknown-account path", async () => {
    await expect(verifyPasswordOrDummy(null, "whatever")).resolves.toBe(false);
    const hash = await hashPassword("real", CHEAP);
    await expect(verifyPasswordOrDummy(hash, "real")).resolves.toBe(true);
  });

  it("flags hashes below the current defaults for rehash", async () => {
    const cheap = await hashPassword("password", CHEAP);
    expect(needsRehash(cheap, DEFAULT_ARGON2_OPTIONS)).toBe(true);
    expect(needsRehash(cheap, CHEAP)).toBe(false);
    expect(needsRehash("not-a-hash", CHEAP)).toBe(true);
  });

  it("does not flag hashes produced at the current defaults", async () => {
    const hash = await hashPassword("password", DEFAULT_ARGON2_OPTIONS);
    expect(needsRehash(hash, DEFAULT_ARGON2_OPTIONS)).toBe(false);
  });

  it("flags a non-Argon2id algorithm for rehash", async () => {
    const argon2i = await argon2Hash("password", {
      memoryCost: 8,
      timeCost: 1,
      parallelism: 1,
      algorithm: 1 as Algorithm,
    });
    expect(argon2i.startsWith("$argon2i$")).toBe(true);
    expect(needsRehash(argon2i, CHEAP)).toBe(true);
  });

  it("flags an older Argon2 version for rehash", async () => {
    const argon2V16 = await argon2Hash("password", {
      memoryCost: 8,
      timeCost: 1,
      parallelism: 1,
      version: 0 as Version,
    });
    expect(argon2V16.startsWith("$argon2id$v=16$")).toBe(true);
    expect(needsRehash(argon2V16, CHEAP)).toBe(true);
  });
});
