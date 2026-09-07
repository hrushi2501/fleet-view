import { NextResponse } from "next/server";
import { toUserFriendlyError, isNextNavigationError } from "./friendly-error";

/**
 * Standardized API route error response.
 * Translates errors into plain English, logs incidents on server, and returns
 * structured JSON with error reference code for customer support and debugging.
 */
export function apiErrorResponse(err: unknown, status = 500): NextResponse {
  if (isNextNavigationError(err)) throw err;
  const friendly = toUserFriendlyError(err);
  const httpStatus = friendly.isActionError && status === 500 ? 400 : status;

  return NextResponse.json(
    {
      ok: false,
      error: friendly.message,
      ref: friendly.ref,
    },
    { status: httpStatus }
  );
}

/** Preserve framework control flow and translate otherwise unhandled route failures. */
export function withApiErrors<A extends unknown[], R extends Response>(handler: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R | NextResponse> => {
    try { return await handler(...args); }
    catch (error) { return apiErrorResponse(error); }
  };
}
