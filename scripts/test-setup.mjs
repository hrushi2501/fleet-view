/**
 * Registers the TypeScript path/extension resolver for `node --test`.
 *
 * Resolution hooks run on a separate thread, so they cannot simply be imported
 * — they have to be registered with `module.register`. This file is the
 * `--import` entry point that does that; `ts-resolve.mjs` is the hook itself.
 */
import { register } from "node:module";

register("./ts-resolve.mjs", import.meta.url);
