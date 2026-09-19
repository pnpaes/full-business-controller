import { describe, expect, it } from "vitest";

import { DomainError } from "../errors";
import { base32Decode, base32Encode, generateTotpSecret, totpCode, verifyTotp } from "./totp";

/** RFC 6238 Appendix B SHA-1 secret ("12345678901234567890") in base32. */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const at = (seconds: number): Date => new Date(seconds * 1000);

describe("base32", () => {
  it("round-trips bytes", () => {
    const bytes = Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it("tolerates spaces, lowercase and missing padding", () => {
    const bytes = Uint8Array.from([0x66, 0x6f, 0x6f]);
    const encoded = base32Encode(bytes);
    expect(base32Decode(encoded)).toEqual(bytes);
    expect(base32Decode(`${encoded}===`)).toEqual(bytes);
    expect(base32Decode(`  ${encoded.toLowerCase()}  `)).toEqual(bytes);
  });

  it("rejects invalid characters and empty input", () => {
    expect(() => base32Decode("GEZDGNBV1!")).toThrow(DomainError);
    expect(() => base32Decode("")).toThrow(DomainError);
  });

  it("rejects non-canonical lengths and trailing bits", () => {
    expect(() => base32Decode("A")).toThrow(DomainError);
    expect(() => base32Decode("AB")).toThrow(DomainError);
    expect(base32Decode("AA")).toEqual(Uint8Array.from([0]));
  });
});

describe("generateTotpSecret", () => {
  it("generates a 160-bit base32 secret by default", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it("rejects a non-positive byte length", () => {
    expect(() => generateTotpSecret(0)).toThrow(DomainError);
  });
});

describe("totpCode (RFC 6238 SHA-1 vectors)", () => {
  // [counter, unix time, RFC 6238 Appendix B 8-digit expected value]
  const VECTORS: ReadonlyArray<readonly [number, number, string]> = [
    [1, 59, "94287082"],
    [37037036, 1111111109, "07081804"],
    [37037037, 1111111111, "14050471"],
    [41152263, 1234567890, "89005924"],
    [66666666, 2000000000, "69279037"],
    [666666666, 20000000000, "65353130"],
  ];

  it("matches the RFC vectors' last six digits at each time step", () => {
    for (const [counter, , expected] of VECTORS) {
      expect(totpCode(RFC_SECRET, counter)).toBe(expected.slice(-6));
    }
  });

  it("matches the RFC 4226 HOTP counters", () => {
    expect(totpCode(RFC_SECRET, 0)).toBe("755224");
    expect(totpCode(RFC_SECRET, 1)).toBe("287082");
  });
});

describe("verifyTotp", () => {
  it("accepts the current step", () => {
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, 1), { now: at(59) })).toEqual({
      valid: true,
      counter: 1,
    });
  });

  it("accepts one step either side with the default window", () => {
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, 0), { now: at(59) })).toEqual({
      valid: true,
      counter: 0,
    });
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, 2), { now: at(59) })).toEqual({
      valid: true,
      counter: 2,
    });
  });

  it("rejects steps two away with the default window", () => {
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, 3), { now: at(59) })).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("rejects a replayed counter at or below lastUsedCounter", () => {
    expect(
      verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, 1), { now: at(59), lastUsedCounter: 1 }),
    ).toEqual({ valid: false, reason: "replayed" });
  });

  it("rejects a wrong digit as a mismatch", () => {
    expect(verifyTotp(RFC_SECRET, "287083", { now: at(59) })).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("fails closed for an invalid base32 secret instead of throwing", () => {
    expect(verifyTotp("not base32!", "123456", { now: at(59) })).toEqual({
      valid: false,
      reason: "secret",
    });
  });

  it("accepts only the current step when the window is zero", () => {
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, 1), { now: at(59), window: 0 })).toEqual({
      valid: true,
      counter: 1,
    });
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, 2), { now: at(59), window: 0 })).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("rejects wrong-length and non-digit tokens as format errors", () => {
    for (const token of ["12345", "1234567", "abcdef", "12 456", ""]) {
      expect(verifyTotp(RFC_SECRET, token, { now: at(59) })).toEqual({
        valid: false,
        reason: "format",
      });
    }
  });
});
