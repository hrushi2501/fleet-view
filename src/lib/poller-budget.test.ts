/**
 * One scheduled poller, at or under Fleet Edge's rate limit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A TEST AND NOT A COMMENT
 *
 * Fleet Edge allows 60 API calls an hour for the whole subscription. Three
 * separate pollers had accumulated here, each added at a different time for a
 * good reason, none aware of the others:
 *
 *   instrumentation.ts   setInterval, 60s   = 60/hour, per serverless instance
 *   vercel.json cron     every 2 minutes    = 30/hour
 *   telematics-worker    60s daemon         = 60/hour when running
 *
 * The first two alone were 90/hour against a limit of 60. Each worked correctly
 * in isolation, which is exactly why nobody noticed — and because the Basic Pull
 * API is a snapshot with no history endpoint, every refused call was a moment
 * that could never be fetched again.
 *
 * That failure is invisible at runtime: the app keeps working, the dashboard
 * keeps rendering, and the data quietly develops holes. So the budget is
 * asserted here, where adding a fourth poller fails the build instead of
 * degrading the fuel figures.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Fleet Edge's documented ceiling for the whole subscription. */
const CALLS_PER_HOUR_LIMIT = 60;

const root = process.cwd();
const vercelConfig = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
  crons?: { path: string; schedule: string }[];
};

/** Removes block and line comments so assertions read code rather than prose. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Calls per hour implied by the subset of cron syntax used here. */
function callsPerHour(schedule: string): number {
  const [minute] = schedule.trim().split(/\s+/);
  if (minute === "*") return 60;
  const every = minute?.match(/^\*\/(\d+)$/);
  if (every) return Math.floor(60 / Number(every[1]));
  // A fixed minute, e.g. "0 3 * * *" — once an hour at most, and this one is daily.
  return 1;
}

const fleetEdgeCrons = (vercelConfig.crons ?? []).filter((c) =>
  /telematics|fuel\/sync/.test(c.path),
);

describe("exactly one scheduled poller hits Fleet Edge", () => {
  test("only one cron entry polls the provider", () => {
    assert.equal(
      fleetEdgeCrons.length,
      1,
      `expected 1 Fleet Edge cron, found ${fleetEdgeCrons.length}: ` +
        fleetEdgeCrons.map((c) => `${c.path} @ ${c.schedule}`).join(", "),
    );
  });

  test("its rate is within the subscription limit", () => {
    const rate = callsPerHour(fleetEdgeCrons[0]!.schedule);
    assert.ok(
      rate <= CALLS_PER_HOUR_LIMIT,
      `${fleetEdgeCrons[0]!.schedule} is ${rate} calls/hour, over the ${CALLS_PER_HOUR_LIMIT} limit`,
    );
  });

  test("the in-app timer does not start unless explicitly asked for", () => {
    // Comments are stripped first. The file *documents* the old production
    // condition in order to explain why it was wrong, and an assertion that
    // matched prose would fail on its own explanation.
    const src = stripComments(readFileSync(join(root, "src/instrumentation.ts"), "utf8"));

    assert.ok(
      /TATA_FLEET_EDGE_AUTO_SYNC !== "true"/.test(src),
      "instrumentation.ts must return early unless TATA_FLEET_EDGE_AUTO_SYNC is explicitly 'true'",
    );
    // The original condition also fired on production + ENABLED, which is true
    // of every Vercel instance, so the timer ran everywhere alongside the cron.
    assert.ok(
      !/NODE_ENV\s*===\s*"production"/.test(src),
      "instrumentation.ts must not start the sync timer merely because it is production",
    );
  });
});

describe("overlapping syncs are refused across instances", () => {
  const sync = readFileSync(join(root, "src/lib/tata-fleet-edge.ts"), "utf8");

  test("the sync takes the shared lock", () => {
    // A module-level boolean cannot do this: on Vercel each instance holds its
    // own copy, so two instances both believe they are the only one running.
    assert.ok(
      /withPollLock\(/.test(sync),
      "syncTataFleetEdge must run under withPollLock, not only the in-process flag",
    );
  });

  test("the lease outlives the route's own timeout", () => {
    const ttl = sync.match(/SYNC_LOCK_TTL_MS = ([\d_]+)/);
    assert.ok(ttl, "SYNC_LOCK_TTL_MS must be declared");
    const ttlMs = Number(ttl![1]!.replace(/_/g, ""));

    const route = readFileSync(join(root, "src/app/api/telematics/sync/route.ts"), "utf8");
    const maxDuration = Number(route.match(/maxDuration = (\d+)/)?.[1] ?? 0) * 1000;

    // Too short and a healthy-but-slow run gets overtaken mid-flight, which is
    // the exact overlap the lock exists to prevent.
    assert.ok(
      ttlMs > maxDuration,
      `lock TTL ${ttlMs}ms must exceed the route's maxDuration ${maxDuration}ms`,
    );
  });
});
