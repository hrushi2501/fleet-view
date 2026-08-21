/**
 * The shape a wrapped server action hands back, and the guard that narrows it.
 *
 * Deliberately its own module with **no imports**. Client components need
 * `isActionError` to tell a refusal from a result, and importing it from
 * `guard.ts` would drag `access.ts` → `auth.ts` → `next/headers` into the
 * browser bundle. Turbopack rejects that outright, which is the correct
 * behaviour — server-only code has no business being shipped to a client.
 *
 * Keeping the narrowing here means the same helper is usable on both sides of
 * the boundary without either side importing the other's dependencies.
 */

/** Returned instead of throwing, so the message survives a production build. */
export type ActionFailure = { error: string };

/** `undefined` means the action succeeded and had nothing to report. */
export type ActionResult = ActionFailure | undefined;

/**
 * Narrows a wrapped action's result to the failure case.
 *
 * Written as a type predicate so a caller that checks it gets the success type
 * on the other branch, and TypeScript refuses to let a refusal be read as data.
 */
export function isActionError(r: unknown): r is ActionFailure {
  return (
    !!r &&
    typeof r === "object" &&
    "error" in r &&
    typeof (r as { error: unknown }).error === "string"
  );
}
