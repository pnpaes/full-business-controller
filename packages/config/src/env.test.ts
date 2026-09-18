import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "./env";

describe("loadConfig", () => {
  it("applies defaults and parses typed values", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://user:pass@localhost:5432/aquarela",
    });

    expect(config.NODE_ENV).toBe("test");
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.PORT).toBe(3000);
  });

  it("rejects invalid configuration without echoing the value", () => {
    const secret = "super-secret-password";
    let error: unknown;

    try {
      loadConfig({ DATABASE_URL: `not-a-url-${secret}` });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).not.toContain(secret);
  });
});
