import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { DomainError } from "../errors";
import { openSecret, parseSecretKey, sealSecret } from "./secret-box";

const KEY = randomBytes(32);
const OTHER_KEY = randomBytes(32);
const PLAINTEXT = "JBSWY3DPEHPK3PXP";

const flipByte = (part: string): string => {
  const bytes = Buffer.from(part, "base64url");
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  return bytes.toString("base64url");
};

describe("parseSecretKey", () => {
  it("accepts a base64 key of exactly 32 bytes", () => {
    const key = randomBytes(32).toString("base64");
    expect(parseSecretKey(key)).toHaveLength(32);
    expect(Buffer.from(parseSecretKey(key))).toEqual(Buffer.from(key, "base64"));
  });

  it("rejects a key that does not decode to 32 bytes", () => {
    for (const bytes of [0, 16, 31, 33]) {
      const key = Buffer.alloc(bytes).toString("base64");
      expect(() => parseSecretKey(key), `${bytes} bytes`).toThrow(DomainError);
    }
  });
});

describe("secret sealing", () => {
  it("round-trips plaintext through seal and open", () => {
    const sealed = sealSecret(PLAINTEXT, KEY);
    expect(openSecret(sealed, KEY)).toBe(PLAINTEXT);
  });

  it("produces a self-describing v1 string with four parts", () => {
    const parts = sealSecret(PLAINTEXT, KEY).split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    expect(Buffer.from(parts[1] ?? "", "base64url")).toHaveLength(12);
    expect(Buffer.from(parts[3] ?? "", "base64url")).toHaveLength(16);
  });

  it("uses a random IV, so the same plaintext seals differently each time", () => {
    const first = sealSecret(PLAINTEXT, KEY);
    const second = sealSecret(PLAINTEXT, KEY);
    expect(first).not.toBe(second);
    expect(openSecret(first, KEY)).toBe(PLAINTEXT);
    expect(openSecret(second, KEY)).toBe(PLAINTEXT);
  });

  it("rejects the wrong key", () => {
    const sealed = sealSecret(PLAINTEXT, KEY);
    expect(() => openSecret(sealed, OTHER_KEY)).toThrow(DomainError);
  });

  it("rejects a key of the wrong length", () => {
    const shortKey = randomBytes(16);
    expect(() => sealSecret(PLAINTEXT, shortKey)).toThrow(DomainError);
    expect(() => openSecret(sealSecret(PLAINTEXT, KEY), shortKey)).toThrow(DomainError);
  });

  it("rejects a flipped byte in the ciphertext or the tag", () => {
    for (const index of [1, 2, 3]) {
      const parts = sealSecret(PLAINTEXT, KEY).split(".");
      const part = parts[index];
      if (part === undefined) {
        throw new Error("unreachable: sealed secret always has four parts");
      }
      parts[index] = flipByte(part);
      expect(() => openSecret(parts.join("."), KEY), `part ${index}`).toThrow(DomainError);
    }
  });

  it("rejects malformed input without returning partial plaintext", () => {
    const malformed = [
      "",
      "v1",
      "v1.a.b",
      "v1..",
      "v1.!!!.AAAA.AAAA",
      `v2.${"A".repeat(16)}.AAAA.${"A".repeat(22)}`,
    ];
    for (const value of malformed) {
      expect(() => openSecret(value, KEY), value).toThrow(DomainError);
    }
  });
});
