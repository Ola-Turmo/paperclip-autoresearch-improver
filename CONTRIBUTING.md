# Contributing to Autoresearch Improver

Thank you for your interest in contributing to the Autoresearch Improver plugin for [Paperclip](https://paperclip.ai).

This document explains how to set up the plugin for local development, how the scorer plugin interface works, and how to add custom scorers.

## Development Setup

### Prerequisites

- Node.js 20+
- npm 10+ (or pnpm)
- Access to the Paperclip monorepo (for the plugin SDK)

### Installing the Paperclip SDK

The plugin depends on `@paperclipai/plugin-sdk`. Because this is a monorepo package published to a private registry, installation requires a few extra steps:

```bash
# 1. Clone the Paperclip monorepo
git clone https://github.com/paperclip/paperclip /tmp/paperclip

# 2. Install and build the SDK
cd /tmp/paperclip/packages/plugins/sdk
npm install
npm run build

# 3. Link the SDK into this plugin
cd /path/to/this/plugin
npm install
npm link /tmp/paperclip/packages/plugins/sdk

# 4. Verify
npm run typecheck
```

Alternatively, you can use `npm run typecheck` after step 3 to confirm TypeScript resolves the SDK correctly.

> **Note:** If you receive resolution errors like `Cannot find package '@paperclipai/plugin-sdk'`, the link step did not complete. Re-run `npm link /tmp/paperclip/packages/plugins/sdk` and try again.

### Running locally

```bash
# Start the plugin dev server (watches worker files)
npm run dev

# In a separate terminal, start the UI dev server
npm run dev:ui

# Type check
npm run typecheck

# Run tests
npm test

# Build for production
npm run build
```

### Building without the monorepo SDK

If you only need to build the manifest and worker (not the UI), you can create a minimal stub for the SDK:

```typescript
// src/plugin-sdk-stub.ts
export type PaperclipPluginManifestV1 = Record<string, unknown>;
```

Then replace the import in `src/manifest.ts` and `src/worker.ts` with the stub. Note that the UI dev server and full plugin installation in Paperclip still require the real SDK.

## Architecture

```
src/
  manifest.ts      # Plugin manifest — capabilities, config schema, tools, jobs, UI slots
  worker.ts        # Job runner + tool implementations
  scorer.ts        # Scorer interface — plug in custom evaluation logic
  ui/
    index.tsx      # React components for detailTab, sidebar, page, widget
```

### Key Concepts

#### Jobs

The plugin registers three scheduled jobs:

- `optimizer-sweep` — runs mutation → score → approval loop on all active workspaces
- `delivery-run` — executes approved mutations as scoped improvement jobs
- `health-check` — verifies scorer endpoints and system prerequisites

#### Scorer Plugin Interface

The scorer is the core extension point. It receives a candidate artifact and returns a score plus a pass/fail signal:

```typescript
// src/scorer.ts
export interface ScorerResult {
  score: number;       // 0–100, higher is better
  passed: boolean;     // true if score meets the approval threshold
  reason: string;      // Human-readable explanation
  details?: {
    performance?: number;
    accessibility?: number;
    bestPractices?: number;
    [key: string]: number | undefined;
  };
}

export interface ScorerPlugin {
  name: string;
  score(workspacePath: string, candidateArtifact: string): Promise<ScorerResult>;
  validateConfig?(config: Record<string, unknown>): boolean;
}
```

To add a custom scorer, implement `ScorerPlugin` and register it in `src/worker.ts`:

```typescript
import { registerScorer } from "./scorer";

registerScorer({
  name: "lighthouse",
  async score(workspacePath, candidateArtifact) {
    // Call Lighthouse programmatically and map the result
    const report = await runLighthouse(workspacePath);
    return {
      score: report.categories.performance.score * 100,
      passed: report.categories.performance.score >= 0.9,
      reason: `Lighthouse score: ${(report.categories.performance.score * 100).toFixed(0)}`,
      details: {
        performance: report.categories.performance.score * 100,
        accessibility: report.categories.accessibility.score * 100,
      },
    };
  },
});
```

#### Approval Tiers

Each project has an `automationTier` setting that controls how approvals work:

| Tier | Behavior |
|------|----------|
| `supervised` | All changes require human approval via swipe review before execution |
| `semiauto` | Changes below the score threshold require approval; high-scoring changes auto-approve |
| `fullauto` | All changes auto-approve if `passed = true` |

#### Delivery Runs

When a candidate passes approval, it becomes a "delivery run" — a scoped job that applies the change to the workspace. Delivery runs are tracked and can be monitored, rolled back, or retried.

## Writing Tests

Tests use Vitest:

```bash
npm test
```

Add tests alongside source files:

```
src/
  worker.ts
  worker.test.ts    ← unit tests for the worker
  scorer.ts
  scorer.test.ts    ← unit tests for the scorer interface
```

For integration tests, mock the Paperclip runtime environment:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("@paperclipai/plugin-sdk", async () => {
  const actual = await vi.importActual("@paperclipai/plugin-sdk");
  return {
    ...actual,
    // Override specific exports for testing
  };
});
```

## Submitting Changes

1. Fork the repository and create a branch from `main`.
2. Make your changes — add tests for new functionality.
3. Run `npm test` and `npm run typecheck` locally.
4. Open a PR with a description of what changed and why.
5. Link any related Paperclip issues using `Fixes #<issue>` in the PR description.

## Code Style

- TypeScript strict mode is enabled — no `any` without justification.
- Follow the existing import order (stdlib → external → internal).
- Keep functions small and single-responsibility.
- Document complex logic with inline comments or JSDoc.

## Reporting Issues

Before opening an issue, check the [existing issues](https://github.com/Ola-Turmo/paperclip-autoresearch-improver/issues) to avoid duplicates.

When reporting a bug, include:
- Paperclip plugin version (from the plugin settings page)
- Steps to reproduce
- Expected vs. actual behavior
- Browser/OS if relevant
