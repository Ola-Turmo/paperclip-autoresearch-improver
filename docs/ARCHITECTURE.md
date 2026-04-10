# Product Autopilot Plugin Architecture

**Plugin**: `@paperclipai/plugin-autoresearch-improver-example`  
**Version**: 0.2.0  
**Plugin ID**: `paperclip.autoresearch-improver-example`  
**Authors**: Codex  

This document is a detailed technical analysis of the Product Autopilot plugin at `/root/work/paperclip/packages/plugins/examples/plugin-autoresearch-improver/` and its integration with the Paperclip system.

---

## 1. Plugin Entry Points & Lifecycle

### 1.1 Plugin Manifest (`src/manifest.ts`)

The plugin is declared with two manifests:

1. **`src/manifest.ts`** — The root manifest, `paperclip.autoresearch-improver-example`, which declares:
   - **API Version**: 1
   - **Display Name**: "Autoresearch Improver"
   - **Categories**: `["automation", "workspace", "ui"]`
   - **Capabilities**: 16 capability strings including `companies.read`, `projects.read`, `issues.create`, `activity.log.write`, `jobs.schedule`, `agent.tools.register`, and several `ui.*` capabilities for registering pages, dashboard widgets, detail tabs, and sidebar items.
   - **Jobs**: One cron job `optimizer-sweep` scheduled at `"0 * * * *"` (hourly)
   - **Tools**: Three tools — `list-optimizers`, `create-issue-from-accepted-run`, `create-pull-request-from-accepted-run`
   - **UI Slots**: Six slots:
     - `optimizer-console-page` — A full page at route `optimizer-console-page`
     - `optimizer-overview-widget` — A dashboard widget
     - `optimizer-project-tab` + `optimizer-project-link` — Detail tab and sidebar link for projects
     - `autopilot-project-tab` + `autopilot-project-link` — Detail tab and sidebar link for the Autopilot feature

2. **`src/autopilot/manifest.ts`** — A separate Autopilot-specific manifest, `paperclip.autopilot`, which is nested inside the plugin. It declares:
   - **API Version**: 1
   - **Categories**: `["automation", "workspace"]`
   - **Capabilities**: 8 capabilities focused on companies, projects, plugin state, activity log, and UI registration
   - **UI Slots**: Two slots — `autopilot-project-tab` and `autopilot-project-link` for project-level detail tabs

### 1.2 Entrypoints

The manifest declares two entrypoints:

```typescript
entrypoints: {
  worker: "./dist/worker.js",
  ui: "./dist/ui"
}
```

- **`worker`**: The compiled root worker (`./dist/worker.js`) handles both the optimizer sweep logic and the autopilot entity management.
- **`ui`**: The UI bundle is served from `./dist/ui/` and contains React components.

### 1.3 Worker Initialization Flow

The root `src/worker.ts` is the main worker entrypoint. The initialization flow is:

1. **File loads** and imports all dependencies including `@paperclipai/plugin-sdk`.
2. **`definePlugin()`** is called with a plugin definition object containing `setup()`, `onHealth()`, and `onValidateConfig()`.
3. **`runWorker(plugin, import.meta.url)`** is called at the bottom — this is the SDK bootstrap that starts the RPC host if this file is the process entrypoint.
4. **During `setup(ctx)`**, four registration functions are called in order:
   - `registerDataHandlers(ctx)` — Registers all `ctx.data.register()` handlers for querying entities
   - `registerActionHandlers(ctx)` — Registers all `ctx.actions.register()` handlers for mutating state
   - `registerToolHandlers(ctx)` — Registers all `ctx.tools.register()` tool handlers
   - `registerJobs(ctx)` — Registers the `optimizer-sweep` cron job handler
5. **The `autopilot/worker.ts`** is imported by the root worker but is not the process entrypoint. Instead, it exports a `PaperclipPlugin` object (via `definePlugin`) and its own `setup()` which registers a separate set of data handlers, action handlers, and other registrations. Both workers run in the **same process** — the autopilot worker is a separate plugin instance but shares the same Node.js runtime.

### 1.4 Relationship Between Root Worker and Autopilot Worker

