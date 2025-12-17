# Patching Handbook (Go, C++, Node, and Python)

Note: Go and C++ use per‑target local patching by default. Place patches under each target’s package directory (for example, `apps/<app>/patches/go` or `libs/<lib>/patches/cpp`) so they are included in that target’s `srcs` and Buck invalidation is precise. The global `patches/go` flow remains supported where applicable, but local patching is the default developer experience for new scaffolds. See `build-system-design.md` for details.

All scripts are zx TypeScript using `#!/usr/bin/env zx-wrapper`.

### Shared helpers (consistency across languages)

- Patch handlers reuse `tools/patch/lib/apply.ts: repoRoot()` for repo‑root detection.
- Filesystem existence checks use `tools/patch/lib/util.ts: pathExists()`.
- Avoid bespoke implementations; this keeps behavior consistent across Go/C++/Node/Python.
- Default package-local patch directory selection is centralized in Starlark via `//lang:defs_common.bzl: default_package_patch_dirs(lang)`. Go/C++ macros use this helper instead of hard‑coded strings (e.g., `["patches/go"]`).
- Flat patch directory checks use `tools/lib/provider-sync.ts: validateFlatDir()`; locally it warns, and in CI (or with `--strict`) it fails.
- C++ extraction/workspace setup uses the common permission normalizer `tools/patch/cross-platform.ts: chmodRecursive` to guarantee writable workspaces without affecting diffs.
- Node and Python macros include importer‑local patch files in `srcs` via the unified helper `//lang:defs_common.bzl: append_importer_patches(kwargs, importer, lang)`. Importer is derived from a single `lockfile:<path>#<importer>` label (enforced by `ensure_single_lockfile_label(...)`).
  - Labels must include the `#<importer>` suffix and contain **exactly one** `#`; malformed labels fail fast with deterministic error text.
  - Lockfile path normalization: a leading `./` is stripped (example: `lockfile:./apps/web/pnpm-lock.yaml#apps/web` is treated as `lockfile:apps/web/pnpm-lock.yaml#apps/web`).
  - Importer-dir consistency: `<importer>` must be `.` (repo-root lockfile) or the directory that contains `<path>` (example: `lockfile:apps/web/pnpm-lock.yaml#apps/web`).
- Patch inputs are attached through `//lang:patch_inputs.bzl` helpers. When a rule does not support `srcs`, call sites must choose a supported input attribute explicitly using `into = "<attr>"` or carry patch inputs via a small helper target.
  - For importer-scoped ecosystems (Node, Python), macro wiring is standardized via `//lang:importer_wiring.bzl`. New macros must not copy/paste wiring logic; they should call the helper functions (`require_single_importer_lockfile_label`, `attach_importer_patch_inputs`, `merge_provider_edges`).
  - For **genrule-style macros** (or any wrapper where edges must be realized into `srcs`), use the consolidated helper `prepare_importer_genrule_kwargs(...)` instead of re-implementing list-vs-dict `srcs` handling.

## Workflow

- Start: `tools/bin/patch-pkg start go <importPath>`
  - Creates a writable workspace over the Nix store source for the module.
  - macOS uses APFS CoW (`cp -cR`) when available; otherwise falls back to `cp -a`. Other platforms use `cp -a`.
  - Writes/updates `NIX_GO_DEV_OVERRIDE_JSON` for the current `module@version` key (local-only dev override).
  - Optional: pass `--echo-snippet` to print `export NIX_GO_DEV_OVERRIDE_JSON='{\"<module@version>\":\"<abs/path>\"}'` to stderr (parity with C++), instead of setting the env var in-process.
  - If `PATCH_EDITOR` is set, launches it with the workspace.

- Apply: `tools/bin/patch-pkg apply go <importPath> [--target //<pkg>:name | --patch-dir <dir>]`
  - Produces a unified diff into the canonical filename under the target’s package‑local `patches/go/` directory (or into the directory passed via `--patch-dir`).
  - Clears dev overrides and removes the workspace.
  - No glue steps are required for Go; Buck invalidates via patch files in `srcs`. (Node still runs glue; see below.)

- Reset: `tools/bin/patch-pkg reset go <importPath>`
  - Abandons changes, clears dev overrides, deletes the workspace.

- Session: `tools/bin/patch-pkg session go <importPath>` (Ctrl-D=apply, Ctrl-C=reset)
  - Interactive session that ends by applying or resetting.
  - Node parity: `tools/bin/patch-pkg session node <pkg>` uses identical Ctrl‑D/Ctrl‑C semantics.

## Canonical filenames

Package‑local: `<pkg>/patches/go/<encodedImport>@<version>.patch` (flat directory within the package). One patch per `module@version`.

Encoding policy:

- **Canonical encoding (produced by tools)**: encode `/` as `__` in the filename (example: `golang.org/x/net` → `golang.org__x__net`).
- **Decoding (used by Nix evaluation)**: decode **only** `__` back to `/`. This is intentionally strict so encoded filenames remain lossless (example: `lodash___core` decodes to `lodash/_core`, not `lodash/core`).
- **Linting note**: the patches linter uses a slightly more permissive normalization for duplicate detection so we can exercise collision checks even on case-insensitive filesystems, but patch application and provider tooling use the strict decode.

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

