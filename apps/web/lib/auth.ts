import { createPostgresAuthStore, verifySession } from "@aquarela/application";
import type { AuthSessionRecord, AuthStore } from "@aquarela/application";

import { readSessionCookie } from "./cookies";
import { getDb } from "./db";
import { AuthHttpError } from "./errors";

/** Stateless adapter over the pooled client; built once per process. */
let store: AuthStore | undefined;

export function getAuthStore(): AuthStore {
  store ??= createPostgresAuthStore(getDb().db);
  return store;
}

export interface SessionContext {
  readonly session: AuthSessionRecord;
  readonly token: string;
}

/**
 * Resolves the presented session cookie to a live server-side session, or
 * `undefined`. Expiry and user status are enforced by the persistence query, so
 * a revoked or off-boarded session fails here even if the cookie is still sent.
 */
export async function getSession(request: Request): Promise<SessionContext | undefined> {
  const token = readSessionCookie(request);
  if (token === undefined) {
    return undefined;
  }
  const session = await verifySession(getAuthStore(), token);
  return session === undefined ? undefined : { session, token };
}

/** Like `getSession`, but throws a 401 `AuthHttpError` when unauthenticated. */
export async function requireSession(request: Request): Promise<SessionContext> {
  const context = await getSession(request);
  if (context === undefined) {
    throw new AuthHttpError(401);
  }
  return context;
}
