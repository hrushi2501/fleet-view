import { NextRequest, NextResponse } from "next/server";

/**
 * First pass only. The proxy sees the cookie but not the database, so it can
 * tell that *a* session cookie was sent and nothing more — any string gets past
 * it. Every route still has to authenticate for itself: the app layout and the
 * login page resolve the cookie against the DB, and each API route calls
 * `getSession` / `requirePermission` or checks a shared ingest secret.
 *
 * Treat this as a redirect for humans, not as an access control.
 */
export function proxy(req: NextRequest) {
  const session = req.cookies.get("fv_session")?.value;
  const { pathname } = req.nextUrl;

  // Only guard non-login routes. Whether a session is *valid* is decided by the
  // app layout / login page (which can read the DB). The proxy never redirects
  // /login, so a present-but-invalid cookie can't cause a redirect loop.
  if (!session && pathname !== "/login" && pathname !== "/install") {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  // Machine endpoints are excluded because a redirect to /login is a useless
  // answer to a device or a cron runner. Each of them authenticates with a
  // shared secret in its own handler: api/telematics and api/fuel/telemetry on
  // FLEET_INGEST_KEY, api/push/cron on CRON_SECRET.
  matcher: ["/((?!api/auth|api/health|api/telematics|api/fuel/telemetry|api/push|api/assetlinks|.well-known|manifest.webmanifest|sw.js|icon.svg|icon-192.png|icon-512.png|_next/static|_next/image|favicon.ico).*)"],
};
