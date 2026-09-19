import type { RequestContext } from "@aquarela/application";

import { clientIp } from "./client-ip";

/**
 * Audit/request metadata for the auth commands. The IP is the throttle key and
 * the user agent is stored on the session row; neither is a credential and
 * neither is echoed back to the client.
 */
export function requestContext(request: Request): RequestContext {
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent");
  const requestId = request.headers.get("x-request-id");
  return {
    ...(ip === undefined ? {} : { ip }),
    ...(userAgent === null ? {} : { userAgent }),
    ...(requestId === null ? {} : { requestId }),
  };
}
