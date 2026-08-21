/**
 * Every server action must check authorisation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS TEST IS STRUCTURAL RATHER THAN BEHAVIOURAL
 *
 * A Next.js server action is a POST endpoint. It is reachable by anyone who can
 * reach the app, whether or not the page holding its button was ever rendered
 * for them. Guarding the page does nothing for the action.
 *
 * This codebase had roughly a hundred and thirty exported actions and two
 * authorisation checks between them, both comparing the legacy role string to
 * `"Admin"` rather than reading a permission. `deleteUser` had none, so a
 * driver's session could delete user accounts.
 *
 * The failure mode is silent — a new action ships, works perfectly for the
 * person who wrote it, and is quietly open to everybody. Nothing about running
 * the app reveals it. So the check is a lint over the source: add an exported
 * action without a guard and this test names the file and the function.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

/**
 * Guard calls that count as authorising a mutation.
 *
 * `transition(` is on this list because it is not a bare update: it resolves
 * the workflow, looks up the permission that specific move requires, and calls
 * `requireAction` / `requireApproval` itself. An action whose only job is to
 * move a record's stage is fully authorised by delegating to it — and the
 * permission it applies is per-transition, which is stricter than a single
 * check at the top of the function could be.
 */
const GUARDS = [
  "requireAction(",
  "requireApproval(",
  "requireUser(",
  "requirePermission(",
  "requirePage(",
  "requireApi(",
  "requireAdminPage(",
  "transition(",
];

/**
 * Actions that are deliberately reachable without a session.
 *
 * `login` is the door itself — it cannot require the thing it issues. It
 * carries its own protection (throttling, generic failure text, audit) tested
 * separately.
 */
const UNAUTHENTICATED = new Set(["src/app/login/actions.ts::login"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Files that declare themselves server-action modules. */
function actionModules(): { path: string; rel: string; source: string }[] {
  return walk(SRC)
    .map((path) => ({ path, rel: path.slice(process.cwd().length + 1), source: readFileSync(path, "utf8") }))
    .filter((f) => /^\s*["']use server["']/m.test(f.source))
    // Test files and library helpers only mention the directive in prose.
    .filter((f) => !f.rel.includes(".test.") && f.source.trimStart().startsWith('"use server"'));
}

/**
 * The body of an exported action, from its signature to the next top-level
 * export. Good enough to tell whether a guard is called inside it.
 */
function actionBodies(source: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  // Two shapes are in use, and the pattern must match both without dragging in
  // private helpers. `export async function name(` is a plain action.
  // `async function name__impl(` is an implementation wrapped by `safe()` and
  // exported beneath it — the guard still has to sit inside the implementation.
  //
  // A bare `async function name(` is NOT matched on purpose: those are module
  // helpers like `uploadPhoto`, which are not reachable endpoints and have
  // nothing to authorise.
  const re = /(?:export async function ([a-zA-Z0-9_]+)|async function ([a-zA-Z0-9_]+__impl))\s*\(/g;
  const starts: { name: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) starts.push({ name: (m[1] ?? m[2])!, at: m.index });

  for (let i = 0; i < starts.length; i++) {
    const from = starts[i]!.at;
    const to = i + 1 < starts.length ? starts[i + 1]!.at : source.length;
    out.push({ name: starts[i]!.name, body: source.slice(from, to) });
  }
  return out;
}

describe("every server action authorises the caller", () => {
  const modules = actionModules();

  test("the scan finds the action modules it is meant to cover", () => {
    // Guards against the walk silently matching nothing and the suite passing
    // vacuously — the exact way a test like this rots.
    assert.ok(modules.length >= 15, `expected 15+ action modules, found ${modules.length}`);
  });

  for (const mod of modules) {
    for (const { name, body } of actionBodies(mod.source)) {
      const id = `${mod.rel}::${name}`;
      if (UNAUTHENTICATED.has(id)) continue;

      test(id, () => {
        const guarded = GUARDS.some((g) => body.includes(g));
        assert.ok(
          guarded,
          `${id} is an exported server action with no authorisation check.\n` +
            `It is a POST endpoint, so anyone who can reach the app can call it.\n` +
            `Add 'await requireAction("<permission>")' as its first statement.`,
        );
      });
    }
  }
});
