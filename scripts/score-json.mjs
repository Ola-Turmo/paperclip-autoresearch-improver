#!/usr/bin/env node
/**
 * score-json.mjs — Generic JSON scorer for any tool that outputs structured JSON.
 *
 * Measures: any tool that emits a JSON blob with the shape:
 *   { primary: 0-1, metrics: {...}, guardrails: {...} }
 *
 * Expected output format (to stdout as JSON):
 *   {
 *     primary: number,        // 0-1 score, higher = better (or lower if minimize)
 *     metrics: { ... },      // arbitrary key-value numeric stats
 *     guardrails: { ... }    // arbitrary key-value boolean or numeric checks
 *   }
 *
 * Exit: 0 on success (always), non-zero only on crash.
 *
 * Usage:
 *   node ./scripts/score-json.mjs
 *   node ./scripts/score-json.mjs /path/to/output.json
 *
 * Environment:
 *   SCORE_JSON_TARGET   — optional path to a file to read instead of stdin
 *   SCORE_JSON_PRIMARY — dot-path key to extract as primary score (default: "primary")
 *   SCORE_JSON_MINIMIZE — if set to "1", lower primary scores are better
 */

import { readFileSync } from "node:fs";
import { stdin } from "node:process";

const PRIMARY_KEY = process.env.SCORE_JSON_PRIMARY ?? "primary";
const MINIMIZE = process.env.SCORES_JSON_MINIMIZE === "1";

function extractPrimary(obj, key) {
  const parts = key.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return null;
    current = current[part];
  }
  if (typeof current === "number" && Number.isFinite(current)) return current;
  return null;
}

function buildScore(obj) {
  const primary = extractPrimary(obj, PRIMARY_KEY);
  if (primary == null) {
    // Fallback: look for any top-level numeric value
    const found = Object.values(obj).find((v) => typeof v === "number" && Number.isFinite(v));
    return found ?? 0.5;
  }
  // Normalize to 0-1 range (clamp)
  return Math.max(0, Math.min(1, primary));
}

function main() {
  let raw;
  try {
    if (process.env.SCORE_JSON_TARGET) {
      raw = readFileSync(process.env.SCORE_JSON_TARGET, "utf8");
    } else if (!stdin.isTTY) {
      raw = stdin.read();
    } else {
      // No input; emit a neutral score
      const result = { primary: 0.5, metrics: {}, guardrails: {} };
      console.log(JSON.stringify(result));
      process.exit(0);
    }
  } catch (err) {
    const result = {
      primary: 0.5,
      metrics: { error: err.message },
      guardrails: { available: false }
    };
    console.log(JSON.stringify(result));
    process.exit(0);
  }

  if (raw == null || raw.trim() === "") {
    const result = { primary: 0.5, metrics: {}, guardrails: {} };
    console.log(JSON.stringify(result));
    process.exit(0);
  }

  try {
    const parsed = JSON.parse(raw);
    const primary = buildScore(parsed);
    const metrics = { ...parsed.metrics };
    const guardrails = { ...parsed.guardrails };

    const result = { primary, metrics, guardrails };
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (err) {
    // Not valid JSON — fall back to a neutral score
    const result = {
      primary: 0.5,
      metrics: { parseError: err.message },
      guardrails: { available: true }
    };
    console.log(JSON.stringify(result));
    process.exit(0);
  }
}

main();
