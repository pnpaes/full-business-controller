import { describe, expect, it } from "vitest";

import { DomainError } from "../errors";
import {
  AUTH_ERROR_PASSWORD_POLICY,
  MIN_PASSWORD_LENGTH,
  assertPasswordPolicy,
} from "./password-policy";

describe("assertPasswordPolicy", () => {
  it("accepts a password at the length floor with non-space content", () => {
    expect(() => assertPasswordPolicy("a".repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
  });

  it("rejects a password below the length floor", () => {
    expect(() => assertPasswordPolicy("a".repeat(MIN_PASSWORD_LENGTH - 1))).toThrow(DomainError);
  });

  it("rejects a whitespace-only password even at the length floor", () => {
    expect(() => assertPasswordPolicy(" ".repeat(MIN_PASSWORD_LENGTH))).toThrow(DomainError);
  });

  it("carries the single generic message, never the reason", () => {
    expect(() => assertPasswordPolicy("short")).toThrow(AUTH_ERROR_PASSWORD_POLICY);
  });
});
