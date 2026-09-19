import { requireSession } from "../../../../../lib/auth";
import { mapErrors, jsonOk } from "../../../../../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns the live session's expiry, or the generic 401 when unauthenticated. */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const { session } = await requireSession(request);
    return jsonOk({ expiresAt: session.expiresAt.toISOString() });
  });
}
