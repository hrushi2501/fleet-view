/**
 * Stand-in for `next/navigation` under `node --test`.
 *
 * `access.ts` imports `redirect` so its page guards can send an unauthorised
 * caller somewhere sensible. That import is unresolvable outside the Next
 * runtime, which would otherwise make the pure decision logic in the same file
 * — role banding, query scoping — untestable.
 *
 * `redirect` throws here for the same reason it throws in Next: it is control
 * flow, not a return value, so a test that reaches it must not fall through.
 */
export function redirect(url) {
  const e = new Error(`REDIRECT:${url}`);
  e.digest = `NEXT_REDIRECT;replace;${url};307;`;
  throw e;
}
export function notFound() {
  const error = new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  error.digest = "NEXT_HTTP_ERROR_FALLBACK;404";
  throw error;
}
export function usePathname() { return "/"; }
export function useRouter() { return { push() {}, replace() {}, refresh() {} }; }
export function useSearchParams() { return new URLSearchParams(); }
