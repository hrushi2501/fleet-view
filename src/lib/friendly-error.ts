/**
 * Central plain-English error translation and reporting engine.
 *
 * Converts technical database errors, network timeouts, and unhandled exceptions
 * into simple, jargon-free English for users, while generating incident tracking
 * codes (e.g. REF-A4B7C9) logged on the server for developers.
 */

export interface FriendlyErrorResult {
  message: string;
  ref: string;
  isActionError: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  code: "code",
  serialNo: "serial number",
  ticketNo: "ticket number",
  partNo: "part number",
  registrationNo: "vehicle registration number",
  email: "email address",
  username: "username",
  phone: "phone number",
  name: "name",
  woNo: "work order number",
  contractNo: "contract number",
  invoiceNo: "invoice number",
  endpoint: "push subscription",
};

/**
 * Checks if the given error is a Next.js framework internal navigation sentinel.
 * Next.js uses thrown errors with digests starting with NEXT_REDIRECT or NEXT_NOT_FOUND
 * to perform server-side redirects and 404 renders.
 */
export function isNextNavigationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const digest =
    "digest" in err && typeof (err as { digest?: unknown }).digest === "string"
      ? (err as { digest: string }).digest
      : "";
  return digest.startsWith("NEXT_REDIRECT;") || digest === "NEXT_NOT_FOUND" || /^NEXT_HTTP_ERROR_FALLBACK;(401|403|404)$/.test(digest);
}

/**
 * Generates a clean 6-character uppercase reference code for support tickets.
 */
export function generateIncidentRef(): string {
  return `REF-${crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`;
}

/**
 * Translates any error into a simple, jargon-free English message with an incident reference.
 */
export function toUserFriendlyError(err: unknown): FriendlyErrorResult {
  const ref = generateIncidentRef();

  // 1. Explicit ActionError (human-authored validation)
  if (
    err &&
    typeof err === "object" &&
    "name" in err &&
    (err as { name?: string }).name === "ActionError" &&
    "message" in err &&
    typeof (err as { message?: unknown }).message === "string"
  ) {
    return {
      message: (err as { message: string }).message,
      ref,
      isActionError: true,
    };
  }

  // 2. Prisma Client Known Request Errors
  const prismaCode =
    err && typeof err === "object" && "code" in err && typeof (err as { code?: unknown }).code === "string"
      ? (err as { code: string }).code
      : typeof (err as { message?: unknown })?.message === "string"
        ? (err as { message: string }).message.match(/\b(P[12]\d{3})\b/)?.[1]
        : undefined;

  if (prismaCode) {
    const meta =
      err && typeof err === "object" && "meta" in err && typeof (err as { meta?: unknown }).meta === "object"
        ? (err as { meta: Record<string, unknown> }).meta
        : undefined;

    console.error(`[ERP-DB-ERROR:${ref}] [Prisma ${prismaCode}]`, err);

    switch (prismaCode) {
      case "P2002": {
        // Unique constraint violation
        let fieldName = "record";
        if (meta && Array.isArray(meta.target) && meta.target.length > 0) {
          const raw = String(meta.target[0]);
          fieldName = FIELD_LABELS[raw] || "value";
        } else if (meta && typeof meta.target === "string") {
          const raw = meta.target;
          fieldName = FIELD_LABELS[raw] || "value";
        } else {
          const msg = typeof (err as { message?: unknown })?.message === "string" ? (err as { message: string }).message : "";
          for (const [key, label] of Object.entries(FIELD_LABELS)) {
            if (msg.includes(key)) {
              fieldName = label;
              break;
            }
          }
        }
        return {
          message: `A record with this ${fieldName} already exists. Please verify your input or use a different value.`,
          ref,
          isActionError: false,
        };
      }

      case "P2003": {
        // Foreign key constraint violation
        return {
          message:
            "Cannot complete this action because a linked item (such as a machine, site, or project) is either missing or referenced by other records.",
          ref,
          isActionError: false,
        };
      }

      case "P2025": {
        // Record not found
        return {
          message: "The requested record could not be found. It may have already been removed or updated by another user.",
          ref,
          isActionError: false,
        };
      }

      case "P2024":
      case "P1001":
      case "P1002": {
        // Connection or connection pool timeout
        return {
          message: "The database took too long to respond. Please check your network connection and try again in a few moments.",
          ref,
          isActionError: false,
        };
      }

      case "P2034": {
        // Transaction failed due to write conflict / deadlock
        return {
          message: "Another update was in progress at the same time. Please try saving your change again.",
          ref,
          isActionError: false,
        };
      }
    }
  }

  // 3. Network or system connection failures
  const rawMsg = err instanceof Error ? err.message : String(err);

  if (
    rawMsg.includes("fetch failed") ||
    rawMsg.includes("ECONNREFUSED") ||
    rawMsg.includes("ENOTFOUND") ||
    rawMsg.includes("ETIMEDOUT")
  ) {
    console.error(`[ERP-NETWORK-ERROR:${ref}]`, err);
    return {
      message: "Could not connect to the external service. Please check your internet connection and try again.",
      ref,
      isActionError: false,
    };
  }

  // 4. Rate-limiting
  if (rawMsg.toLowerCase().includes("rate limit") || rawMsg.includes("Too many")) {
    return {
      message: "Too many requests. Please wait a few moments before trying again.",
      ref,
      isActionError: false,
    };
  }

  // 5. Generic or unknown bug — log full stack with incident code for devs
  console.error(`[ERP-INCIDENT:${ref}]`, err);

  return {
    message: `Something unexpected happened while saving your change. Please try again. If it continues, quote reference ${ref} to the development team.`,
    ref,
    isActionError: false,
  };
}
