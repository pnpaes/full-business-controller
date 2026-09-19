/**
 * Best-effort client address for per-IP rate limiting. Behind the DigitalOcean
 * App Platform proxy the first `x-forwarded-for` entry is the client; the header
 * is not authenticated, so this is used only as a throttle key, never as an
 * authorization input.
 */
export function clientIp(request: Request): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0) {
      return first;
    }
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp !== undefined && realIp.length > 0 ? realIp : undefined;
}
