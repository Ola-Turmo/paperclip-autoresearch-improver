#!/usr/bin/env node
/**
 * eslint-score.mjs — Runs ESLint and returns error-free file ratio as primary + error count as metrics.
 *
 * Measures:
 *   - Ratio of files with zero ESLint errors (error-free files / total files)
 *   - Total error count, warning count
 *
 * Expected output format (to stdout as JSON):
 *   {
 *     primary: number,        // 0-1 ratio of error-free files (1 = all clean)
 *     metrics: {
 *       totalFiles: number,   // total files scanned
 *       cleanFiles: number,   // files with zero errors
 *       errorCount: number,   // total ESLint error count
 *       warningCount: number, // total ESLint warning count
 *       cleanRatio: number     // cleanFiles / totalFiles (0-1)
 *     },
 *     guardrails: {
 *       noErrors: boolean,    // true if errorCount === 0
 *       noWarnings: boolean    // true if warningCount === 0
 *     }
 *   }
 *
 * Exit: 0 on success (always), non-zero only on crash.
 *
 * Requirements:
 *   - ESLint installed in the project or globally
 *   - .eslintrc.{js,json} or eslint.config.{js,mjs,cjs} present
 *
 * Environment:
 *   ESLINT_SCORE_EXTENSIONS — comma-separated extensions (default: "js,jsx,ts,tsx,mjs,cjs")
 *   ESLINT_SCORE_DIR        — directory to scan (default: "src")
 *   ESLINT_SCORE_TIMEOUT   — timeout in seconds (default: 60)
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_DIR = process.env.ESLINT_SCORE_DIR ?? "src";
const TIMEOUT_SECS = Number.parseInt(process.env.ESLINT_SCORE_TIMEOUT ?? "60", 10);
const EXTENSIONS = (process.env.ESLINT_SCORE_EXTENSIONS ?? "js,jsx,ts,tsx,mjs,cjs").split(",");

function isEslintAvailable() {
  try {
    execSync("npx eslint --version", { stdio: ["pipe", "pipe", "pipe"], shell: true });
    return true;
  } catch {
    return false;
  }
}

function findFiles(dir, extensions) {
  const files = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        files.push(...findFiles(join(dir, entry.name), extensions));
      } else if (entry.isFile()) {
        const ext = entry.name.split(".").pop();
        if (extensions.includes(ext)) {
          files.push(join(dir, entry.name));
        }
      }
    }
  } catch {
    // Dir not readable — skip
  }
  return files;
}

function runEslint(files) {
  if (files.length === 0) {
    return { output: "", exitCode: 0 };
  }

  const batchSize = 50;
  let combinedOut = "";

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    try {
      const out = execSync(
        `npx eslint --format json --max-warnings -1 ${batch.map((f) => `"${f}"`).join(" ")}`,
        {
          cwd: process.cwd(),
          timeout: TIMEOUT_SECS * 1000,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          shell: true
        }
      );
      combinedOut += out;
    } catch (err) {
      const stdout = err.stdout ?? "";
      const stderr = err.stderr ?? "";
      combinedOut += stdout + "\n" + stderr;
    }
  }

  return { output: combinedOut, exitCode: 0 };
}

function parseEslintJson(output) {
  if (!output || output.trim() === "") return null;
  try {
    const results = JSON.parse(output);
    if (!Array.isArray(results)) return null;

    let totalFiles = results.length;
    let cleanFiles = 0;
    let errorCount = 0;
    let warningCount = 0;

    for (const file of results) {
      const fileErrors = file.errorCount ?? 0;
      const fileWarnings = file.warningCount ?? 0;
      errorCount += fileErrors;
      warningCount += fileWarnings;
      if (fileErrors === 0 && fileWarnings === 0) {
        cleanFiles += 1;
      }
    }

    return { totalFiles, cleanFiles, errorCount, warningCount };
  } catch {
    return null;
  }
}

function buildResult(parsed) {
  if (!parsed) {
    return {
      primary: 0.5,
      metrics: { error: "eslint parse failed or no output" },
      guardrails: { noErrors: false, noWarnings: false, available: false }
    };
  }

  const { totalFiles, cleanFiles, errorCount, warningCount } = parsed;
  const cleanRatio = totalFiles > 0 ? cleanFiles / totalFiles : 1;

  return {
    primary: Math.max(0, Math.min(1, cleanRatio)),
    metrics: {
      totalFiles,
      cleanFiles,
      errorCount,
      warningCount,
      cleanRatio: Math.max(0, Math.min(1, cleanRatio))
    },
    guardrails: {
      noErrors: errorCount === 0,
      noWarnings: warningCount === 0
    }
  };
}

function main() {
  if (!isEslintAvailable()) {
    const r = {
      primary: 0.5,
      metrics: { error: "eslint not installed (run: npm install eslint)" },
      guardrails: { noErrors: false, noWarnings: false, available: false }
    };
    console.log(JSON.stringify(r));
    process.exit(0);
  }

  const dir = process.env.ESLINT_SCORE_DIR ?? DEFAULT_DIR;
  if (!existsSync(dir)) {
    const r = { primary: 0.5, metrics: { error: `directory ${dir} not found` }, guardrails: { available: false } };
    console.log(JSON.stringify(r));
    process.exit(0);
  }

  const files = findFiles(dir, EXTENSIONS);
  if (files.length === 0) {
    const r = { primary: 1, metrics: { totalFiles: 0, cleanFiles: 0, errorCount: 0, warningCount: 0, cleanRatio: 1 }, guardrails: { noErrors: true, noWarnings: true } };
    console.log(JSON.stringify(r));
    process.exit(0);
  }

  const { output } = runEslint(files);
  const parsed = parseEslintJson(output);
  const r = buildResult(parsed);
  console.log(JSON.stringify(r));
  process.exit(0);
}

main();
