#!/usr/bin/env node
/**
 * In-Tree Mutation Testing Engine for FleetView ERP.
 *
 * Mutation testing evaluates the quality of the test suite by injecting small
 * deliberate faults (mutants) into domain logic. If the test suite fails, the
 * mutant is KILLED. If tests pass despite the bug, the mutant SURVIVED,
 * revealing an assertion gap or missing boundary check.
 *
 * Usage:
 *   node scripts/mutation-test.mjs
 *   node scripts/mutation-test.mjs --module=maintenance
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();

/** Modules under mutation audit mapped to their primary test suite */
const TARGETS = [
  {
    name: "maintenance",
    sourceFile: "src/lib/maintenance.ts",
    testFile: "src/lib/calculations.test.ts",
    maxMutants: 12,
  },
  {
    name: "costing",
    sourceFile: "src/lib/costing.ts",
    testFile: "src/lib/calculations.test.ts",
    maxMutants: 10,
  },
  {
    name: "hire",
    sourceFile: "src/lib/hire.ts",
    testFile: "src/lib/calculations.test.ts",
    maxMutants: 8,
  },
  {
    name: "tyres",
    sourceFile: "src/lib/tyres.ts",
    testFile: "src/lib/tyres.test.ts",
    maxMutants: 10,
  },
  {
    name: "compliance",
    sourceFile: "src/lib/compliance.ts",
    testFile: "src/lib/compliance.test.ts",
    maxMutants: 10,
  },
  {
    name: "production",
    sourceFile: "src/lib/production.ts",
    testFile: "src/lib/production.test.ts",
    maxMutants: 10,
  },
  {
    name: "weighbridge",
    sourceFile: "src/lib/weighbridge.ts",
    testFile: "src/lib/weighbridge-validation.test.ts",
    maxMutants: 8,
  },
  {
    name: "payroll",
    sourceFile: "src/lib/payroll.ts",
    testFile: "src/lib/payroll.test.ts",
    maxMutants: 10,
  },
];

/** Standard mutation operators */
const OPERATORS = [
  { from: / === /g, to: " !== ", desc: "=== to !==" },
  { from: / !== /g, to: " === ", desc: "!== to ===" },
  { from: / > /g, to: " <= ", desc: "> to <=" },
  { from: / < /g, to: " >= ", desc: "< to >=" },
  { from: / >= /g, to: " < ", desc: ">= to <" },
  { from: / <= /g, to: " > ", desc: "<= to >" },
  { from: / && /g, to: " || ", desc: "&& to ||" },
  { from: / \|\| /g, to: " && ", desc: "|| to &&" },
  { from: / \+ /g, to: " - ", desc: "+ to -" },
  { from: / - /g, to: " + ", desc: "- to +" },
  { from: / \* /g, to: " / ", desc: "* to /" },
];

function generateMutants(sourceText, max = 15) {
  const lines = sourceText.split("\n");
  const mutants = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments, imports, type definitions, and console logs
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("import ") ||
      trimmed.startsWith("export type ") ||
      trimmed.startsWith("type ") ||
      trimmed.startsWith("interface ") ||
      trimmed.startsWith("console.") ||
      line.length > 200
    ) {
      continue;
    }

    for (const op of OPERATORS) {
      if (op.from.test(line)) {
        op.from.lastIndex = 0;
        const mutatedLine = line.replace(op.from, op.to);
        if (mutatedLine !== line) {
          const mutatedLines = [...lines];
          mutatedLines[i] = mutatedLine;
          mutants.push({
            lineNo: i + 1,
            original: line.trim(),
            mutated: mutatedLine.trim(),
            desc: op.desc,
            content: mutatedLines.join("\n"),
          });
          if (mutants.length >= max) return mutants;
        }
      }
    }
  }

  return mutants;
}

function runTest(testFile) {
  try {
    const sanitizedEnv = { ...process.env };
    delete sanitizedEnv.DATABASE_URL;
    delete sanitizedEnv.DATABASE_URL_UNPOOLED;
    delete sanitizedEnv.DIRECT_URL;
    delete sanitizedEnv.DATABASE_URL_OWNER;
    delete sanitizedEnv.TEST_DATABASE_URL;

    execFileSync(
      process.execPath,
      ["--import", "./scripts/test-setup.mjs", "--test", testFile],
      {
        cwd: ROOT,
        stdio: "pipe",
        timeout: 8000,
        env: sanitizedEnv,
      }
    );
    // Tests passed -> mutant survived!
    return false;
  } catch (_err) {
    // Tests failed or timed out -> mutant killed!
    return true;
  }
}

