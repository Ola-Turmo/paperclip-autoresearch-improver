# Scorer Scripts

This directory contains production-ready scorer scripts for the Product Autopilot plugin.

## What Each Script Does

| Script | Purpose | Primary Score |
|--------|---------|---------------|
| `score-json.mjs` | Generic JSON scorer — reads any tool's structured JSON output | Value at `primary` key (0–1) |
| `test-score.mjs` | Runs project tests, returns pass rate | Pass rate (0–1) |
| `lighthouse-score.mjs` | Runs Lighthouse CLI performance audit | Lighthouse performance score (0–1) |
| `eslint-score.mjs` | Runs ESLint, returns error-free file ratio | Clean file ratio (0–1) |
| `quality-score.mjs` | Composite of test + lint scores + change scope | Weighted composite (0–1) |

## Output Shape

All scripts output valid JSON to stdout:

```json
{
  "primary": 0.85,
  "metrics": {
    "total": 42,
    "passed": 40,
    "failed": 2,
    "skipped": 0,
    "passRate": 0.952
  },
  "guardrails": {
    "testsPass": false,
    "noErrors": true
  }
}
```

- **`primary`** — 0–1 score used by the optimizer. Higher is better.
- **`metrics`** — Arbitrary key-value stats surfaced in run history.
- **`guardrails`** — Boolean checks that gate whether a candidate is accepted.

## Error Handling

All scripts exit `0` and emit a valid score even when:
- The required tool is not installed
- A command times out
- A file cannot be read
- Output is not valid JSON

In degraded mode, `primary` defaults to `0.5` (neutral) and `guardrails.available` is set to `false`.

## How to Wire Into a Paperclip Project Workspace

The scorer scripts are designed to run inside the **workspace being optimized**, not the plugin directory. Place them in your project workspace root:

```
your-project/
  scripts/
    score-json.mjs
    test-score.mjs
    lighthouse-score.mjs
    eslint-score.mjs
    quality-score.mjs
  src/
  tests/
  package.json
```

Then reference them in your optimizer config:

```json
{
  "scoreCommand": "node ./scripts/test-score.mjs",
  "scoreFormat": "json",
  "scoreKey": "primary"
}
```

Or use a built-in template in the UI — they already reference these scripts.

## Environment Variables

### score-json.mjs

| Variable | Default | Description |
|----------|---------|-------------|
| `SCORE_JSON_TARGET` | stdin | Path to a JSON file to read |
| `SCORE_JSON_PRIMARY` | `primary` | Dot-path key to extract (e.g. `metrics.score`) |

### test-score.mjs

| Variable | Default | Description |
|----------|---------|-------------|
| `TEST_SCORE_TIMEOUT` | `120` | Timeout in seconds |
| `TEST_SCORE_BAIL` | `1` | Stop on first failure (`--bail`) |

Detection order: `pnpm test` → `npm test` → `yarn test` → `vitest run`

### lighthouse-score.mjs

| Variable | Default | Description |
|----------|---------|-------------|
| `LH_SCORE_URL` | `http://localhost:3000` | URL to audit |
| `LH_SCORE_PORT` | — | Spin up a temp server on this port if URL is unreachable |
| `LH_SCORE_TIMEOUT` | `60` | Timeout in seconds |
| `LH_SCORE_CHROMIUM_FLAGS` | `--no-sandbox --disable-setuid-sandbox` | Chromium browser flags |

Requires: `npm install -g lighthouse` and Chrome/Chromium in PATH.

### eslint-score.mjs

| Variable | Default | Description |
|----------|---------|-------------|
| `ESLINT_SCORE_EXTENSIONS` | `js,jsx,ts,tsx,mjs,cjs` | Comma-separated file extensions |
| `ESLINT_SCORE_DIR` | `src` | Directory to scan |
| `ESLINT_SCORE_TIMEOUT` | `60` | Timeout in seconds |

### quality-score.mjs

| Variable | Default | Description |
|----------|---------|-------------|
| `QUALITY_WEIGHT_TEST` | `0.5` | Weight for test score |
| `QUALITY_WEIGHT_LINT` | `0.3` | Weight for lint score |
| `QUALITY_WEIGHT_CHANGE` | `0.2` | Weight for file-change scope bonus |
| `QUALITY_TEST_FILE` | — | Path to pre-computed test-score JSON |
| `QUALITY_LINT_FILE` | — | Path to pre-computed eslint-score JSON |
| `QUALITY_CHANGE_COUNT` | — | Pre-computed file change count |

## Example Output

### test-score.mjs

```json
{
  "primary": 0.95,
  "metrics": {
    "total": 120,
    "passed": 114,
    "failed": 6,
    "skipped": 0,
    "passRate": 0.95
  },
  "guardrails": {
    "testsPass": false,
    "available": true
  }
}
```

### lighthouse-score.mjs

```json
{
  "primary": 0.87,
  "metrics": {
    "performance": 0.87,
    "fcp": 1200,
    "lcp": 2100,
    "cls": 0.05,
    "tbt": 150,
    "ttfb": 80
  },
  "guardrails": {
    "performanceAbove50": true,
    "noCriticalErrors": true
  }
}
```

### eslint-score.mjs

```json
{
  "primary": 0.9,
  "metrics": {
    "totalFiles": 50,
    "cleanFiles": 45,
    "errorCount": 3,
    "warningCount": 8,
    "cleanRatio": 0.9
  },
  "guardrails": {
    "noErrors": false,
    "noWarnings": false
  }
}
```

### quality-score.mjs

```json
{
  "primary": 0.78,
  "metrics": {
    "testPassRate": 0.95,
    "lintCleanRatio": 0.9,
    "changeCount": 12,
    "composite": 0.78
  },
  "guardrails": {
    "testsPass": false,
    "noLintErrors": false
  }
}
```

## Requirements

- **Node.js** 18+ (for `.mjs` support)
- **test-score.mjs**: Vitest, Jest, pnpm, npm, or yarn test runner in `package.json`
- **lighthouse-score.mjs**: Lighthouse CLI (`npm install -g lighthouse`) + Chrome/Chromium
- **eslint-score.mjs**: ESLint + config file (`.eslintrc.js`, `eslint.config.mjs`, etc.)
- **quality-score.mjs**: Optionally the sibling scorer scripts above; runs them as subprocesses if pre-computed files not provided
