import { verifySession } from "@aquarela/application";
import type { AuthSessionRecord } from "@aquarela/application";
import { headers } from "next/headers";

import { getAuthStore } from "./auth";
import { SESSION_COOKIE_NAME, readCookie } from "./cookies";

/**
 * Resolves the session cookie to a live server-side session from a React Server
 * Component, where there is no `Request`. Expiry, revocation and user status are
 * enforced by `verifySession`'s persistence query, exactly as on the routes.
 */
export async function getServerSession(): Promise<AuthSessionRecord | undefined> {
  const headerList = await headers();
  const token = readCookie(headerList.get("cookie"), SESSION_COOKIE_NAME);
  if (token === undefined) {
    return undefined;
  }
  return verifySession(getAuthStore(), token);
}
