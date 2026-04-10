#!/usr/bin/env node
/**
 * test-score.mjs — Runs project tests and returns pass/fail as primary score + test counts as metrics.
 *
 * Measures:
 *   - Pass rate of the project's test suite
 *   - Counts of passed, failed, skipped tests
 *
 * Expected output format (to stdout as JSON):
 *   {
 *     primary: number,        // 0-1 pass ratio (passed / total), 1 = all pass
 *     metrics: {
 *       total: number,       // total test count
 *       passed: number,      // tests that passed
 *       failed: number,      // tests that failed
 *       skipped: number,      // tests that were skipped
 *       passRate: number      // passed / total (0-1)
 *     },
 *     guardrails: {
 *       testsPass: boolean    // true if all tests pass (no failures)
 *     }
 *   }
 *
 * Exit: 0 on success (always), non-zero only on crash.
 *
 * Detection order:
 *   1. pnpm test -- --runInBand  (pnpm workspace)
 *   2. npm test -- -- --runInBand (npm)
 *   3. yarn test -- --runInBand  (yarn)
 *   4. vitest run --config vitest.config.ts (vitest directly)
 *
 * Environment:
 *   TEST_SCORE_TIMEOUT  — timeout in seconds (default: 120)
 *   TEST_SCORE_BAIL    — if "1", stop on first failure (default: "1")
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const TIMEOUT_SECS = Number.parseInt(process.env.TEST_SCORE_TIMEOUT ?? "120", 10);
const BAIL = process.env.TEST_SCORE_BAIL !== "0";

function tryCommand(commands, cwd) {
  for (const cmd of commands) {
    try {
      const out = execSync(cmd, {
        cwd,
        timeout: TIMEOUT_SECS * 1000,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        shell: true
      });
      return { ok: true, output: out };
    } catch (err) {
      const stderr = err.stderr ?? "";
      const stdout = err.stdout ?? "";
      const combined = stdout + "\n" + stderr;
      // vitest outputs summary even on failure — check for it
      if (combined.includes("Test Files") || combined.includes("Tests:")) {
        return { ok: true, output: combined };
      }
      // Next command
    }
  }
  return { ok: false, output: "" };
}

function parseVitestOutput(output) {
  // Vitest summary line examples:
  // "Tests:  5 passed, 10 total"
  // "Test Files:  2 passed (2)"
  // "✓ src/foo.spec.ts (5)"
  const lines = output.split("\n");
  let total = 0, passed = 0, failed = 0, skipped = 0;

  for (const line of lines) {
    const testsMatch = line.match(/Tests:\s*(?:(\d+)\s+passed)?,?\s*(?:(\d+)\s+failed)?,?\s*(\d+)\s+total/i);
    if (testsMatch) {
      passed = Number.parseInt(testsMatch[1] ?? "0", 10);
      failed = Number.parseInt(testsMatch[2] ?? "0", 10);
      total = Number.parseInt(testsMatch[3] ?? "0", 10);
      break;
    }

    const testFilesMatch = line.match(/Test Files:\s*(?:(\d+)\s+passed)?,?\s*(?:(\d+)\s+failed)?,?\s*(\d+)\s+total/i);
    if (testFilesMatch) {
      // Not the summary we want; continue
    }
  }

  // Try alternative patterns
  const altTotal = (output.match(/\d+\s+total/g) ?? []).pop();
  if (total === 0 && altTotal) {
    const n = Number.parseInt(altTotal.split(/\s+/)[0], 10);
    if (Number.isFinite(n)) total = n;
  }
  const altPassed = (output.match(/\d+\s+passed/g) ?? []).pop();
  if (passed === 0 && altPassed) {
    const n = Number.parseInt(altPassed.split(/\s+/)[0], 10);
    if (Number.isFinite(n)) passed = n;
  }
  const altFailed = (output.match(/\d+\s+failed/g) ?? []).pop();
  if (failed === 0 && altFailed) {
    const n = Number.parseInt(altFailed.split(/\s+/)[0], 10);
    if (Number.isFinite(n)) failed = n;
  }

  skipped = total - passed - failed;
  return { total, passed, failed, skipped };
}

function parseJestOutput(output) {
  // Jest summary: "Tests: 2 failed, 5 passed, 7 total"
  const match = output.match(/Tests?:.*?(\d+)\s+failed.*?(\d+)\s+passed.*?(\d+)\s+total/i);
  if (match) {
    return {
      failed: Number.parseInt(match[1], 10),
      passed: Number.parseInt(match[2], 10),
      total: Number.parseInt(match[3], 10),
      skipped: 0
    };
  }
  // Fallback
  return { total: 0, passed: 0, failed: 0, skipped: 0 };
}

function buildResult(parsed) {
  const { total, passed, failed, skipped } = parsed;
  const passRate = total > 0 ? passed / total : (failed === 0 && total === 0 ? 1 : 0);

  return {
    primary: Math.max(0, Math.min(1, passRate)),
    metrics: {
      total,
      passed,
      failed,
      skipped,
      passRate: Math.max(0, Math.min(1, passRate))
    },
    guardrails: {
      testsPass: failed === 0 && total > 0
    }
  };
}

function main() {
  const cwd = process.cwd();
  const bailFlag = BAIL ? " --bail" : "";

  // Try pnpm first (common in monorepos)
  let result = tryCommand(
    [
      `pnpm test -- --runInBand${bailFlag}`,
      `npm test -- -- --runInBand${bailFlag}`,
      `yarn test -- --runInBand${bailFlag}`,
      existsSync("vitest.config.ts") || existsSync("vitest.config.js")
        ? `npx vitest run --config vitest.config.ts`
        : `npx vitest run`
    ],
    cwd
  );

  if (!result.ok) {
    // Tests not available — neutral score
    const r = { primary: 0.5, metrics: { error: "test command not found" }, guardrails: { testsPass: false, available: false } };
    console.log(JSON.stringify(r));
    process.exit(0);
  }

  const out = result.output;

  // Try vitest format first
  let parsed;
  if (out.includes("vitest") || out.includes("✓") || out.includes("✗") || out.includes("Tests:")) {
    parsed = parseVitestOutput(out);
  } else if (out.includes("Jest") || out.includes("FAIL") || out.includes("PASS")) {
    parsed = parseJestOutput(out);
  } else {
    // Generic fallback: look for any pass/fail counts
    parsed = parseVitestOutput(out);
  }

  const r = buildResult(parsed);
  console.log(JSON.stringify(r));
  process.exit(0);
}

main();