### `BUCK_TARGET` behavior in `ensureGraph()`

Some tooling flows set `BUCK_TARGET` (for example `tools/dev/build-selected.ts` and the `graph-generator-selected` Nix entrypoint). When `BUCK_TARGET` is set, `ensureGraph()` treats `tools/buck/graph.json` as valid only if the exported graph already contains that target after normalization (drop cell prefixes and config suffixes).

If the existing graph is missing the requested target, `ensureGraph()` regenerates the graph before continuing. This keeps target-scoped tooling reliable in temp workspaces and partial clones where the graph may have been generated with a narrower query.

Provider index notes:

The provider index reader is shared across Node and Python via `tools/lib/provider-index.ts:readImporterProviderIndexEntries(...)`. It normalizes importer labels, assembles deterministic provider names, and sorts output for stable ordering.

For Node only, `readNodeProviderIndexEntries()` returns an empty list when the YAML parser module is unavailable. This is expected in ultra-thin slices and prevents emitting partial or misleading Node provider index entries.

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

Python (uv) importer‑local patches use the same linter. To scope checks locally:

```
node tools/dev/patches-lint.ts --lang python
```

## Python (uv) — importer‑local patches and invalidation

- Python targets use importer‑scoped lockfile labels: `lockfile:<path/to/uv.lock>#<importer>`.
- Exporter and provider sync share the same importer/lockfile conventions via `tools/lib/importers.ts`:
  - When a Python target is missing a lockfile label, the exporter attaches one deterministically when a nearest `uv.lock` is discoverable.
  - Lockfile discovery for exporter labeling uses the shared nearest-lock helper.
  - Importer label is defined as the lockfile directory (`.` when the lockfile is at repo root).
- The Python library and test macros include importer‑local patch files in `srcs` for precise Buck invalidation:
  - Patches live under `<importer>/patches/python/*.patch` (e.g., `apps/api/patches/python/...`).
  - Changing a patch only invalidates Python targets bound to that importer.
- `nix_python_binary` carries importer‑local patch files via an internal helper `python_library` dependency (resources), because Buck prelude `python_binary` does not accept `srcs`. The synthetic dep pattern is standardized via `//lang:defs_common.bzl:synthetic_dep_for_importer_patches_from_labels(...)`.
- Lockfile label enforcement and parsing are centralized in Starlark: call `ensure_single_lockfile_label(...)` and then use `include_importer_patches_from_labels(kwargs, "python", into = "<attr>")` to both extract the importer and include importer‑local patches deterministically.
  - Implementation note: the Python macros use `//lang:importer_wiring.bzl` to keep lockfile enforcement, patch input attachment, and provider edge realization consistent with Node.

Quick checks and guidance:

- Ensure exactly one `lockfile:<path>#<importer>` label is present on each Python target (the macros enforce this).
- Place patches under the importer’s `patches/python/` directory; no cross‑package references.

## Node (PNPM) — importer‑local patches and invalidation

- Node targets use importer‑scoped lockfile labels: `lockfile:<path/to/pnpm-lock.yaml>#<importer>`.
- When a Node target is missing a lockfile label, the exporter attaches one deterministically when a nearest `pnpm-lock.yaml` is discoverable.
- The Node macros include importer‑local patch files in `srcs` to achieve precise Buck invalidation, mirroring Go:
  - Patches live under `<importer>/patches/node/*.patch` (e.g., `apps/web/patches/node/...`).
  - Changing a patch only invalidates Node targets bound to that importer.
- Some Node genrule shims pass dict-shaped `srcs` mappings (dest → source) for deterministic in-action paths. In that mode, macros still carry importer-local patches and provider-edge inputs without changing the user mapping semantics:
  - Patch files are attached by adding synthetic dict entries under `__patch_inputs__/...` with a stable key derived from a canonical sanitizer (see `//lang:sanitize.bzl:sanitize_name`). Collisions are resolved deterministically with a `__<n>` suffix.
  - Provider deps are attached by adding synthetic dict entries under `__provider_edges__/...` using the same sanitizer and collision contract.
- Provider stamps for Node are importer‑scoped and do not reference patch files as `srcs` (see Provider sync cookbook below); correctness comes from macro‑side `srcs` inclusion.
- Lockfile label enforcement and parsing are centralized: macros call `ensure_single_lockfile_label(...)` and then attach importer-local patch files using the shared `//lang:patch_inputs.bzl` helpers:
  - Implementation note: Node macros use `//lang:importer_wiring.bzl` to standardize the wiring sequence:
    - enforce exactly one importer-scoped lockfile label
    - attach importer-local patch files as inputs (list and dict shapes)
    - realize provider edges deterministically

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
- C++ macros now use the shared nixpkgs label helper (`append_nixpkg_labels` from `lang/defs_common.bzl`) for stamping `nixpkg:` labels. This change only removes duplication; behavior and exported graphs are unchanged.
- Alternative (overlay, opt‑in): You can also manage C++ patches globally under `patches/cpp/*.patch` via the nix overlay entry‑point; see `docs/cpp/overlays.md` for details. The overlay is disabled by default; local patching remains the canonical workflow.
