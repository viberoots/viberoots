# HMR Plan for Webapp Templates

## Goal

Template-generated webapps refresh in dev mode when editing:

1. App-local TypeScript files.
2. Local workspace TypeScript dependencies.
3. Non-TypeScript local dependencies that compile to wasm and are consumed by the app.

Use minimal custom logic and maximum Vite-native behavior. For SSR templates, this must cover both client and server updates.

## Scope

In scope:

- `ts/webapp-static`
- `ts/webapp-ssr-vite`
- `ts/webapp-ssr-next`
- complete removal of deprecated `ts/webapp-ssr-express`

Out of scope (first pass):

- cross-machine hot reload
- production build optimization changes
- runtime feature changes unrelated to dev feedback loop

## Definition of Done

Done means all pass:

1. Editing app-local TS updates browser without restarting `dev`.
2. Editing local workspace TS dependency updates browser without restarting `dev`.
3. Editing non-TS wasm producer source rebuilds wasm and browser reflects change without restarting `dev`.
4. SSR behavior is correct for client and server module updates in `ts/webapp-ssr-vite` and `ts/webapp-ssr-next`.
5. E2E tests prove all of the above in CI with deterministic checks.

## Dev Update Contract Matrix (Phase 0 through Phase 3)

The expected dev behavior by change class is explicit:

| Change class                                | `ts/webapp-static`                                                   | `ts/webapp-ssr-vite`                                                                                      | `ts/webapp-ssr-next`                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| App-local TypeScript edit                   | HMR or module invalidation in one dev session. No restart.           | Client or server module updates apply in one dev session. No restart.                                     | Client or server module updates apply in one dev session. No restart.                                     |
| Workspace-linked TypeScript dependency edit | HMR or module invalidation in one dev session. No restart.           | Client and SSR paths update in one dev session. No restart.                                               | Client and SSR paths update in one dev session. No restart.                                               |
| Non-TS wasm producer edit                   | Strict deterministic producer rebuild and contract sync. No restart. | Strict deterministic producer rebuild and contract sync visible to client and SSR entry path. No restart. | Strict deterministic producer rebuild and contract sync visible to client and SSR entry path. No restart. |

Primary-path policy for all rows:

- Full-page reload is not the primary behavior target.
- Dev-process restart is always a failure condition.
- Missing deterministic watcher markers is a failure condition.

Deterministic failure signatures and recovery commands by change class:

- App-local TypeScript edits:
  - signature: rendered output does not update while dev process remains alive
  - recovery: run `pnpm run dev:ssr:only`, then retry one deterministic edit
- Workspace-linked TypeScript dependency edits:
  - signature: dependency edit is ignored until process restart
  - recovery: verify importer dependency uses `workspace:`, `link:`, or `file:`, then restart `pnpm run dev`
- Non-TS wasm producer edits:
  - signature: watcher logs miss `[wasm-watch] rebuild:start` or `[wasm-watch] sync:ok`
  - recovery: run `pnpm run dev:wasm:watch` directly and fix the reported producer command/path issue
- Stale install lock state during dependency/bootstrap steps:
  - signature: install/dependency commands block or fail on install-lock acquisition
  - recovery: remove stale lock state by re-running `i`; if needed, inspect `/tmp/bucknix-locks/` for orphaned lock directories and retry

## E2E Runner Policy

Current selected runner contract for this suite:

1. Canonical runner is Node `zx-wrapper` tests with deterministic HTTP, process, and filesystem probes.
2. Browser-level checks are limited to deterministic transport signals already used in this harness.
3. CI determinism is enforced by stable logs, stable command paths, and explicit timeout boundaries.

Escalation triggers to adopt Playwright coverage in a future phase:

1. A required contract cannot be asserted with deterministic HTTP/process/filesystem probes.
2. Repeated CI flakes show the current probes cannot distinguish true regressions from timing noise.
3. A required check depends on browser-only behavior (for example rendering or navigation state) that the current harness cannot assert directly.

