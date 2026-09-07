/**
 * Shared rolling-window limiter for authenticated, expensive operations.
 *
 * The state is stored in `Setting`, rather than a process-local map, because
 * route handlers may run in multiple serverless instances. A local counter
 * would give every warm instance its own full allowance.
 */
import { db } from "@/lib/db";

type HeaderReader = Pick<Headers, "get">;

function asHeaderReader(value: unknown): HeaderReader | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { get?: unknown; headers?: unknown };

  // `ReadonlyHeaders` returned by Next's `headers()` has a direct `get()`
  // method, but it can also expose a `headers` member. Prefer the direct
  // reader: treating it as a Request selects that member instead and turns a
  // valid sign-in into `headers.get is not a function` before authentication.
  if (typeof candidate.get === "function") return candidate as HeaderReader;

  const nested = candidate.headers as { get?: unknown } | undefined;
  return typeof nested?.get === "function" ? nested as HeaderReader : null;
}

function readHeader(headers: HeaderReader, name: string): string | null {
  // Request metadata must never make authentication unavailable. Some Next
  // wrappers are lazy/proxied, so treat an unreadable forwarding header as
  // absent and use the shared, conservative `unknown` limiter bucket.
  try {
    return headers.get(name);
  } catch {
    return null;
  }
}

/**
 * Extracts client IP from Request or Headers safely.
 */
export function clientIp(req: Request | Headers): string {
  const headers = asHeaderReader(req);
  if (!headers) return "unknown";
  const fwd = readHeader(headers, "x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = readHeader(headers, "x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}

/**
 * Standard HTTP 429 Too Many Requests response with Retry-After header.
 */
export function rateLimitResponse(
  retryInSeconds: number,
  message: string = "Too many requests. Please slow down and try again.",
): Response {
  return Response.json(
    { error: message, retryInSeconds },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryInSeconds),
      },
    },
  );
}



type Window = { requests: number[] };

export type RateLimitVerdict =
  | { ok: true; remaining: number }
  | { ok: false; remaining: 0; retryInSeconds: number };

export type RateLimitInput = {
  /** Stable, internal operation name; do not put user-supplied text here. */
  scope: string;
  /** A stable authenticated principal id, normally `session.id`. */
  subject: string;
  limit: number;
  windowMs: number;
};

function keyFor({ scope, subject }: Pick<RateLimitInput, "scope" | "subject">): string {
  return `rate-limit:${scope}:${subject}`;
}

function timestamps(raw: string | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Window;
    return Array.isArray(parsed?.requests)
      ? parsed.requests.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      : [];
  } catch {
    // Corrupt limiter state must never make an endpoint permanently unusable.
    return [];
  }
}

/** Pure rolling-window decision, exported so the boundary arithmetic is testable. */
export function rateLimitDecision(
  previous: number[],
  { limit, windowMs }: Pick<RateLimitInput, "limit" | "windowMs">,
  now: number = Date.now(),
): { verdict: RateLimitVerdict; requests: number[] } {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Rate limit must be a positive integer.");
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error("Rate-limit window must be positive.");

  const requests = previous.filter((at) => at <= now && now - at < windowMs).sort((a, b) => a - b);
  if (requests.length >= limit) {
    const oldest = requests[0] ?? now;
    return {
      verdict: {
        ok: false,
        remaining: 0,
        retryInSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
      },
      requests,
    };
  }

  requests.push(now);
  return { verdict: { ok: true, remaining: limit - requests.length }, requests };
}

/**
 * Reserves a slot before an expensive provider call.
 *
 * Serializable transactions prevent concurrent requests for the same user
 * from all observing the same remaining slot. Prisma reports serialization
 * conflicts as P2034, so retrying is safe: the losing request rechecks the
 * just-written timestamp instead of overspending the limit.
 */
export async function reserveRateLimit(input: RateLimitInput): Promise<RateLimitVerdict> {
  const key = keyFor(input);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const row = await tx.setting.findUnique({ where: { key } });
        const decision = rateLimitDecision(timestamps(row?.value), input);
        if (!decision.verdict.ok) return decision.verdict;

        const value = JSON.stringify({ requests: decision.requests } satisfies Window);
        await tx.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
        return decision.verdict;
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      // Postgres asks the caller to retry a serializable transaction. Do not
      // retry arbitrary database errors, which could conceal an outage.
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2034") || attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("Unreachable rate-limit retry state.");
}
