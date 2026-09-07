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
  // Must stay aligned with `src/lib/auth.ts`. Proxy runs in a separate,
  // edge-oriented bundle, so it cannot import the bcrypt/Prisma auth module.
  const sessionCookie = process.env.NODE_ENV === "production" ? "__Host-fv_session" : "fv_session";
  const session = req.cookies.get(sessionCookie)?.value;
  const { pathname } = req.nextUrl;

  // Only guard non-login routes. Whether a session is *valid* is decided by the
  // app layout / login page (which can read the DB). The proxy never redirects
  // /login, so a present-but-invalid cookie can't cause a redirect loop.
  if (!session && pathname !== "/login" && pathname !== "/install") {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  // A per-response nonce lets Next attach its framework scripts without
  // granting all injected inline script or eval permission. Development keeps
  // its tooling-compatible policy; production never emits unsafe-eval/inline.
  if (process.env.NODE_ENV !== "production") return NextResponse.next();
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Machine and API endpoints are excluded because a redirect to /login is a useless
  // answer to a device, an API client, or a cron runner. Each of them authenticates with a
  // session or shared secret in its own handler.
  //
  // `vehicles/` is excluded for a subtler reason. Next's image optimiser fetches
  // the underlying file over HTTP itself, and that internal request carries no
  // session cookie — so guarding the folder does not protect anything, it just
  // makes every optimised image 307 to /login for signed-in users too. The files
  // there are generic vehicle photography with nothing customer-specific in them.
  matcher: ["/((?!api/|api|.well-known|manifest.webmanifest|sw.js|icon.svg|icon-192.png|icon-512.png|_next/static|_next/image|favicon.ico|vehicles/).*)"],
};
