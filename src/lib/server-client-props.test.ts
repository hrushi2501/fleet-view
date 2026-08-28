/**
 * A server component may not hand a function to a client component.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS TEST IS STRUCTURAL RATHER THAN BEHAVIOURAL
 *
 * React has to serialise the props crossing that boundary. A closure has
 * nothing to serialise, so the request dies at render time with "Functions
 * cannot be passed directly to Client Components".
 *
 * The reason it needs a test is that nothing else catches it. A function is a
 * perfectly good value for `(v: number) => string`, so `tsc` is satisfied;
 * eslint has no opinion; and `next build` compiles it happily, because the
 * failure is a property of *rendering*, not of compiling. It only appears when
 * somebody loads the page.
 *
 * This is not hypothetical. Two props of exactly this shape —
 *
 *     <MultiBar  … format={(v) => inr(v, { compact: true })} />
 *     <TrendArea … format={(v) => `${num(v)} L`} />
 *
 * — shipped to production having passed type-check, lint and build, and took
 * the main dashboard down for every user until someone reported it. The prop
 * types are now serialisable tokens so the compiler rejects that particular
 * mistake, but the class of it is wider than one prop on one component, so it
 * is checked here over the whole source.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT COUNTS
 *
 * Only files that are actually server components: anything under `src/app`
 * without a "use client" directive. Passing a function *between* two client
 * components is ordinary React and is ignored, as are `action={…}` props, which
 * are how server actions are meant to travel.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(p) && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

const isClientModule = (file: string) => {
  try {
    return /^\s*["']use client["']/m.test(readFileSync(file, "utf8").slice(0, 400));
  } catch {
    return false;
  }
};

/** Resolves `@/components/charts` or `./Foo` to a file on disk. */
function resolveImport(spec: string, fromFile: string): string | null {
  const base = spec.startsWith("@/")
    ? join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(fromFile), spec)
      : null;
  if (!base) return null;
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    try {
      if (statSync(base + ext).isFile()) return base + ext;
    } catch { /* keep looking */ }
  }
  return null;
}

/** Component names this file imports from a "use client" module. */
function clientComponentsImportedBy(file: string, src: string): Set<string> {
  const names = new Set<string>();
  const importRe = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
  for (const m of src.matchAll(importRe)) {
    const target = resolveImport(m[2], file);
    if (!target || !isClientModule(target)) continue;
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/).pop()!.trim();
      // Components only — a lowercase export is a helper, not an element.
      if (/^[A-Z]/.test(name)) names.add(name);
    }
  }
  return names;
}

/**
 * `action` is excluded because a server action passed to a form is the
 * supported way across the boundary, not a mistake.
 */
const ALLOWED_FUNCTION_PROPS = new Set(["action"]);

type Finding = { file: string; component: string; prop: string };

/**
 * Every attribute block for `<Component …>` in `src`.
 *
 * Deliberately not a regular expression. The first attempt used
 * `<${component}\\b([^>]*?)/?>`, which looks right and is not: an arrow
 * function contains `>`, so the capture stopped at the `=>` of the very prop
 * being hunted, and the scan reported the codebase clean while the offending
 * line sat in it. A scanner that cannot see the thing it exists to find is
 * worse than none, because it is believed.
 *
 * So the tag is walked instead, tracking brace depth and quotes, and ends only
 * at a `>` that is genuinely outside any `{…}` expression.
 */
export function tagAttributes(src: string, component: string): string[] {
  const out: string[] = [];
  const open = new RegExp(`<${component}(?=[\\s/>])`, "g");

  for (const m of src.matchAll(open)) {
    let i = m.index! + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    const start = i;

    while (i < src.length) {
      const c = src[i];
      if (quote) {
        if (c === quote && src[i - 1] !== "\\") quote = null;
      } else if (c === '"' || c === "'" || c === "`") {
        quote = c;
      } else if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
      } else if (c === ">" && depth === 0) {
        out.push(src.slice(start, i));
        break;
      }
      i++;
    }
  }
  return out;
}

/** Props whose value is a function literal. */
export function functionProps(attrs: string): string[] {
  const re = /(\w+)=\{\s*(?:async\s*)?(?:\([^)]*\)\s*=>|function\b|[A-Za-z_$][\w$]*\s*=>)/g;
  return [...attrs.matchAll(re)].map((m) => m[1]).filter((p) => !ALLOWED_FUNCTION_PROPS.has(p));
}

function findingsIn(file: string): Finding[] {
  const src = readFileSync(file, "utf8");
  if (isClientModule(file)) return [];

  const clientComponents = clientComponentsImportedBy(file, src);
  if (clientComponents.size === 0) return [];

  const out: Finding[] = [];
  for (const component of clientComponents) {
    for (const attrs of tagAttributes(src, component)) {
      for (const prop of functionProps(attrs)) {
        out.push({ file: file.replace(process.cwd() + "/", ""), component, prop });
      }
    }
  }
  return out;
}

describe("server components do not pass functions to client components", () => {
  const files = walk(join(SRC, "app"));

  test("the scan finds files to check", () => {
    assert.ok(files.length > 20, `expected many .tsx files under src/app, found ${files.length}`);
  });

  test("no server component hands a closure across the boundary", () => {
    const findings = files.flatMap(findingsIn);
    const detail = findings
      .map((f) => `  ${f.file}\n    <${f.component} ${f.prop}={(…) => …}>`)
      .join("\n");
    assert.equal(
      findings.length,
      0,
      `A function prop cannot be serialised to a client component and will fail at\n` +
        `render time, not at build time. Pass a serialisable value instead — a named\n` +
        `format, an id, a plain object — and resolve it inside the client component.\n\n${detail}`
    );
  });

  test("the detector finds the exact line that broke the dashboard", () => {
    // Pinned against the real thing, through the real scanner. An earlier
    // version of this test ran a copy of the regex over a raw string, so it
    // passed while the scanner itself was blind — the failure it was written
    // to prevent went undetected twice.
    const sample =
      `return <MultiBar data={costByMonth} keys={heads} xKey="month" ` +
      `format={(v) => inr(v, { compact: true })} />;`;
    const attrs = tagAttributes(sample, "MultiBar");
    assert.equal(attrs.length, 1, "the opening tag was not located");
    assert.deepEqual(functionProps(attrs[0]), ["format"]);
  });

  test("a serialisable prop is not flagged", () => {
    const ok = `return <MultiBar data={costByMonth} keys={heads} format="inrCompact" />;`;
    assert.deepEqual(functionProps(tagAttributes(ok, "MultiBar")[0]), []);
  });

  test("a server action on a form is allowed through", () => {
    const form = `return <EntryForm action={saveThing} onDone={() => refresh()} />;`;
    assert.deepEqual(functionProps(tagAttributes(form, "EntryForm")[0]), ["onDone"]);
  });
});
