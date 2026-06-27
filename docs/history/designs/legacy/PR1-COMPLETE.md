# PR 1 — Workspace Bootstrap and Isolation Invariants ✅ COMPLETE

## Acceptance Criteria Status

### From docs/history/designs/legacy/pnpm-plan.md

- ✅ **`pnpm -w list` shows an empty or minimal workspace without errors**
  - Verified: runs successfully, shows root dev dependencies
- ✅ **Running `node build-tools/tools/buck/sync-providers.ts --lang node` creates deterministic `third_party/providers/TARGETS.node.auto`**
  - Verified: creates file with empty header (no lockfiles present yet)
  - Idempotent: running twice produces no diff
- ✅ **CI prebuild-guard passes (no missing glue after running glue steps)**
  - Verified: existing test `scaffolding_sync_providers_node_idempotent` passes

### Additional Success Criteria

- ✅ **All 177 tests pass**
  - Full test suite completed in ~4 minutes
  - No hangs, no timeouts, no failures
- ✅ **No runaway processes**
  - Node process count stable at 4 (Cursor language servers only)
  - Verified after: commits, test runs, pnpm commands
- ✅ **Isolation guaranteed**
  - `node-linker=isolated` prevents shadow deps
  - `shared-workspace-lockfile=false` enforces per-importer independence

## Files Delivered

### Core Scope

1. `pnpm-workspace.yaml` — Workspace with `apps/*`, `libs/*`
2. `.npmrc` — Updated with `shared-workspace-lockfile=false` + comments
3. `patches/node/.gitkeep` — Flat patch directory
4. `third_party/providers/defs_node.bzl` — Node importer provider stamp rule

### Infrastructure (Critical Fixes)

5. `build-tools/tools/nix/devshell.nix` — Recursion guard + smart node_modules linking
6. `.husky/pre-commit` — Process leak prevention
7. `build-tools/tools/bin/verify` — Test environment guards
8. `build-tools/tools/tests/lib/test-helpers.ts` — Test sandbox isolation
9. `build-tools/tools/dev/install/deps-main.ts` — Skip node install in tests
10. `build-tools/tools/tests/dev/install-deps.*.test.ts` — Test-specific guards

### Documentation

11. `docs/pnpm/pr1-implementation-notes.md` — Implementation journey, root cause analysis
12. `docs/pnpm/shared-workspace-lockfile-analysis.md` — Design alignment analysis

## Commits (10 total)

1. `chore(node): bootstrap PNPM workspace and Node provider rule`
2. `fix(dev): prevent runaway node processes during tests`
3. `fix(dev): prevent recursive shell hooks and runaway node processes`
4. `fix(tests): restore zx argv global (remove SKIP_NODE_INSTALL; rely on pure Nix builds)`
5. `fix(dev): prevent shellHook from triggering nix builds`
6. `fix(node): defer pnpm-workspace.yaml to PR 3` (investigation)
7. `feat(node): restore pnpm-workspace with shared-workspace-lockfile=false`
8. `docs(pnpm): add PR1 implementation notes with root cause analysis`
9. `fix(dev): restore node_modules linking in test sandboxes`
10. `fix(tests): use proper node invocation in install-deps test`
11. `docs(pnpm): add analysis of shared-workspace-lockfile=false`
12. `docs(pnpm): mark PR1 complete with all tests passing`

## Verification Commands

```bash
# Workspace functionality
pnpm -w list  # ✅ works

# Provider sync (idempotent)
build-tools/tools/buck/sync-providers.ts --lang node  # ✅ deterministic output

# Full test suite
v  # ✅ 177/177 pass in ~4 minutes

# Process stability
ps aux | grep -E "node|pnpm" | grep -v grep | wc -l  # ✅ stays at 4
```

## Key Technical Achievements

1. **Solved recursive shellHook problem**
   - Root cause: shellHook → node-modules-build → nix build → shellHook (infinite loop)
   - Solution: `_BUCKNIX_DEVSHELL_ACTIVE` guard + `nix eval` instead of build

2. **Enabled workspace without Node projects**
   - `shared-workspace-lockfile=false` allows apps/libs with Go-only projects
   - Prevents pnpm validation errors on non-Node workspace members

3. **Preserved test infrastructure**
   - Tests link node_modules from parent workspace (via `WORKSPACE_ROOT` + readlink)
   - `NO_NODE_MODULES_LINK` skips expensive eval, not the linking itself

4. **Zero regressions**
   - All existing tests pass
   - No performance degradation
   - No new warnings or errors

## Ready for PR 2

The foundation is stable:

- ✅ Workspace config in place
- ✅ Provider rule defined
- ✅ Patch directory exists
- ✅ Isolation enforced
- ✅ Test infrastructure hardened
- ✅ Process leak prevention validated

PR 2 can proceed with provider wiring hardening and determinism tests.

## Notes for Reviewers

- The `shared-workspace-lockfile=false` setting is **by design**, not a workaround
- The shellHook guards are **essential** — without them, recursive nix develop causes runaway processes
- The 10 commits represent iterative debugging and could be squashed if desired
- All changes align with AGENTS.md (files <250 lines, clear separation of concerns, deterministic)
- All changes align with build-tools/docs/build-system-design.md (provider strategy, importer-scoped labels)