async function main() {
  console.log("\n========================================================");
  console.log("       FleetView ERP In-Tree Mutation Test Runner       ");
  console.log("========================================================\n");

  const argModule = process.argv.find((a) => a.startsWith("--module="))?.split("=")[1];
  const selectedTargets = argModule
    ? TARGETS.filter((t) => t.name.toLowerCase() === argModule.toLowerCase())
    : TARGETS;

  let totalKilled = 0;
  let totalSurvived = 0;
  const reports = [];

  for (const target of selectedTargets) {
    const fullSourcePath = path.join(ROOT, target.sourceFile);
    const fullTestPath = path.join(ROOT, target.testFile);

    if (!existsSync(fullSourcePath) || !existsSync(fullTestPath)) {
      console.warn(`[WARN] Skipping ${target.name}: files not found.`);
      continue;
    }

    const originalSource = readFileSync(fullSourcePath, "utf8");
    const mutants = generateMutants(originalSource, target.maxMutants);

    let killed = 0;
    let survived = 0;
    const survivedDetails = [];

    process.stdout.write(`Mutating ${target.name.padEnd(14)} (${mutants.length} mutants): `);

    for (let m = 0; m < mutants.length; m++) {
      const mutant = mutants[m];
      try {
        writeFileSync(fullSourcePath, mutant.content, "utf8");
        const wasKilled = runTest(target.testFile);
        if (wasKilled) {
          killed++;
          process.stdout.write("\x1b[32m.\x1b[0m"); // Green dot
        } else {
          survived++;
          survivedDetails.push(mutant);
          process.stdout.write("\x1b[31mS\x1b[0m"); // Red S
        }
      } finally {
        writeFileSync(fullSourcePath, originalSource, "utf8");
      }
    }

    const score = mutants.length > 0 ? ((killed / mutants.length) * 100).toFixed(1) : "100.0";
    console.log(` -> \x1b[1m${score}%\x1b[0m killed (${killed}/${mutants.length})`);

    totalKilled += killed;
    totalSurvived += survived;
    reports.push({
      target: target.name,
      total: mutants.length,
      killed,
      survived,
      score: Number(score),
      survivedDetails,
    });
  }

  const grandTotal = totalKilled + totalSurvived;
  const overallScore = grandTotal > 0 ? ((totalKilled / grandTotal) * 100).toFixed(1) : "100.0";

  console.log("\n--------------------------------------------------------");
  console.log("Mutation Testing Summary");
  console.log("--------------------------------------------------------");
  for (const r of reports) {
    const color = r.score >= 90 ? "\x1b[32m" : r.score >= 75 ? "\x1b[33m" : "\x1b[31m";
    console.log(`  ${r.target.padEnd(14)} | ${color}${r.score.toFixed(1)}%\x1b[0m (${r.killed}/${r.total} killed)`);
    if (r.survivedDetails.length > 0) {
      for (const s of r.survivedDetails.slice(0, 2)) {
        console.log(`    \x1b[31mSurvived Line ${s.lineNo}\x1b[0m: ${s.original} -> ${s.mutated}`);
      }
    }
  }

  console.log("--------------------------------------------------------");
  const overallColor = Number(overallScore) >= 90 ? "\x1b[32m" : "\x1b[31m";
  console.log(`Total Mutants Tested : ${grandTotal}`);
  console.log(`Mutants Killed       : ${totalKilled}`);
  console.log(`Mutants Survived     : ${totalSurvived}`);
  console.log(`Overall Mutation Score: ${overallColor}\x1b[1m${overallScore}%\x1b[0m (Target >= 90.0%)`);
  console.log("========================================================\n");

  if (Number(overallScore) < 85) {
    console.error(`\x1b[31mMutation test threshold failure: overall score ${overallScore}% is below 85%.\x1b[0m`);
    process.exit(1);
  } else {
    console.log("\x1b[32mAll mutation test quality gates passed!\x1b[0m\n");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Mutation test runner error:", err);
  process.exit(1);
});
