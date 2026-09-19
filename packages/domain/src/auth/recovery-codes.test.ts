import { describe, expect, it } from "vitest";

import type { Argon2CostOptions } from "./argon2";
import { generateRecoveryCodes, hashRecoveryCodes, verifyRecoveryCode } from "./recovery-codes";

const CHEAP: Argon2CostOptions = { memoryCost: 8, timeCost: 1, parallelism: 1 };

describe("recovery codes", () => {
  it("generates the requested number of distinct grouped codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4})+$/);
    }
  });

  it("verifies a generated code and rejects a wrong one", async () => {
    const [code] = generateRecoveryCodes(1);
    if (code === undefined) {
      throw new Error("no recovery code generated");
    }
    const hashes = await hashRecoveryCodes([code], CHEAP);
    await expect(verifyRecoveryCode(hashes, code)).resolves.toBe(0);
    await expect(verifyRecoveryCode(hashes, "ZZZZ-ZZZZ-ZZZZ-ZZZZ")).resolves.toBeNull();
  });

  it("no longer verifies a code once its hash is removed", async () => {
    const codes = generateRecoveryCodes(3);
    const hashes = await hashRecoveryCodes(codes, CHEAP);
    const index = await verifyRecoveryCode(hashes, codes[1]!);
    expect(index).toBe(1);

    const remaining = hashes.filter((_, position) => position !== index);
    await expect(verifyRecoveryCode(remaining, codes[1]!)).resolves.toBeNull();
  });

  it("salts hashes and accepts the same code typed with different separators", async () => {
    const [code] = generateRecoveryCodes(1);
    if (code === undefined) {
      throw new Error("no recovery code generated");
    }

    const [first, second] = await hashRecoveryCodes([code, code], CHEAP);
    expect(first).not.toBe(second);
    await expect(verifyRecoveryCode([first!], code.toLowerCase().replace(/-/g, " "))).resolves.toBe(
      0,
    );
  });

  it("rejects an empty candidate", async () => {
    const [code] = generateRecoveryCodes(1);
    if (code === undefined) {
      throw new Error("no recovery code generated");
    }
    const hashes = await hashRecoveryCodes([code], CHEAP);
    await expect(verifyRecoveryCode(hashes, "   ")).resolves.toBeNull();
  });
});
