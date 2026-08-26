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
