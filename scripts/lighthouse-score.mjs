#!/usr/bin/env node
/**
 * lighthouse-score.mjs — Runs Lighthouse CLI and returns performance score as primary + FCP/LCP/CLS as metrics.
 *
 * Measures:
 *   - Lighthouse performance score (0-1)
 *   - First Contentful Paint (FCP), Largest Contentful Paint (LCP), Cumulative Layout Shift (CLS)
 *
 * Expected output format (to stdout as JSON):
 *   {
 *     primary: number,        // 0-1 Lighthouse performance score
 *     metrics: {
 *       performance: number,  // 0-1 performance score
 *       fcp: number,          // First Contentful Paint (ms)
 *       lcp: number,          // Largest Contentful Paint (ms)
 *       cls: number,          // Cumulative Layout Shift (score)
 *       tbt: number,          // Total Blocking Time (ms)
 *       ttfb: number          // Time to First Byte (ms)
 *     },
 *     guardrails: {
 *       performanceAbove50: boolean,  // score >= 0.5
 *       noCriticalErrors: boolean     // no crash-level console errors
 *     }
 *   }
 *
 * Exit: 0 on success (always), non-zero only on crash.
 *
 * Requirements:
 *   - Lighthouse CLI: npm install -g lighthouse
 *   - Chrome browser (or Chromium) available in PATH
 *
 * Environment:
 *   LH_SCORE_URL        — URL to audit (default: http://localhost:3000)
 *   LH_SCORE_PORT       — if set, spin up a quick server on this port first
 *   LH_SCORE_TIMEOUT    — timeout in seconds (default: 60)
 *   LH_SCORE_CHROMIUM_FLAGS — additional Chromium flags (default: --no-sandbox --disable-gpu)
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";

const DEFAULT_PORT = 3000;
const DEFAULT_URL = process.env.LH_SCORE_URL ?? "http://localhost:" + DEFAULT_PORT;
const TIMEOUT_SECS = Number.parseInt(process.env.LH_SCORE_TIMEOUT ?? "60", 10);
const CHROMIUM_FLAGS = process.env.LH_SCORE_CHROMIUM_FLAGS ?? "--no-sandbox --disable-setuid-sandbox";

function isLighthouseAvailable() {
  try {
    execSync("lighthouse --version", { stdio: ["pipe", "pipe", "pipe"], shell: true });
    return true;
  } catch {
    return false;
  }
}

function startTempServer(port) {
  return new Promise((resolve, reject) => {
    const server = createServer((_, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    });
    server.listen(port, () => {
      resolve(server);
    });
    server.on("error", reject);
    // Timeout
    setTimeout(() => {
      server.close();
      reject(new Error("server timeout"));
    }, TIMEOUT_SECS * 1000);
  });
}

function runLighthouse(url) {
  const outputFile = "/tmp/lh-report.json";
  const cmd = [
    "lighthouse",
    url,
    `--output=json`,
    `--output-path=${outputFile}`,
    `--chrome-flags="${CHROMIUM_FLAGS}"`,
    "--quiet",
    `--only-categories=performance`,
    `--max-wait-for-load=30000`
  ].join(" ");

  try {
    execSync(cmd, {
      timeout: TIMEOUT_SECS * 1000,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: true
    });

    // Read and parse JSON output
    const raw = existsSync(outputFile)
      ? require("node:fs").readFileSync(outputFile, "utf8")
      : "{}";
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function extractMetrics(lh) {
  if (!lh || !lh.categories) return null;
  const perf = lh.categories.performance;
  const audits = lh.audits || {};

  function getMetric(key) {
    const a = audits[key];
    if (!a) return null;
    if (typeof a.numericValue === "number") return a.numericValue;
    return null;
  }

  const performance = perf?.score ?? 0;
  const fcp = getMetric("first-contentful-paint");
  const lcp = getMetric("largest-contentful-paint");
  const cls = getMetric("cumulative-layout-shift");
  const tbt = getMetric("total-blocking-time");
  const ttfb = getMetric("server-response-time");

  return { performance, fcp, lcp, cls, tbt, ttfb };
}

function buildResult(metrics) {
  if (!metrics) {
    return {
      primary: 0.5,
      metrics: { error: "lighthouse not available or failed" },
      guardrails: { available: false, performanceAbove50: false, noCriticalErrors: false }
    };
  }

  const { performance, fcp, lcp, cls, tbt, ttfb } = metrics;
  return {
    primary: Math.max(0, Math.min(1, performance)),
    metrics: {
      performance: Math.max(0, Math.min(1, performance)),
      fcp: fcp ?? 0,
      lcp: lcp ?? 0,
      cls: cls ?? 0,
      tbt: tbt ?? 0,
      ttfb: ttfb ?? 0
    },
    guardrails: {
      performanceAbove50: performance >= 0.5,
      noCriticalErrors: true
    }
  };
}

async function main() {
  if (!isLighthouseAvailable()) {
    const r = {
      primary: 0.5,
      metrics: { error: "lighthouse not installed (run: npm install -g lighthouse)" },
      guardrails: { available: false }
    };
    console.log(JSON.stringify(r));
    process.exit(0);
  }

  let url = DEFAULT_URL;
  let server = null;

  // If URL is localhost without port, try to detect or use default
  try {
    execSync(`curl -s -o /dev/null -w "%{http_code}" ${url} --max-time 5`, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true
    });
  } catch {
    // URL not reachable — try a quick static server
    const port = Number.parseInt(process.env.LH_SCORE_PORT ?? String(DEFAULT_PORT), 10);
    try {
      server = await startTempServer(port);
      url = `http://localhost:${port}`;
    } catch {
      // Can't start server either
      const r = { primary: 0.5, metrics: { error: `cannot reach ${url}` }, guardrails: { available: false } };
      console.log(JSON.stringify(r));
      process.exit(0);
    }
  }

  try {
    const lh = runLighthouse(url);
    const metrics = extractMetrics(lh);
    const r = buildResult(metrics);
    console.log(JSON.stringify(r));
    process.exit(0);
  } finally {
    if (server) server.close();
  }
}

main();