## Current Observations

1. Templates already use Vite dev scripts (`dev`, `dev:ssr`).
2. Wasm contract access uses URL fetch paths (`/top.wasm`, `/wasm-inline/index.js`) instead of explicit Vite module imports.
3. Planner/packaging stage wasm for build outputs, but dev-time producer-to-consumer updates are not an explicit watcher contract.

⚠️ I still need one canonical verified example per template for:

- TS workspace dependency import
- non-TS wasm producer dependency import

## Architecture Strategy

Two dev loops:

1. **Vite-native loop** for JS/TS graph changes:
   - rely on Vite watch and HMR/invalidation
   - avoid custom watchers where Vite coverage exists
2. **Producer bridge loop** for non-TS to wasm:
   - watcher rebuilds producer and syncs wasm into app-visible path
   - Vite sees wasm change and reloads

## Phase Plan

### Phase 0: Baseline Contract and Test Harness

Objective: lock current behavior and define contract before template changes.

Tasks:

1. Define explicit dev contract in docs (HMR vs full reload per change type).
2. Choose E2E runner (Playwright preferred for browser + websocket assertions).
3. Add shared E2E helpers: start server, wait ready, mutate file, detect update, cleanup.

Completion criteria: shared harness exists and is used by at least one pilot test.
Dependencies: none.
Checkpoint: `READY` for Phase 1 when harness can observe at least one live reload event.

### Phase 1: TS Local Dependency HMR

Objective: local workspace TS dependency edits reload without server restart.

Tasks:

1. Update template Vite config for linked workspace source:
   - `server.fs.allow` includes workspace roots
   - `optimizeDeps.exclude` for workspace packages used by app
   - `ssr.noExternal` for local SSR packages (vite and next)
2. Ensure import path style is compatible with Vite graph tracking.
3. Add template note that local deps must be workspace-linked for live update.

Completion criteria: E2E confirms TS dependency edit updates rendered UI in same dev session.
Dependencies: Phase 0 harness.
Checkpoint: `READY` for Phase 2 when static, SSR vite, and SSR next are green.

### Phase 2: Wasm Dev Update Pipeline

Objective: non-TS source changes that compile to wasm update running app output.

Tasks:

1. Move wasm consumption to Vite-trackable inputs where possible.
2. Add producer watcher command:
   - watch producer sources
   - run existing producer wasm build
   - sync wasm output into app-consumed dev path
3. Emit deterministic watcher failure logs with direct recovery commands.
4. Compose template `dev` scripts to run Vite + wasm watcher with clean shutdown.

Tooling:

- no Vite plugin if Vite directly watches wasm output path
- add small Vite invalidation plugin only if reload signaling is inconsistent

Completion criteria: E2E confirms non-TS source edit rebuilds wasm and browser reflects change in same session.
Dependencies: Phase 1.
Checkpoint: `READY` for Phase 3 when loop is deterministic across repeated runs.

### Phase 2 Baseline Invariants (locked before Phase 3)

These are no longer open design choices:

1. Producer automation is canonical via zx-wrapper TypeScript (`build-tools/tools/dev/build-wasm-producer.ts`).
2. Template-local `.mjs` files are not used for substantive producer automation logic.
3. Strict wasm update policy remains the primary path (no full-page-reload-first fallback).
4. Phase 1 and Phase 2 non-regression tests for static, SSR vite, and SSR next must stay green during Phase 3 and Phase 4.

### Phase 3: SSR and Runtime Consistency

Objective: verify SSR-specific consistency on top of the locked Phase 2 baseline and prevent client/server regressions.

Tasks:

1. Confirm SSR module updates via `ssrLoadModule` hot-apply.
2. Confirm wasm updates are visible in SSR entry path.
3. Ensure dev startup scripts do not block on long prewarm tasks.
4. Keep producer automation path unchanged (canonical zx-wrapper TypeScript) unless a reproduced blocker requires escalation.
5. Prove no-restart and no-hang behavior under repeated SSR edit cycles.

