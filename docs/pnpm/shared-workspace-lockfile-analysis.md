# Analysis: `shared-workspace-lockfile=false` — Consequences and Design Alignment

## What `shared-workspace-lockfile=false` Does

This pnpm configuration option controls lockfile management in monorepos:

- **`true` (default)**: pnpm creates a single `pnpm-lock.yaml` at the workspace root that covers ALL workspace packages
- **`false` (our choice)**: Each workspace package (`apps/*`, `libs/*`, root) maintains its own `pnpm-lock.yaml`

## Why We Need It

**Problem without it:**
- When `pnpm-workspace.yaml` exists, pnpm tries to create/validate a shared lockfile
- With `apps/*` and `libs/*` containing Go projects (no `package.json`), pnpm has nothing to lock
- Result: pnpm commands may error, hang, or behave unexpectedly

**Solution:**
- `shared-workspace-lockfile=false` tells pnpm: "each workspace member is independent"
- The root `package.json` gets `pnpm-lock.yaml` (our dev tools)
- Future `apps/example` gets its own `pnpm-lock.yaml` (PR 3+)
- No shared lockfile means no validation failures when some workspace globs match non-Node projects

## Alignment with Our Design

### ✅ Perfect Alignment — Per-Importer Lockfiles

From `pnpm-design.md`:
> **Per‑project importer‑scoped lockfiles:** Each project under `apps/*` / `libs/*` owns its `pnpm-lock.yaml` and importer key.

**Analysis:**
- `shared-workspace-lockfile=false` is EXACTLY what we want
- It enforces our design decision: one lockfile per importer
- Each `apps/web/pnpm-lock.yaml` is independent
- Each `libs/utils/pnpm-lock.yaml` is independent
- The root `pnpm-lock.yaml` is independent

**Verdict:** ✅ This setting is **essential** to our importer-scoped design.

### ✅ Provider Wiring Benefits

From `pnpm-design.md`:
> **Buck2 invalidation scope:** Importer‑scoped providers ensure that edits to `apps/web/pnpm-lock.yaml` only invalidate targets that depend on `apps/web`'s provider, not the whole repo.

**Analysis:**
- Each importer's lockfile is a distinct input to Buck2's dependency graph
- Provider rules key to `lockfile:<path>#<importer>` 
- Changes to `apps/web/pnpm-lock.yaml` only affect `apps/web`'s provider
- With a shared lockfile, ANY change would invalidate ALL Node targets
- Per-importer lockfiles = **precise, minimal invalidation**

**Verdict:** ✅ This setting **enables** our fine-grained invalidation strategy.

### ✅ Nix Hermetic Builds

From `pnpm-design.md`:
> **Nix store:** Each importer's `pnpm-lock.yaml` keys its own pair of derivations (`pnpm-store` FOD and `node-modules`). Unchanged lockfiles are full cache hits.

**Analysis:**
- Each `pnpm-lock.yaml` → unique `pnpm-store` FOD
- Per-importer lockfiles mean per-importer derivations
- Nix content-addresses tarballs, so overlapping deps are deduplicated in the store
- Cache hits are importer-specific: changing `apps/web` doesn't rebuild `apps/api`'s derivation

**Verdict:** ✅ This setting is **required** for our Nix caching strategy.

### ✅ Isolation Guarantees

From `pnpm-design.md` isolation requirements:
> Projects under `apps/*` and `libs/*` must not inherit dependencies or devDependencies from the repo root.

**Analysis:**
- `shared-workspace-lockfile=false` means no shared dependency resolution
- Each importer resolves deps independently
- Combined with `node-linker=isolated`, shadow deps are impossible
- Root dev tools (zx, eslint, prettier) don't leak to workspace packages

**Verdict:** ✅ This setting **enforces** our isolation policy.

## Impact on Future PRs

### PR 2 — Provider Wiring and Determinism
**Impact:** ✅ None — positive only
- Per-importer lockfiles are already the design assumption
- Determinism tests will verify `TARGETS.node.auto` is stable
- No changes needed

### PR 3 — First PNPM Project (apps/example)
**Impact:** ✅ None — works as designed
- Scaffold `apps/example` with its own `package.json`
- Run `pnpm install` in `apps/example` → creates `apps/example/pnpm-lock.yaml`
- No interference with root lockfile or other importers
- Labels use `lockfile:apps/example/pnpm-lock.yaml#apps/example`

### PR 4 — Hermetic Nix Derivations
**Impact:** ✅ None — simplified even
- Each importer's lockfile keys ONE pair of derivations
- `hermetic-node-modules.md` pattern applies per-importer naturally
- No need to split/filter a shared lockfile

### PR 5 — Node Macro
**Impact:** ✅ None
- Macros inject providers based on lockfile labels
- Per-importer labels already assumed in design

### PR 6 — Node Patch Wrapper
**Impact:** ✅ None
- Patches live in flat `patches/node/*.patch`
- Provider sync filters patches per importer's effective set
- Works identically whether lockfiles are shared or per-importer

### PR 7-10 — CI, Scaffolding, Tests, Docs
**Impact:** ✅ None
- All stages assume per-importer lockfiles
- No design changes needed

## Trade-offs Analysis

### What We Gain
1. **Independent evolution**: Each app/lib can update deps independently
2. **Precise invalidation**: Only affected importers rebuild
3. **Parallel development**: Teams can work on different importers without conflicts
4. **Isolation guarantees**: No accidental cross-importer dependency leakage
5. **Graceful degradation**: Workspace works even when some globs match non-Node projects

### What We "Lose" (Not Applicable to Us)
1. ❌ **Automatic dependency deduplication across workspace** — We DON'T want this (isolation policy)
2. ❌ **Single lockfile for easy review** — We WANT per-importer diffs (granular changes)
3. ❌ **Hoisting benefits** — We explicitly disable hoisting (`node-linker=isolated`)

## Alternative: Shared Lockfile Approach

If we used `shared-workspace-lockfile=true`:
- ❌ One lockfile at root covering all workspace packages
- ❌ Any dep change in any importer → entire workspace lockfile changes
- ❌ All Node targets rebuild (lose fine-grained invalidation)
- ❌ Provider strategy would need "per-package within lockfile" logic (complex)
- ❌ Nix derivations would need to filter lockfile per importer (brittle)
- ❌ Couldn't have workspace with Go-only projects

## Conclusion

**`shared-workspace-lockfile=false` is not just compatible with our design — it IS our design.**

This setting:
- ✅ Enables per-importer lockfiles (core requirement)
- ✅ Enables importer-scoped providers (invalidation strategy)
- ✅ Enables per-importer Nix derivations (caching strategy)
- ✅ Enforces isolation (security/correctness policy)
- ✅ Allows workspace to exist before Node projects (PR 1 requirement)
- ✅ Simplifies all future PRs (no lockfile splitting logic needed)

**No design complications.** All planned PRs assume this model and will work seamlessly.

## Recommendation

Keep `shared-workspace-lockfile=false` as a permanent invariant. Document it in:
- `pnpm-design.md` (design decisions section)
- `.npmrc` (with comment explaining why)
- Scaffolding templates (so new projects inherit it)
- Handbook (conventions section)

This is a **foundational decision** that enables the entire importer-scoped provider strategy.

