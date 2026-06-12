# PR 1 Implementation Notes — Workspace Bootstrap Revised

## What PR 1 Actually Delivers (Revised)

After implementation and debugging, PR 1 scope is complete:

### Files Added

- `pnpm-workspace.yaml` — Workspace config with `apps/*` and `libs/*` globs
- `third_party/providers/defs_node.bzl` — Node importer provider stamp rule
- `patches/node/.gitkeep` — Ensures flat Node patch directory exists in VCS

### Files Modified

- `.npmrc` — Added `shared-workspace-lockfile=false` to existing isolation settings
  - Prevents pnpm from creating a shared lockfile when apps/libs have no Node projects yet
  - Allows workspace to work cleanly even with Go-only projects in apps/libs
  - Root package.json remains independent
- `build-tools/tools/buck/providers/node.ts` — Node provider sync driver already implemented
- `build-tools/tools/buck/sync-providers.ts` — Unified orchestrator (canonical)
- `build-tools/tools/buck/gen-auto-map.ts` — Already handles `lockfile:<path>#<importer>` labels

### Critical Fixes Applied (Runaway Process Prevention)

- `build-tools/tools/nix/devshell.nix`:
  - Added `_BUCKNIX_DEVSHELL_ACTIVE` guard to prevent recursive shellHook invocation
  - Changed node-modules linking to use `nix eval` instead of `node-modules-build.ts` to avoid triggering builds
  - Only link when TTY present and NO_NODE_MODULES_LINK unset
- `.husky/pre-commit`: Set `NO_NODE_MODULES_LINK=1`
- `build-tools/tools/bin/verify`: Export `NO_NODE_MODULES_LINK=1`
- `build-tools/tools/tests/lib/test-helpers.ts`: Export `NO_NODE_MODULES_LINK=1` for test sandboxes
- `build-tools/tools/dev/install/deps-main.ts`: Pure Nix path (no `SKIP_NODE_INSTALL` logic); per‑importer builds/link only
- All install-deps tests: no `SKIP_NODE_INSTALL`; rely on pure Nix builds

## Root Cause Analysis — Runaway Node Processes

The investigation revealed a **recursive shellHook loop**:

1. User runs `git commit` or `direnv exec . buck2 test`
2. This triggers `nix develop` (for pre-commit or via direnv)
3. shellHook runs and calls `node-modules-build.ts`
4. That script runs `nix build .#node-modules`
5. The nix build evaluation re-enters the flake's devShell
6. shellHook runs again (step 3), creating infinite recursion
7. Each iteration spawned: node process + pnpm install + nix build
8. Result: 1000+ node processes within minutes

### Why Adding pnpm-workspace.yaml Made It Worse

When `pnpm-workspace.yaml` exists:

- pnpm treats the repo as a workspace and validates workspace packages
- `apps/*` and `libs/*` globs match directories, but they contain Go projects
- pnpm attempts to install/validate them as Node packages
- This triggers more `pnpm install` calls, multiplying the spawn rate

### Solution Summary

1. **Break the recursion**: `_BUCKNIX_DEVSHELL_ACTIVE` guard
2. **Avoid builds in shellHook**: Use `nix eval` instead of building
3. **Defer workspace file**: Only add when actual Node projects exist (PR 3)
4. **Guard all entry points**: Use `NO_NODE_MODULES_LINK` in tests/hooks/verify; do not set `SKIP_NODE_INSTALL`

## Revised PR 1 Acceptance Criteria

- ✅ `pnpm-workspace.yaml` added with `apps/*` and `libs/*` globs
- ✅ `third_party/providers/defs_node.bzl` added with stamp rule
- ✅ `patches/node/.gitkeep` exists
- ✅ `.npmrc` updated with `shared-workspace-lockfile=false`
- ✅ Node provider sync runs idempotently (test passes)
- ✅ No runaway processes when running tests or commits
- ✅ pnpm list works without errors
- ✅ All 177 tests pass (full suite verified)

## For PR 3

When adding the first Node project:

1. Workspace config already exists (✅ done in PR 1)
2. Create `apps/example` with package.json, pnpm-lock.yaml, etc.
3. Add lockfile label to TARGETS
4. Tests will validate importer-scoped provider wiring

## Lessons Learned

- **Critical**: Use `shared-workspace-lockfile=false` to allow workspace config even without Node projects in apps/libs
- Test infrastructure must prevent recursive nix develop calls
- Shellhooks should never trigger builds (use eval/query only)
- Guard all entry points that might spawn processes
- The `_BUCKNIX_DEVSHELL_ACTIVE` guard is essential to prevent infinite recursion