Completion criteria: SSR E2E passes for client module change, server module change, and wasm producer change, while all Phase 1 and Phase 2 non-regression targets remain green.
Dependencies: Phase 2.
Checkpoint: `COMPLETED` for Phase 3 when static, SSR vite, and SSR next pass target scenarios.

### Phase 3 Closeout Status

Phase 3 is closed after these checks:

1. SSR-vite and SSR-next runtime consistency tests pass for client edit, server edit, and wasm producer edit in one dev session.
2. Repeated edit-cycle checks prove no restart and no hang behavior.
3. Startup remains non-blocking and troubleshooting guidance includes deterministic watcher markers and recovery commands.
4. Phase 1 and Phase 2 non-regression tests for static, SSR-vite, and SSR-next remain green.

### Phase 4: Regression Coverage and Docs

Objective: lock in Phase 0 through Phase 3 guarantees in CI and docs without reopening Phase 2 design decisions.

Tasks:

1. Add permanent template dev-reload E2E suite to pipeline.
2. Add troubleshooting for stale lock, watcher build failure, missing local link.
3. Document reload expectations:
   - TS edits: HMR or module invalidation
   - wasm edits: strict deterministic update path is primary; fallback policy only by explicit escalation trigger
4. Document canonical producer command-path checks (`build-tools/tools/dev/build-wasm-producer.ts`) for generated templates.
5. Remove `ts/webapp-ssr-express` and document migration to next/vite SSR templates.

Completion criteria: E2E in CI and docs include clear recovery commands.
Dependencies: Phase 3.
Checkpoint: `COMPLETED` after CI + docs review pass.

## E2E Test Matrix

1. `webapp-static.dev.hmr.local-ts-dep.e2e`
   - setup: scaffold static app + local TS lib dep
   - action: edit exported value in local dep
   - assert: browser content changes without restart
2. `webapp-ssr-vite.dev.hmr.local-ts-dep.e2e`
   - setup: scaffold SSR vite app + local TS dep
   - action: edit dep used by client path, then dep used by server render path
   - assert: client and server output both update
3. `webapp-static.dev.reload.wasm-producer.e2e`
   - setup: app consumes wasm from non-TS producer
   - action: edit producer source and wait for watcher rebuild
   - assert: browser-visible wasm behavior changes
4. `webapp-ssr-vite.dev.reload.wasm-producer.e2e`
   - same as above in SSR vite template
5. `webapp-ssr-next.dev.hmr-and-wasm.e2e`
   - setup: scaffold SSR next app with local TS dep and wasm producer
   - assert: TS dep edits update client/server output, wasm producer edit updates served page in dev session

## Implementation Notes

1. Keep files under 250 lines; split watcher helpers if needed.
2. Keep watcher behavior deterministic: single queue, no overlapping builds, explicit stdout markers for tests.
3. Prefer existing build plumbing and safe defaults; optional fast paths remain opt-in and logged.

## Selected Paths and Escalation

Watcher implementation (selected):

- start with Node watcher for deterministic control, structured logs, and E2E testability
- keep `watchexec` fallback only if Node watcher reliability under load is unacceptable
- do not implement `chokidar-cli` path in this plan

Escalation trigger to switch from Node watcher:

- repeated dropped/duplicated events in E2E under load
- persistent queue starvation under concurrent edits
- platform-specific failures requiring non-trivial branching

Wasm reload policy (selected):

- start with strict HMR for wasm edits (no navigation, state preserved, behavior updated)
- add hybrid fallback only if strict HMR cannot support specific edits deterministically
- do not use full-page-reload-first as the primary path

Escalation trigger from strict HMR to hybrid:

1. repeated unsupported wasm edit patterns that cannot be made deterministic with strict HMR
2. stale wasm/runtime state after correct strict invalidation handling
3. unacceptable developer interruption from strict-only failure modes in normal edit loops

## Immediate Next Step

Begin Phase 4 regression coverage and docs lock-in.
