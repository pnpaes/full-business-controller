import { describe, expect, it } from "vitest";

import { DomainError } from "../errors";
import { DEFAULT_LOCKOUT_POLICY, computeLockout, isLocked } from "./lockout";
import type { LockoutPolicy } from "./lockout";

const NOW = new Date("2026-09-19T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const lockedFor = (failedLoginCount: number): Date | null =>
  computeLockout(failedLoginCount, NOW).lockedUntil;

describe("computeLockout", () => {
  it("returns no lock below the first threshold", () => {
    expect(lockedFor(0)).toBeNull();
    expect(lockedFor(4)).toBeNull();
  });

  it("applies the exact window at each threshold", () => {
    const expected: ReadonlyArray<readonly [number, number]> = [
      [5, 1 * MINUTE],
      [6, 5 * MINUTE],
      [7, 15 * MINUTE],
      [8, 60 * MINUTE],
    ];

    for (const [failures, lockMs] of expected) {
      expect(lockedFor(failures)?.getTime()).toBe(NOW.getTime() + lockMs);
    }
  });

  it("escalates one failure past the last rung straight to the cap", () => {
    expect(lockedFor(9)?.getTime()).toBe(NOW.getTime() + 24 * HOUR);
  });

  it("caps a far-above-threshold count at the 24 h maximum", () => {
    const lockedUntil = lockedFor(100);
    expect(lockedUntil?.getTime()).toBe(NOW.getTime() + 24 * HOUR);
    expect(lockedUntil?.getTime()).toBe(NOW.getTime() + DEFAULT_LOCKOUT_POLICY.maxLockMs);
  });

  it("accepts an overriding policy per call", () => {
    const policy: LockoutPolicy = {
      thresholds: [
        { afterFailures: 2, lockMs: 10_000 },
        { afterFailures: 3, lockMs: 3 * HOUR },
      ],
      maxLockMs: 30 * MINUTE,
    };

    expect(computeLockout(1, NOW, policy).lockedUntil).toBeNull();
    expect(computeLockout(2, NOW, policy).lockedUntil?.getTime()).toBe(NOW.getTime() + 10_000);
    expect(computeLockout(5, NOW, policy).lockedUntil?.getTime()).toBe(NOW.getTime() + 30 * MINUTE);
  });

  it("throws a DomainError for non-integer or negative counts", () => {
    for (const count of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => computeLockout(count, NOW)).toThrow(DomainError);
    }
  });
});

describe("isLocked", () => {
  it("is true only while the expiry is in the future", () => {
    expect(isLocked(new Date(NOW.getTime() + 1), NOW)).toBe(true);
    expect(isLocked(new Date(NOW.getTime() - 1), NOW)).toBe(false);
  });

  it("treats the exact boundary and no lock as unlocked", () => {
    expect(isLocked(new Date(NOW.getTime()), NOW)).toBe(false);
    expect(isLocked(null, NOW)).toBe(false);
  });
});