The root `worker.ts` imports the autopilot worker's exports:

```typescript
import { ... } from "./autopilot/worker.ts";
```

The autopilot worker's plugin definition (`PaperclipPlugin`) is registered in the same plugin's `setup()` function — essentially, **the root plugin aggregates the autopilot plugin's handlers** by calling `registerDataHandlers()` and `registerActionHandlers()` from both modules. The two sets of handlers coexist in the same plugin context.

---

## 2. Plugin SDK & Integration Surface

### 2.1 SDK Package

The plugin uses `@paperclipai/plugin-sdk` (version `workspace:*`, meaning it's a monorepo workspace dependency). The SDK provides:

- **`definePlugin()`** — The main plugin factory function
- **`runWorker()`** — Bootstrap function to start the RPC host from the worker process
- **`startWorkerRpcHost()`** — Low-level RPC host starter
- **`createHostClientHandlers()`** — Factory for creating capability-gated host handlers
- **Type definitions** for `PluginContext`, `PluginEntityRecord`, `PluginJobContext`, etc.
- **`@paperclipai/plugin-sdk/ui`** — React hooks for UI components (`usePluginAction`, `usePluginData`, etc.)

### 2.2 Context APIs Used

The plugin heavily uses the `PluginContext` object passed to `setup()`. Here are all the APIs used:

#### `ctx.data.register(key, handler)`
Registers query handlers for 30+ data keys. Examples:
- `autopilot-project`, `autopilot-projects`
- `idea`, `ideas`, `maybe-pool-ideas`
- `swipe-event`, `swipe-events`
- `delivery-run`, `delivery-runs`
- `product-program-revision`, `product-program-revisions`
- `convoy-task`, `convoy-tasks`
- `checkpoint`, `checkpoints`
- `product-lock`, `product-locks`
- `company-budget`, `company-budgets`
- `learner-summary`, `learner-summaries`
- `knowledge-entry`, `knowledge-entries`
- `digest`, `digests`
- `release-health`, `release-health-checks`
- `rollback-action`, `rollback-actions`

#### `ctx.actions.register(key, handler)`
Registers 30+ action handlers including:
- `save-autopilot-project`, `enable-autopilot`, `disable-autopilot`
- `save-product-program-revision`, `create-product-program-revision`
- `start-research-cycle`, `complete-research-cycle`, `add-research-finding`
- `generate-ideas`, `record-swipe`, `update-preference-profile`
- `create-planning-artifact`, `create-delivery-run`, `complete-delivery-run`
- `pause-autopilot`, `resume-autopilot`, `pause-delivery-run`, `resume-delivery-run`
- `decompose-into-convoy-tasks`, `update-convoy-task-status`
- `create-checkpoint`, `resume-from-checkpoint`
- `acquire-product-lock`, `release-product-lock`, `check-merge-conflict`
- `add-operator-note`, `request-checkpoint`, `nudge-run`, `inspect-linked-issue`
- `create-learner-summary`, `create-knowledge-entry`, `get-knowledge-for-run`, `mark-knowledge-as-used`
- `create-digest`, `generate-stuck-run-digest`, `generate-budget-alert-digest`
- `save-optimizer`, `delete-optimizer`, `clone-optimizer`, `pause-optimizer`, `resume-optimizer`
- `run-optimizer-cycle`, `enqueue-optimizer-run`, `approve-optimizer-run`, `reject-optimizer-run`
- `create-issue-from-run`, `create-pull-request-from-run`, `delete-proposal-branch`

#### `ctx.tools.register(name, declaration, fn)`
Three agent tools are registered:
- `list-optimizers` — Lists project optimizers
- `create-issue-from-accepted-run` — Creates a Paperclip issue from an accepted run
- `create-pull-request-from-accepted-run` — Creates a branch/PR from an accepted run

#### `ctx.jobs.register(key, fn)`
Registers the `optimizer-sweep` cron job that runs every hour and executes optimizer cycles for all active/queued optimizers.

#### Other context APIs used:
- `ctx.logger.info/warn/error/debug()` — Structured logging
- `ctx.issues.create()` — Creates Paperclip issues
- `ctx.activity.log()` — Logs activity entries
- `ctx.metrics.write()` — Writes numeric metrics

### 2.3 Worker RPC Protocol

The worker communicates with the Paperclip host via **JSON-RPC 2.0 over stdio** (child process stdin/stdout):

**Message Flow**:
```
Host (parent)                          Worker (child)
  |                                        |
  |--- request(initialize) ------------->  |  → calls plugin.setup(ctx)
  |<-- response(ok:true) ----------------  |
  |                                        |
  |--- notification(onEvent) ---------->  |  → dispatches to registered handler
  |                                        |
  |<-- request(state.get) ---------------  |  ← SDK client call from plugin code
  |--- response(result) ---------------->  |
  |                                        |
  |--- request(shutdown) --------------->  |  → calls plugin.onShutdown()
  |<-- response(void) ------------------  |
  |                                        |
(process exits)
```

The `initialize` RPC is called by the host (via `PluginWorkerManager`) passing the manifest, config, and instance info. The plugin then calls `plugin.definition.setup(ctx)` which registers all data/action/tool/job handlers.

---

## 3. The Plugin Loader (Paperclip Server Side)

### 3.1 Plugin Loader Location

`server/src/services/plugin-loader.ts` — This is the main plugin orchestration service.

### 3.2 How It Loads, Activates, and Manages Plugins

**Discovery**: The loader scans three sources:
1. **Local filesystem**: `~/.paperclip/plugins/` directory
2. **npm packages**: Any `paperclip-plugin-*` or `@*/plugin-*` packages in `node_modules`
3. **Future**: Remote registry URL

**Installation**: `installPlugin()` fetches from npm (or local path), validates the manifest, checks API version compatibility, validates capabilities, persists the install record in Postgres, and returns a `DiscoveredPlugin`.

**Runtime Activation** (`loadAll()` / `loadSingle()`): For each plugin in `ready` status:
1. **Resolve worker entrypoint** from manifest (`entrypoints.worker`) relative to the package root
2. **Build capability-gated host handlers** via `buildHostHandlers(pluginId, manifest)`
3. **Retrieve plugin config** from the database
4. **Spawn worker process** via `workerManager.startWorker()` with the entrypoint, manifest, config, instance info, and host handlers
5. **Sync job declarations** to the `plugin_jobs` table via `jobStore.syncJobDeclarations()`
6. **Register plugin with job scheduler** via `jobScheduler.registerPlugin()`
7. **Create event bus scoped handle** via `eventBus.forPlugin(pluginKey)`
8. **Register webhook endpoints** (declared in manifest)
9. **Register agent tools** via `toolDispatcher.registerPluginTools()`

### 3.3 How It Calls Worker RPC "initialize"

The host-side `PluginWorkerManager` sends the `initialize` RPC to the worker process over stdio:

```typescript
// Inside workerManager.startWorker() — sends initialize request
sendMessage(createRequest("initialize", {
  manifest: manifest,
  config: config,
  instanceInfo: instanceInfo
}));
```

The worker receives this in `worker-rpc-host.ts` `handleInitialize()`:

```typescript
async function handleInitialize(params: InitializeParams): Promise<InitializeResult> {
  manifest = params.manifest;
  currentConfig = params.config;
  await plugin.definition.setup(ctx);  // ← Plugin's setup is called here
  initialized = true;
  return { ok: true, supportedMethods };
}
```

### 3.4 Worker Lifecycle

- **Spawn**: Worker process is spawned via `child_process.spawn()` with the worker entrypoint as the command
- **Auto-restart**: If `autoRestart: true` in `WorkerStartOptions`, the worker manager will restart the worker on unexpected exit
- **Timeout**: Configurable RPC timeout (default 30 seconds for worker→host calls)
- **Shutdown**: Graceful shutdown via `shutdown` RPC → `plugin.onShutdown()` → `process.exit(0)`
- **Dev mode**: For local-path plugins, workers are spawned with `tsx` loader so TypeScript sources work without pre-build

---

## 4. UI Components

### 4.1 UI Entry Points

The plugin serves its UI bundle from `./dist/ui/`. The main component file is `src/autopilot/ui/index.tsx`.

### 4.2 React Components

The UI is built with inline styles (CSS-in-JS object style pattern) and uses the `@paperclipai/plugin-sdk/ui` React hooks:

#### `AutopilotProjectTab` (Main Container)
The main tab component for project-level autopilot configuration. Renders all sections in a card-based layout.

#### `AutopilotSettings`
Settings panel for:
- Enable/disable autopilot
- Automation tier selection (`supervised`, `semiauto`, `fullauto`)
- Budget minutes configuration
- Repository URL and workspace ID
- Pause/resume controls
- Budget pause reason display

#### `ProductProgramEditor`
Versioned document editor for the Product Program:
- Textarea for editing program content
- Version display (v1, v2, etc.)
- Revision history viewer
- Save and create new revision buttons

#### `DeliveryRunSection`
Lists all delivery runs for a project:
- Expandable run cards showing status, branch, port, workspace
- Merge conflict detection (active product locks blocking branches)
- Competing run warnings (same base branch)
- Product lock badges and details

#### `ConvoyTasksSection`
Displays convoy tasks with:
- Status-colored borders and badges (`pending`, `blocked`, `running`, `passed`, `failed`, `skipped`)
- Dependency visualization (which tasks block which)
- Status labels

#### `CheckpointResumeControls`
Checkpoint management:
- Create checkpoint button
- Resume from checkpoint functionality
- Decompose into convoy tasks
- Checkpoint list with resume buttons

#### `OperatorInterventionControls`
Operator intervention UI:
- Add note input
- Request checkpoint button
- Nudge run button
- Inspect linked issue input
- Linked issue badges

#### `ResearchSection`
Research cycle management:
- Query input for starting research
- Findings display with confidence scores
- Cycle status indicators

#### `IdeasSection`
Tinder-style idea management:
- Add idea form (title, description, score, rationale, sources)
- Idea cards with score badges
- Duplicate annotation

#### `SwipeSection`
Swipe review interface:
- Idea cards with Pass/Maybe/Yes/Now buttons
- Real-time swipe feedback
- Recent swipes list
- Preference profile counters

#### `PreferenceSection`
Swipe preference visualization with colored counters for Pass/Maybe/Yes/Now decisions.

### 4.3 UI Communication with Plugin

The UI uses React hooks from `@paperclipai/plugin-sdk/ui`:

```typescript
// Data queries
const autopilotQuery = usePluginData<AutopilotProject | null>(
  DATA_KEYS.autopilotProject,
  companyId && projectId ? { companyId, projectId } : {}
);

// Action invocations
const recordSwipe = usePluginAction(ACTION_KEYS.recordSwipe);
await recordSwipe({ companyId, projectId, ideaId, decision });
```

The hooks internally make RPC calls through the plugin context. The UI does **not** communicate directly with the worker process — all calls go through the Paperclip host which routes them to the plugin worker via JSON-RPC.

### 4.4 UI Slot Connection in Manifest

The manifest declares two UI slot types for the autopilot:

```typescript
{
  type: "detailTab",
  id: "autopilot-project-tab",
  displayName: "Autopilot",
  exportName: "AutopilotProjectTab",
  entityTypes: ["project"]
},
{
  type: "projectSidebarItem",
  id: "autopilot-project-link",
  displayName: "Autopilot",
  exportName: "AutopilotProjectSidebarLink",
  entityTypes: ["project"]
}
```

The `exportName` maps to named exports from the UI bundle. Paperclip's host renders these components at the appropriate locations in the UI.

---

## 5. The Data Model

### 5.1 Entity Types

The plugin defines 20+ entity types via `ENTITY_TYPES` constants:

| Entity Type | Description |
|------------|-------------|
| `autopilot-project` | Project-level autopilot configuration |
| `product-program-revision` | Versioned Product Program documents |
| `research-cycle` | Research investigation cycles |
| `research-finding` | Individual findings from research |
| `idea` | Product ideas with scores and status |
| `swipe-event` | Swipe decisions (pass/maybe/yes/now) |
| `preference-profile` | Aggregated swipe preferences per project |
| `planning-artifact` | Planning documents for approved ideas |
| `delivery-run` | Execution runs of approved ideas |
| `workspace-lease` | Workspace branch/port leasing for runs |
| `company-budget` | Company-wide autopilot budget tracking |
| `convoy-task` | Task decomposition for convoy execution mode |
| `checkpoint` | Execution pause/snapshot states |
| `product-lock` | Branch/path locks preventing conflicts |
| `operator-intervention` | Operator notes, checkpoint requests, nudges |
| `learner-summary` | Post-run learnings and metrics |
| `knowledge-entry` | Reusable knowledge captured from runs |
| `digest` | Aggregated notifications (budget alerts, stuck runs) |
| `release-health` | Release health check results |
| `rollback-action` | Rollback execution records |

### 5.2 Storage

Entities are persisted through the Paperclip plugin system's entity storage:

```typescript
await ctx.entities.upsert({
  entityType: ENTITY_TYPES.idea,
  scopeKind: "project",
  scopeId: idea.projectId,
  externalId: idea.ideaId,
  title: idea.title.slice(0, 80),
  status: "active",
  data: idea as unknown as Record<string, unknown>
});
```

The `scopeKind` can be `"project"` or `"company"`. The entity's `data` field stores the full typed object. The plugin's helpers in `autopilot/helpers.ts` and `worker.ts` wrap these calls with company-scoped filtering.

### 5.3 Schema/Table Definitions

The schema is not defined in the plugin itself — the plugin uses Paperclip's generic `PluginEntityRecord` interface. The actual table storage is handled by Paperclip's `plugin-registry` service. Each entity upsert stores:

```typescript
interface PluginEntityRecord {
  id: string;           // Internal Paperclip ID
  externalId: string;    // Plugin's entity ID (e.g., ideaId)
  entityType: string;    // e.g., "idea"
  scopeKind: string;     // "project" or "company"
  scopeId: string;        // Project or company UUID
  title: string;
  status: string;        // "active", "inactive", etc.
  data: Record<string, unknown>;  // The full typed entity
  createdAt: string;
  updatedAt: string;
}
```

---

## 6. End-to-End Flow: Idea → Delivery Run

### 6.1 Creating an Idea

1. User fills out the idea form in `IdeasSection` (title, description, score, rationale)
2. `generateIdeas` action is called via `usePluginAction(ACTION_KEYS.generateIdeas)`
3. Handler creates `Idea` objects, checks for duplicates, persists via `upsertIdea()`
4. Ideas appear in the Ideas list sorted by score (descending) and status priority

### 6.2 Swiping YES on an Idea

1. User clicks "Yes" button on an idea card in `SwipeSection`
2. `recordSwipe` action is called with `{ companyId, projectId, ideaId, decision: "yes" }`

**Inside `recordSwipe` handler** (`src/worker.ts` or `src/autopilot/worker.ts`):

1. **Record swipe event**: Creates `SwipeEvent` persisted via `upsertSwipeEvent()`
2. **Update idea status**: Sets `idea.status = "approved"`
3. **Update preference profile**: Increments `yesCount`, persisted via `upsertPreferenceProfile()`
4. **Auto-create planning artifact**: If decision is "yes" or "now":
   - Gets automation tier from `AutopilotProject`
   - Creates `PlanningArtifact` with `executionMode` and `approvalMode` based on tier
   - Persisted via `upsertPlanningArtifact()`
5. **Auto-create delivery run**: If budget and autopilot are not paused:
   - Creates `WorkspaceLease` for the branch
   - Creates `DeliveryRun` with `status: "pending"`, `branchName`, etc.
   - Persisted via `upsertDeliveryRun()` and `upsertWorkspaceLease()`
6. **Track budget usage**: Updates `companyBudget.autopilotUsedMinutes`
7. **Returns**: `{ swipe, idea, profile, planningArtifact, deliveryRun }`

### 6.3 Product Locks & Merge Conflicts

- Before creating a delivery run, the system can check for `ProductLock` entries
- `checkMergeConflict` action detects if another run holds a lock on the same branch
- Active locks prevent concurrent runs on the same branch
- The `DeliveryRunSection` UI visualizes conflicts with amber/red indicators

### 6.4 Checkpoint & Resume

- `createCheckpoint` captures current run state including `ConvoyTask` statuses and workspace snapshot
- `resumeFromCheckpoint` restores run state and task states from a checkpoint
- Checkpoints are created by operators or automatically before significant state changes

### 6.5 Convoy Tasks

- `decomposeIntoConvoyTasks` creates task graphs with dependencies
- `updateConvoyTaskStatus` updates individual task states
- Tasks with unmet dependencies show as `blocked`
- When a task passes, dependent blocked tasks are re-evaluated

---

## 7. Deployment Model

### 7.1 Installation

Plugins are installed via the plugin loader:

```bash
# From npm
POST /api/plugins/install { packageName: "paperclip-plugin-autoresearch-improver" }

# From local path
POST /api/plugins/install { localPath: "/path/to/plugin" }
```

The plugin's `package.json` contains the `paperclipPlugin` key:

```json
{
  "paperclipPlugin": {
    "manifest": "./dist/manifest.js",
    "worker": "./dist/worker.js",
    "ui": "./dist/ui/"
  }
}
```

### 7.2 Worker Process Model

The plugin worker runs as a **child process** of the Paperclip server:

```
Paperclip Server (Node.js process)
  └── Plugin Worker Manager
        └── plugin-autoresearch-improver (child Node.js process)
              └── Plugin RPC Host (stdio JSON-RPC)
```

- **Transport**: stdio (stdin/stdout) — no network ports exposed by the worker
- **Isolation**: Each plugin worker is isolated in its own process
- **Auto-restart**: The worker manager restarts workers on unexpected exit
- **File watching**: Paperclip server watches plugin files and can restart workers on changes (configured via `autoRestart: true`)

### 7.3 Build System

The plugin uses esbuild for the worker bundle:

```javascript
// esbuild.config.mjs
import * as esbuild from "esbuild";
// Builds src/worker.ts → dist/worker.js
// Outputs ESM format with file URL exports for import.meta.url compatibility
```

UI is built separately via `paperclip-plugin-dev-server` for development, or rollup for production.

---

## 8. Key Code Paths

### 8.1 `src/worker.ts` — Full Init and Main Handlers

The root worker file (~4076 lines) handles:

**Optimizer Core**:
- `runOptimizerCycle()` — The main Darwin-Derby optimization loop:
  1. Resolves workspace path via `ctx.projects.getPrimaryWorkspace()`
  2. Creates sandbox (git worktree or copy)
  3. Runs mutation command in sandbox
  4. Runs scoring repeats in isolated scorer workspace
  5. Runs guardrail checks
  6. Computes diff artifact
  7. Compares scores with configurable policy (threshold/confidence/epsilon)
  8. Determines outcome (accepted/rejected/pending_approval/invalid/dry_run)
  9. Applies or retains sandbox based on `applyMode`
  10. Records metrics and activity logs
  11. Auto-pauses on stagnation/consecutive failures

**Action Handlers** (~30+):
- Optimizer management: `saveOptimizer`, `pauseOptimizer`, `resumeOptimizer`, `cloneOptimizer`
- Run management: `runOptimizerCycle`, `approveOptimizerRun`, `rejectOptimizerRun`
- Issue/PR creation: `createIssueFromRun`, `createPullRequestFromRun`
- Autopilot: `recordSwipe`, `generateIdeas`, `createDeliveryRun`, etc.

### 8.2 `src/autopilot/worker.ts` — Autopilot-Specific Handlers

This file (~3415 lines) is essentially a parallel plugin definition focused on the Product Autopilot features. It registers its own data handlers and action handlers via the same `setup()` pattern. The key difference is that this file represents the "Autopilot" sub-plugin while `src/worker.ts` represents the "Autoresearch Improver" optimizer sub-plugin.

### 8.3 `src/autopilot/helpers.ts` — Entity Helpers

The helpers file (~28K) provides typed wrappers around `ctx.entities.upsert()` and `ctx.entities.list()` for all autopilot entity types:

- `upsertIdea()`, `listIdeaEntities()`, `findIdeaById()`, `findDuplicateIdea()`
- `upsertSwipeEvent()`, `listSwipeEventEntities()`
- `upsertDeliveryRun()`, `listDeliveryRunEntities()`, `findDeliveryRun()`
- `upsertProductLock()`, `findBlockingLock()`, `findActiveProductLock()`
- `upsertCheckpoint()`, `findLatestCheckpoint()`
- `upsertLearnerSummary()`, `upsertKnowledgeEntry()`, etc.

Duplicate detection uses Levenshtein-like word overlap with 0.75 similarity threshold.

### 8.4 `src/autopilot/ui/index.tsx` — UI Component Structure

The UI file (~2222 lines) is a single large React module with all components defined inline (no separate component files). It uses:

- `usePluginData<T>(key, params)` — For querying all autopilot entities
- `usePluginAction(key)` — For triggering all autopilot actions
- Inline CSS-in-JS object styles for all visual elements

The component hierarchy:
```
AutopilotProjectTab
├── AutopilotSettings
├── ProductProgramEditor
├── DeliveryRunSection
├── ConvoyTasksSection
├── CheckpointResumeControls
├── OperatorInterventionControls
├── ResearchSection
├── IdeasSection
├── SwipeSection
├── PreferenceSection
└── (KnowledgeSection, DigestSection, ReleaseHealthSection — referenced but content truncated)
```

---

## Open Questions

1. **Plugin Worker vs. Autopilot Worker separation**: The relationship between the root `worker.ts` and `autopilot/worker.ts` is unclear. Both export `PaperclipPlugin` objects but they appear to be registered in the same plugin's setup. Is the intent that `autopilot/worker.ts` is a separate plugin that gets loaded independently, or is it always co-located with the root worker?

2. **Conflicting manifest IDs**: The root manifest uses `paperclip.autoresearch-improver-example` while `autopilot/manifest.ts` uses `paperclip.autopilot`. The `autopilot/manifest.ts` appears to be a legacy or nested manifest that is not the primary entry point. What is the relationship between these two manifests?

3. **Delivery run execution**: The `DeliveryRun` entity is created but there is no visible code path that actually executes the run (i.e., spawns an agent, runs code changes, etc.). The run is created with `status: "pending"` but the actual execution loop is not evident in the plugin code. Is there a separate agent adapter or execution layer that processes pending delivery runs?

4. **Workspace lease lifecycle**: `WorkspaceLease` entities track workspace path, branch, and port. However, there is no visible code that actually provisions the workspace or assigns the port. How does a lease translate into an actual running workspace?

5. **Convoy task execution**: While tasks are created and status is tracked, the actual execution of convoy tasks (running tests, builds, etc.) is not visible in the plugin code. Who executes the tasks?

6. **Rollback mechanism**: `RollbackAction` entities exist with types `revert_commit`, `restore_checkpoint`, `full_rollback`, but the actual rollback execution logic is not visible in the plugin code.

7. **Knowledge reinjection**: `LearnerSummary` and `KnowledgeEntry` entities are created after runs complete, but the mechanism for "reinjecting" knowledge into future runs (via `reinjectionCommand`) is not implemented in visible code. How does the system actually use these knowledge entries?

8. **HTTP fetch from plugins**: The plugin has `ctx.http.fetch()` available but it is not used anywhere in the visible code. What external services does the plugin need to call?

9. **Scheduled job execution**: The `optimizer-sweep` job is registered but the job scheduler (`PluginJobScheduler`) implementation is not visible. How does the scheduler actually trigger the job and how does it handle concurrent execution?

10. **Plugin state persistence**: The plugin uses `ctx.state.get/set/delete()` for key-value state, but this is not visible in the plugin code. What state is persisted this way vs. via entities?

11. **File change watching**: The plugin loader mentions auto-restarting workers when plugin files change, but the actual file watching implementation (`autoRestart: true`) is not visible in the loader code. How does Paperclip detect file changes and trigger worker restarts?

12. **UI bundle serving**: The manifest declares `entrypoints.ui: "./dist/ui/"` but there is no visible code that actually serves this bundle to the browser. How does Paperclip host serve the plugin UI bundle and route it to the correct slot?
