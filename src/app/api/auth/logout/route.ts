import { NextResponse } from "next/server";
import { clearSession, getSession } from "@/lib/auth";
import { auditAs } from "@/lib/audit";

/**
 * Sign out.
 *
 * Reads the session before clearing it so the event can name who left — the
 * audit screen renders a `LOGOUT` badge that nothing had ever written.
 */
export async function GET(req: Request) {
  const session = await getSession();
  await clearSession();

  if (session) {
    await auditAs({ id: session.id, name: session.name, role: session.role }, {
      action: "LOGOUT", module: "ADMIN", entity: "User", entityId: session.id,
      summary: `${session.name} signed out`,
    });
  }

  return NextResponse.redirect(new URL("/login", req.url));
}
