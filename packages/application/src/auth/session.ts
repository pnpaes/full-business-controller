import { generateSessionToken, hashSessionToken } from "@aquarela/domain";

import { AUTH_AUDIT_ACTIONS } from "./actions";
import { audit } from "./audit";
import type {
  AuthDeps,
  AuthSessionRecord,
  AuthStore,
  AuthUser,
  IssuedSession,
  RequestContext,
} from "./types";

/**
 * Mints an opaque session token and stores only its hash
 * (`auth_session.token_hash`). The plaintext token is returned to the caller for
 * delivery to the client and is never persisted or logged.
 */
export async function issueSession(
  store: AuthStore,
  deps: AuthDeps,
  user: AuthUser,
  now: Date,
  request?: RequestContext,
): Promise<IssuedSession> {
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + deps.sessionTtlMinutes * 60_000);
  const created = await store.createSession({
    userId: user.id,
    tokenHash: hashSessionToken(token),
    expiresAt,
    ...(request?.userAgent !== undefined ? { userAgent: request.userAgent } : {}),
    ...(request?.ip !== undefined ? { ip: request.ip } : {}),
  });
  return { token, sessionId: created.id, expiresAt };
}

/** Resolves a presented token to a live session, or `undefined`. */
export async function verifySession(
  store: AuthStore,
  token: string,
  now = new Date(),
): Promise<AuthSessionRecord | undefined> {
  if (token.length === 0) {
    return undefined;
  }
  return store.findActiveSessionByTokenHash(hashSessionToken(token), now);
}

export interface LogoutInput {
  readonly organizationId: string;
  readonly sessionId: string;
  readonly actorId: string | null;
}

/** Revokes one session and audits it. */
export async function logout(
  store: AuthStore,
  input: LogoutInput,
  now = new Date(),
): Promise<void> {
  await store.revokeSession(input.sessionId, now);
  await audit(store, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: AUTH_AUDIT_ACTIONS.sessionRevoked,
    entityType: "auth_session",
    entityId: input.sessionId,
  });
}

export interface LogoutAllInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly actorId: string | null;
  readonly reason?: string;
}

/**
 * Revokes every active session for a user (logout-all, role change,
 * off-boarding) and audits the count. A caller changing a role or status must do
 * so in the same transaction, and session validation already rejects
 * non-`active` users, so a concurrently created session cannot survive.
 */
export async function logoutAll(
  store: AuthStore,
  input: LogoutAllInput,
  now = new Date(),
): Promise<number> {
  const revoked = await store.revokeAllSessionsForUser(input.userId, now);
  await audit(store, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: AUTH_AUDIT_ACTIONS.sessionsRevokedAll,
    entityId: input.userId,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  });
  return revoked;
}
