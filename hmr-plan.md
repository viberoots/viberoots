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

### Phase 3: SSR and Runtime Consistency

Objective: verify SSR-specific consistency and prevent client/server regressions.

Tasks:

1. Confirm SSR module updates via `ssrLoadModule` hot-apply.
2. Confirm wasm updates are visible in SSR entry path.
3. Ensure dev startup scripts do not block on long prewarm tasks.

Completion criteria: SSR E2E passes for client module change, server module change, and wasm producer change.
Dependencies: Phase 2.
Checkpoint: `READY` for Phase 4 when static, SSR vite, and SSR next pass target scenarios.

### Phase 4: Regression Coverage and Docs

Objective: stabilize and document guarantees.

Tasks:

1. Add permanent template dev-reload E2E suite to pipeline.
2. Add troubleshooting for stale lock, watcher build failure, missing local link.
3. Document reload expectations:
   - TS edits: HMR or module invalidation
   - wasm edits: full reload acceptable if deterministic and fast
4. Remove `ts/webapp-ssr-express` and document migration to next/vite SSR templates.

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

Start Phase 0 with test harness and first pilot E2E.
