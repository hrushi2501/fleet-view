import { NextRequest, NextResponse } from "next/server";

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
  matcher: ["/((?!api/auth|api/health|api/telematics|api/push|api/assetlinks|.well-known|manifest.webmanifest|sw.js|icon.svg|icon-192.png|icon-512.png|_next/static|_next/image|favicon.ico).*)"],
};
