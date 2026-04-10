import { describe, expect, it } from "vitest";
import { extractStructuredMetricResult } from "../src/lib/optimizer.js";

describe("scorer output parsing", () => {
  // Lighthouse scorer
  it("parses lighthouse-score output correctly", () => {
    const lighthouseOutput = JSON.stringify({
      primary: 0.87,
      metrics: { fcp: 1200, lcp: 2400, cls: 0.05 },
      guardrails: { noCrash: true }
    });

    const result = extractStructuredMetricResult(lighthouseOutput, "primary");

    expect(result).not.toBeNull();
    expect(result!.primary).toBe(0.87);
    expect(result!.metrics).toEqual({ fcp: 1200, lcp: 2400, cls: 0.05 });
    expect(result!.guardrails).toEqual({ noCrash: true });
  });

  // Test scorer
  it("parses test-score output correctly", () => {
    const testScoreOutput = JSON.stringify({
      primary: 1.0,
      metrics: { passed: 48, failed: 2, total: 50 },
      guardrails: { allPassed: false }
    });

    const result = extractStructuredMetricResult(testScoreOutput, "primary");

    expect(result).not.toBeNull();
    expect(result!.primary).toBe(1.0);
    expect(result!.metrics).toEqual({ passed: 48, failed: 2, total: 50 });
    expect(result!.guardrails).toEqual({ allPassed: false });
  });

  // ESLint scorer
  it("parses eslint-score output correctly", () => {
    const eslintOutput = JSON.stringify({
      primary: 0.95,
      metrics: { errorCount: 3, warningCount: 7, filesScanned: 60 },
      guardrails: { noErrors: false }
    });

    const result = extractStructuredMetricResult(eslintOutput, "primary");

    expect(result).not.toBeNull();
    expect(result!.primary).toBe(0.95);
    expect(result!.metrics).toEqual({ errorCount: 3, warningCount: 7, filesScanned: 60 });
    expect(result!.guardrails).toEqual({ noErrors: false });
  });

  // Quality-score scorer
  it("parses quality-score output correctly", () => {
    const qualityOutput = JSON.stringify({
      primary: 0.78,
      metrics: { testPassRate: 0.95, lintCleanRatio: 0.9, changeCount: 12, composite: 0.78 },
      guardrails: { testsPass: false, noLintErrors: false }
    });

    const result = extractStructuredMetricResult(qualityOutput, "primary");

    expect(result).not.toBeNull();
    expect(result!.primary).toBe(0.78);
    expect(result!.metrics).toEqual({ testPassRate: 0.95, lintCleanRatio: 0.9, changeCount: 12, composite: 0.78 });
    expect(result!.guardrails).toEqual({ testsPass: false, noLintErrors: false });
  });

  // score-json scorer
  it("parses score-json output correctly", () => {
    const scoreJsonOutput = JSON.stringify({
      primary: 0.85,
      metrics: { quality: 0.97, label: "stable" },
      guardrails: { safe: true }
    });

    const result = extractStructuredMetricResult(scoreJsonOutput, "primary");

    expect(result).not.toBeNull();
    expect(result!.primary).toBe(0.85);
    expect(result!.metrics).toEqual({ quality: 0.97, label: "stable" });
    expect(result!.guardrails).toEqual({ safe: true });
  });

  // Nested scoreKey parsing (for score-json with dot-path)
  it("parses score-json output with nested primary key", () => {
    const scoreJsonOutput = JSON.stringify({
      wrapper: { score: 0.91 },
      metrics: { quality: 0.97 },
      guardrails: { safe: true }
    });

    const result = extractStructuredMetricResult(scoreJsonOutput, "wrapper.score");

    expect(result).not.toBeNull();
    expect(result!.primary).toBe(0.91);
    expect(result!.metrics).toEqual({ quality: 0.97 });
    expect(result!.guardrails).toEqual({ safe: true });
  });

  // Error/fallback: valid JSON but missing `primary` field -> returns null primary
  it("returns null primary when JSON is valid but missing primary field", () => {
    const missingPrimary = JSON.stringify({
      metrics: { passed: 48, failed: 2 },
      guardrails: { allPassed: false }
    });

    const result = extractStructuredMetricResult(missingPrimary, "primary");

    expect(result).not.toBeNull();
    expect(result!.primary).toBeNull();
    expect(result!.metrics).toEqual({ passed: 48, failed: 2 });
  });

  // Error/fallback: empty output -> returns null
  it("returns null for empty output", () => {
    expect(extractStructuredMetricResult("", "primary")).toBeNull();
    expect(extractStructuredMetricResult("   ", "primary")).toBeNull();
  });

  // Error/fallback: truncated output (invalid JSON)
  it("returns null for truncated JSON output", () => {
    const truncated = '{"primary": 0.87, "metrics": {"fcp": 1200';
    expect(extractStructuredMetricResult(truncated, "primary")).toBeNull();
  });

  // Error/fallback: non-JSON output
  it("returns null for non-JSON output", () => {
    const nonJson = "Error: command not found";
    expect(extractStructuredMetricResult(nonJson, "primary")).toBeNull();
  });

  // Fallback degraded mode: scorer not installed
  it("parses degraded fallback output correctly", () => {
    const degradedOutput = JSON.stringify({
      primary: 0.5,
      metrics: { available: false },
      guardrails: { available: false }
    });

    const result = extractStructuredMetricResult(degradedOutput, "primary");

    expect(result).not.toBeNull();
    expect(result!.primary).toBe(0.5);
    expect(result!.metrics).toEqual({ available: false });
    expect(result!.guardrails).toEqual({ available: false });
  });

  // Test invalid flag propagation
  it("parses scorer output with invalid flag", () => {
    const invalidOutput = JSON.stringify({
      primary: 0.5,
      metrics: {},
      guardrails: {},
      invalid: true,
      invalidReason: "Crash detected"
    });

    const result = extractStructuredMetricResult(invalidOutput, "primary");

    expect(result).not.toBeNull();
    expect(result!.invalid).toBe(true);
    expect(result!.invalidReason).toBe("Crash detected");
  });

  // Test full shape for all 5 scorer types
  it("validates full shape for lighthouse-score output", () => {
    const output = JSON.stringify({
      primary: 0.87,
      metrics: { performance: 0.87, fcp: 1200, lcp: 2100, cls: 0.05, tbt: 150, ttfb: 80 },
      guardrails: { performanceAbove50: true, noCriticalErrors: true }
    });

    const result = extractStructuredMetricResult(output, "primary");

    expect(result).not.toBeNull();
    expect(typeof result!.primary).toBe("number");
    expect(typeof result!.metrics).toBe("object");
    expect(typeof result!.guardrails).toBe("object");
  });

  it("validates full shape for test-score output", () => {
    const output = JSON.stringify({
      primary: 0.95,
      metrics: { total: 120, passed: 114, failed: 6, skipped: 0, passRate: 0.95 },
      guardrails: { testsPass: false, available: true }
    });

    const result = extractStructuredMetricResult(output, "primary");

    expect(result).not.toBeNull();
    expect(typeof result!.primary).toBe("number");
    expect(result!.metrics).toHaveProperty("total");
    expect(result!.metrics).toHaveProperty("passed");
    expect(result!.guardrails).toHaveProperty("testsPass");
  });

  it("validates full shape for eslint-score output", () => {
    const output = JSON.stringify({
      primary: 0.9,
      metrics: { totalFiles: 50, cleanFiles: 45, errorCount: 3, warningCount: 8, cleanRatio: 0.9 },
      guardrails: { noErrors: false, noWarnings: false }
    });

    const result = extractStructuredMetricResult(output, "primary");

    expect(result).not.toBeNull();
    expect(typeof result!.primary).toBe("number");
    expect(result!.metrics).toHaveProperty("totalFiles");
    expect(result!.guardrails).toHaveProperty("noErrors");
  });

  it("validates full shape for quality-score output", () => {
    const output = JSON.stringify({
      primary: 0.78,
      metrics: { testPassRate: 0.95, lintCleanRatio: 0.9, changeCount: 12, composite: 0.78 },
      guardrails: { testsPass: false, noLintErrors: false }
    });

    const result = extractStructuredMetricResult(output, "primary");

    expect(result).not.toBeNull();
    expect(typeof result!.primary).toBe("number");
    expect(result!.metrics).toHaveProperty("composite");
    expect(result!.guardrails).toHaveProperty("testsPass");
  });
});
