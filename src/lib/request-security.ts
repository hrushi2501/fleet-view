import { ActionError } from "@/lib/action-error";

/**
 * Cookie-authenticated route mutations must originate from this application.
 * Server Actions have their own Next.js same-origin protection; this covers
 * JSON/multipart API routes, where SameSite=Lax alone still permits some
 * cross-site navigations. Webhooks and cron handlers authenticate separately
 * and must not call this helper.
 */
export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  if (!origin || origin !== expected) {
    throw new ActionError("Cross-site request blocked. Please reload the application and try again.");
  }
}

/** Only application-owned private-blob proxy links may be stored as evidence. */
export function isPrivateFileReference(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4_096) return false;
  try {
    const url = new URL(value, "https://fleetview.invalid");
    if (url.origin !== "https://fleetview.invalid" || url.pathname !== "/api/files") return false;
    const blob = url.searchParams.get("blob");
    if (!blob) return false;
    const target = new URL(blob);
    return target.protocol === "https:" && target.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/** App navigation supplied to browser push APIs must never become an external URL. */
export function isSafeAppPath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 2_048 && /^\/(?!\/)/.test(value) && !/[\r\n]/.test(value);
}
