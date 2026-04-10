#!/usr/bin/env node
/**
 * quality-score.mjs — Computes a composite quality score from test pass rate + lint cleanliness + file change count.
 *
 * Measures:
 *   - Test pass rate (from test-score.mjs output)
 *   - Lint cleanliness ratio (from eslint-score.mjs output)
 *   - File change count (for mutation scope awareness)
 *
 * Expected output format (to stdout as JSON):
 *   {
 *     primary: number,        // 0-1 composite quality score
 *     metrics: {
 *       testPassRate: number, // 0-1 test pass rate
 *       lintCleanRatio: number, // 0-1 lint-clean file ratio
 *       changeCount: number, // number of files changed in this workspace
 *       composite: number    // weighted composite (0-1)
 *     },
 *     guardrails: {
 *       testsPass: boolean,    // test pass rate == 1
 *       noLintErrors: boolean // error count == 0
 *     }
 *   }
 *
 * Exit: 0 on success (always), non-zero only on crash.
 *
 * This script reads sibling scorer outputs to build a composite.
 * It can also be run standalone, in which case it attempts to run
 * the sibling scorers directly and aggregate their outputs.
 *
 * Environment:
 *   QUALITY_WEIGHT_TEST   — weight for test score (default: 0.5)
 *   QUALITY_WEIGHT_LINT   — weight for lint score (default: 0.3)
 *   QUALITY_WEIGHT_CHANGE — weight for change bonus (default: 0.2)
 *   QUALITY_TEST_FILE     — path to test-score output JSON (if pre-computed)
 *   QUALITY_LINT_FILE     — path to eslint-score output JSON (if pre-computed)
 *   QUALITY_CHANGE_COUNT  — number of files changed (if pre-computed)
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const WEIGHT_TEST = Number.parseFloat(process.env.QUALITY_WEIGHT_TEST ?? "0.5");
const WEIGHT_LINT = Number.parseFloat(process.env.QUALITY_WEIGHT_LINT ?? "0.3");
const WEIGHT_CHANGE = Number.parseFloat(process.env.QUALITY_WEIGHT_CHANGE ?? "0.2");

function runScorer(scriptName, env) {
  const scriptPath = join(import.meta.dirname, scriptName);
  if (!existsSync(scriptPath)) return null;
  try {
    const out = execSync(`node "${scriptPath}"`, {
      cwd: import.meta.dirname || process.cwd(),
      timeout: 120 * 1000,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      env: { ...process.env, ...env }
    });
    return JSON.parse(out.trim());
  } catch (err) {
    const raw = err.stdout ?? "";
    if (raw.trim()) {
      try { return JSON.parse(raw.trim()); } catch { /* fall through */ }
    }
    return null;
  }
}

function countChangedFiles() {
  // Count files in mutable workspace that have been modified
  // Heuristic: count non-node_modules src files (git-tracked would be ideal but we don't have git here)
  const dirs = ["src", "lib", "packages"].filter((d) => existsSync(d));
  let total = 0;
  for (const dir of dirs) {
    try {
      const files = readdirSync(dir, { withFileTypes: true });
      for (const f of files) {
        if (f.isFile()) total++;
        else if (f.isDirectory() && !f.name.startsWith(".")) total++;
      }
    } catch {
      // ignore
    }
  }
  return total;
}

function main() {
  let testResult, lintResult;
  let testPassRate = 0.5;
  let lintCleanRatio = 0.5;
  let changeCount = 0;

  // Try to load pre-computed scores
  if (process.env.QUALITY_TEST_FILE && existsSync(process.env.QUALITY_TEST_FILE)) {
    try {
      const raw = readFileSync(process.env.QUALITY_TEST_FILE, "utf8");
      testResult = JSON.parse(raw);
    } catch { /* ignore */ }
  } else {
    testResult = runScorer("test-score.mjs");
  }

  if (process.env.QUALITY_LINT_FILE && existsSync(process.env.QUALITY_LINT_FILE)) {
    try {
      const raw = readFileSync(process.env.QUALITY_LINT_FILE, "utf8");
      lintResult = JSON.parse(raw);
    } catch { /* ignore */ }
  } else {
    lintResult = runScorer("eslint-score.mjs");
  }

  if (process.env.QUALITY_CHANGE_COUNT) {
    changeCount = Number.parseInt(process.env.QUALITY_CHANGE_COUNT, 10);
  } else {
    changeCount = countChangedFiles();
  }

  if (testResult && typeof testResult.primary === "number") {
    testPassRate = testResult.primary;
  }
  if (lintResult && typeof lintResult.primary === "number") {
    lintCleanRatio = lintResult.primary;
  }

  // Normalize change count to a 0-1 score (more files changed = potentially better scope)
  // Cap at 100 files for scoring purposes
  const changeScore = Math.min(1, changeCount / 100);

  const composite =
    WEIGHT_TEST * testPassRate +
    WEIGHT_LINT * lintCleanRatio +
    WEIGHT_CHANGE * changeScore;

  const result = {
    primary: Math.max(0, Math.min(1, composite)),
    metrics: {
      testPassRate,
      lintCleanRatio,
      changeCount,
      composite: Math.max(0, Math.min(1, composite))
    },
    guardrails: {
      testsPass: testPassRate >= 1,
      noLintErrors: lintResult ? lintResult.guardrails?.noErrors ?? false : false
    }
  };

  console.log(JSON.stringify(result));
  process.exit(0);
}

main();
