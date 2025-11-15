# Patching Handbook (Go & Node)

Note: Go and C++ use per‑target local patching by default. Place patches under each target’s package directory (for example, `apps/<app>/patches/go` or `libs/<lib>/patches/cpp`) so they are included in that target’s `srcs` and Buck invalidation is precise. The global `patches/go` flow remains supported where applicable, but local patching is the default developer experience for new scaffolds. See `build-system-design.md` for details.

All scripts are zx TypeScript using `#!/usr/bin/env zx-wrapper`.

## Workflow

- Start: `tools/bin/patch-pkg start go <importPath>`
  - Creates a writable workspace over the Nix store source for the module.
  - macOS uses APFS CoW (`cp -cR`) when available; otherwise falls back to `cp -a`. Other platforms use `cp -a`.
  - Writes/updates `NIX_GO_DEV_OVERRIDE_JSON` for the current `module@version` key (local-only dev override).
  - If `PATCH_EDITOR` is set, launches it with the workspace.

- Apply: `tools/bin/patch-pkg apply go <importPath> [--target //<pkg>:name | --patch-dir <dir>]`
  - Produces a unified diff into the canonical filename under the target’s package‑local `patches/go/` directory (or into the directory passed via `--patch-dir`).
  - Clears dev overrides and removes the workspace.
  - No glue steps are required for Go; Buck invalidates via patch files in `srcs`. (Node still runs glue; see below.)

- Reset: `tools/bin/patch-pkg reset go <importPath>`
  - Abandons changes, clears dev overrides, deletes the workspace.

- Session: `tools/bin/patch-pkg session go <importPath>` (Ctrl-D=apply, Ctrl-C=reset)
  - Interactive session that ends by applying or resetting.

## Canonical filenames

Package‑local: `<pkg>/patches/go/<encodedImport>@<version>.patch` (flat directory within the package). One patch per `module@version`.

## Session store

`.patch-sessions.json` at repo root tracks local workspaces. It is ignored by Git and is local-only.

## Idempotency

Re-applying an unchanged workspace is a no-op. For Go/C++, apply does not run glue. For Node, provider sync and auto_map generation run automatically.

## Glue regeneration

Node only (Go/C++ don’t require glue for patch invalidation). Local glue is not committed. Regenerate after apply or on-demand:

- Export graph: `node tools/buck/export-graph.ts --out tools/buck/graph.json`
- Sync providers: `node tools/buck/sync-providers.ts`
- Generate provider index and Node lockfile sidecar: `node tools/buck/gen-provider-index.ts`
  - Emits `third_party/providers/provider_index.bzl` and `tools/buck/node-lock-index.json`
- Generate auto_map: `node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`

Running `node tools/dev/install-deps.ts` in the dev shell runs the full sequence automatically. CI runs the same as separate stages.

## Composite Graph API (tools reference)

When building glue or diagnostics, consume the Composite Graph rather than reading `tools/buck/graph.json` directly. This keeps behavior consistent and lets tools benefit from sidecar indexes when present.

- Library: `tools/lib/graph-view.ts` provides `readCompositeGraph({ graphPath?, providerIndexPath?, nodeLockIndexPath? })`.
- CLI: `node tools/buck/graph-view.ts` prints the composite view as JSON for quick inspection.

Example:

```bash
node tools/buck/graph-view.ts --graph tools/buck/graph.json
```

If a sidecar is missing, the Composite Graph API returns an empty object for that index and continues.

Note on remove (Go/C++ vs Node):

- Go/C++: `patch-pkg remove` does not regenerate glue. Local patches live under the target’s `patches/<lang>` directory and are included in the rule’s `srcs`, so removing a patch is picked up directly by Buck/Nix (precise invalidation, no provider/auto_map updates needed).
- Node: still regenerates providers and `auto_map.bzl` on apply/remove because importer‑scoped providers are generated artifacts derived from the lockfile and the set of applicable patches.

## CI guardrails

Local builds warn when `NIX_GO_DEV_OVERRIDE_JSON` or `NIX_CPP_DEV_OVERRIDE_JSON` is set; CI fails if either is set. These environment variables change derivation hashes and are never allowed in CI.

In addition, CI enforces patch directory invariants for Go/C++ local patch directories:

- For each package, `<pkg>/patches/{go,cpp}` is flat (no subdirectories)
- Files must be `.patch` only
- For Go, exactly one patch per `module@version`

Locally, run advisory mode:

```
node tools/dev/patches-lint.ts --lang go
```

In CI, strict mode runs and exits nonzero on violations:

```
node tools/ci/run-stage.ts --stage patches-lint
```

## Node (PNPM) — importer‑local patches and invalidation

- Node targets use importer‑scoped lockfile labels: `lockfile:<path/to/pnpm-lock.yaml>#<importer>`.
- The Node macros include importer‑local patch files in `srcs` to achieve precise Buck invalidation, mirroring Go:
  - Patches live under `<importer>/patches/node/*.patch` (e.g., `apps/web/patches/node/...`).
  - Changing a patch only invalidates Node targets bound to that importer.
