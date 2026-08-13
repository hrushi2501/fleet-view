/** Stand-in for `next/headers` under `node --test`. See next-navigation.mjs. */
export async function cookies() {
  return { get: () => undefined, set() {}, delete() {} };
}
export async function headers() { return new Map(); }
