/**
 * Module resolution hook for `node --test`.
 *
 * The app's source uses extensionless relative imports (`./utils`,
 * `./business-time`) and the `@/…` path alias, both of which Next resolves at
 * build time. Node's own resolver does neither, so a test importing any module
 * that has dependencies would fail with ERR_MODULE_NOT_FOUND.
 *
 * The alternative was to rewrite every import in `src/lib` to carry an explicit
 * `.ts` extension. That is a large diff across files this work has no other
 * reason to touch, and it would make the source less conventional to read for
 * the sake of the test runner. A fifteen-line resolver is the smaller change.
 *
 * Registered by the `test` script in package.json via `--import`.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SRC = path.join(import.meta.dirname, "..", "src");
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];

/** First candidate that exists on disk: the file itself, then an index file. */
function firstExisting(base) {
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate)) return candidate;
  }
  for (const ext of EXTENSIONS) {
    const candidate = path.join(base, "index" + ext);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // `@/foo` is the project's alias for `src/foo`, per tsconfig paths.
  if (specifier.startsWith("@/")) {
    const resolved = firstExisting(path.join(SRC, specifier.slice(2)));
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }

  // Extensionless relative import — add whichever extension is actually there.
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !path.extname(specifier)) {
    const parent = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : SRC;
    const resolved = firstExisting(path.resolve(parent, specifier));
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
