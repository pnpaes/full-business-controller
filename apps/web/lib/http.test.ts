import { AUTH_ERROR_GENERIC, DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { AuthHttpError } from "./errors";
import { jsonError, mapErrors } from "./http";

describe("jsonError", () => {
  it("defaults to the generic auth message", async () => {
    const response = jsonError(401);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: AUTH_ERROR_GENERIC });
  });

  it("returns the supplied message", async () => {
    const response = jsonError(400, "x");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "x" });
  });
});

describe("mapErrors", () => {
  it("maps a DomainError to 400 with its own message", async () => {
    const response = await mapErrors(async () => {
      throw new DomainError("duplicate import hash");
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "duplicate import hash" });
  });

  it("maps an AuthHttpError to its status with the generic message", async () => {
    const response = await mapErrors(async () => {
      throw new AuthHttpError(401);
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: AUTH_ERROR_GENERIC });
  });

  it("maps an unknown error to 500 with the generic message", async () => {
    const response = await mapErrors(async () => {
      throw new Error("driver failure with parameters");
    });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: AUTH_ERROR_GENERIC });
  });
});