- Provider stamps for Node are importer‑scoped and do not reference patch files as `srcs` (see Provider sync cookbook below); correctness comes from macro‑side `srcs` inclusion.

Quick checks and guidance:

- Ensure exactly one `lockfile:<path>#<importer>` label is present on each Node target (the macros enforce this).
- Place patches under the importer’s `patches/node/` directory; no cross‑package references.
- Regenerate glue as needed (export graph → sync providers → gen auto_map). The prebuild guard will auto‑fix locally or fail fast in CI.

### Lockfile discovery (shared helper)

All glue that scans for PNPM lockfiles uses `tools/lib/lockfiles.ts`:

- `findPnpmLockfiles(opts?: { roots?: string[]; ignore?: string[] }): Promise<string[]>`
- Ignores (by default): `.git`, `buck-out`, `node_modules`, `.pnpm-store`, `.clinic`, `coverage`
- Returns a deterministic, sorted list of relative paths (posix separators)

Callers include `tools/buck/providers/node.ts`, `tools/buck/gen-provider-index.ts` (indirect via providers), and `tools/dev/langs-diagnose.ts`. Prefer this helper over bespoke scans to keep behavior consistent.

## Walkthroughs (step‑by‑step)

### Go — package‑local patching workflow

This example patches `golang.org/x/net` for a Go library target and places the patch under that library’s package directory.

1. Start a patch session

```bash
tools/bin/patch-pkg start go golang.org/x/net
# prints a writable workspace path; open it in your editor
```

2. Make edits in the workspace (add log lines, fix a bug, etc.)

3. Apply the patch into the package‑local directory and end the session

```bash
# Option A (recommended): point to the Buck target to derive <pkg>/patches/go
tools/bin/patch-pkg apply go golang.org/x/net --target //libs/helper-lib:helper-lib

# Option B: specify the destination directory explicitly
tools/bin/patch-pkg apply go golang.org/x/net --patch-dir libs/helper-lib/patches/go
```

The command writes a file like:

```
libs/helper-lib/patches/go/golang.org__x__net@v0.24.0.patch
```

4. Build and verify

```bash
# Rebuild only the affected targets; Buck invalidates via srcs
buck2 build //libs/helper-lib:helper-lib

# Optional: run impacted tests
IMP=$(buck2 cquery 'testsof(rdeps(//..., //libs/helper-lib:helper-lib))')
[ -n "$IMP" ] && buck2 test $IMP || true
```

5. Remove or iterate

```bash
# Remove the patch file and rebuild; no glue required
tools/bin/patch-pkg remove go golang.org/x/net --target //libs/helper-lib:helper-lib
```

Tips:

- No glue is needed for Go; package‑local patch files are included in `srcs`.
- Use `--target //<pkg>:name` when you want patch placement to follow the target’s package directory automatically.

### Node — importer‑scoped patching workflow (PNPM)

This example patches `lodash` for the `apps/web` importer.

1. Start a patch session

```bash
tools/bin/patch-pkg start node lodash --importer apps/web
# prints the pnpm patch workspace; open and edit
```

2. Apply the patch and refresh glue

```bash
tools/bin/patch-pkg apply node lodash --importer apps/web
# This runs pnpm patch-commit, then:
#   - tools/buck/sync-providers.ts
#   - tools/buck/gen-auto-map.ts
```

A patch file appears under:

```
apps/web/patches/node/lodash@<version>.patch
```

3. Build and/or test

```bash
buck2 build //apps/web:bundle
buck2 test  //apps/web:tests   # or your repo’s Node test targets
```

4. Remove or iterate

```bash
tools/bin/patch-pkg remove node lodash --importer apps/web
# Provider sync and auto_map will regenerate automatically
```

Notes:

- Node uses importer‑scoped providers; glue generation is required on apply/remove.
- Patches are also included in target `srcs` for precise invalidation.

### C++ — patching a nixpkgs dependency

This example patches a nixpkgs package (e.g., `pkgs.zlib`) and writes a package‑local patch file for a C++ library target.

1. Start a patch session

```bash
tools/bin/patch-pkg start cpp pkgs.zlib
# prints a writable workspace containing the zlib sources; open and edit
# By default this sets a process-local NIX_CPP_DEV_OVERRIDE_JSON for the selected attr.
# Pass --echo-snippet if you prefer to export the override in your shell manually.
```

2. Apply the patch into the package‑local directory

```bash
# Option A: derive destination from a Buck target’s package
tools/bin/patch-pkg apply cpp pkgs.zlib --target //libs/cppdemo:lib

# Option B: specify the destination directory explicitly
tools/bin/patch-pkg apply cpp pkgs.zlib --patch-dir libs/cppdemo/patches/cpp
```

3. Build and verify

```bash
buck2 build //libs/cppdemo:lib
```

4. Remove or iterate

```bash
tools/bin/patch-pkg remove cpp pkgs.zlib --target //libs/cppdemo:lib
```

Notes:

- No glue is required for C++; package‑local patch files are included in `srcs` and passed to the Nix C++ derivations.
- If your C++ targets link against Go C archives, that integration is handled by the planner/templates and requires no special steps in this workflow.
