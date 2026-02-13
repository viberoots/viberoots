# Patching Handbook (Go, C++, Node, and Python)

Note: Go and C++ use per‑target local patching by default. Place patches under each target’s package directory (for example, `projects/apps/<app>/patches/go` or `projects/libs/<lib>/patches/cpp`) so they are included in that target’s `srcs` and Buck invalidation is precise. The global `patches/go` flow remains supported where applicable, but local patching is the default developer experience for new scaffolds. See `build-tools/docs/build-system-design.md` for details.

All scripts are zx TypeScript using `#!/usr/bin/env zx-wrapper`.

### Shared helpers (consistency across languages)

This section is a quick index of “don’t re-implement this” utilities. Most patch and glue behavior is intentionally centralized so the Go/C++/Node/Python flows stay consistent and easy to reason about.

- Patch handlers reuse `build-tools/tools/patch/lib/apply.ts: repoRoot()` for repo‑root detection.
- Filesystem existence checks use `build-tools/tools/patch/lib/util.ts: pathExists()`.
- Importer-scoped lockfile discovery uses `build-tools/tools/lib/importers.ts:findNearestLockfileForPackage(...)`. Patch tooling must not hand-roll upward directory walks for `uv.lock` or `pnpm-lock.yaml`.
- Workspace-based patch handlers (Go and Python) share the control flow in `build-tools/tools/patch/lib/workspace-workflow.ts` (session reuse, no-op cleanup, patch verification, and consistent messages).
- Avoid bespoke implementations; this keeps behavior consistent across Go/C++/Node/Python.
- Default package-local patch directory selection is centralized in Starlark via `//build-tools/lang:defs_common.bzl: default_package_patch_dirs(lang)`. Go/C++ macros use this helper instead of hard‑coded strings (e.g., `["patches/go"]`).
- Flat patch directory checks use `build-tools/tools/lib/provider-sync.ts: validateFlatDir()`; locally it warns, and in CI (or with `--strict`) it fails.
- Go/Node/Python patch linting shares one core implementation for flat-dir scanning, filename-shape validation, and duplicate detection: `build-tools/tools/dev/patches-lint/flat-patch-dir-lint.ts`. This keeps codes and messages consistent across languages.
- C++ extraction/workspace setup uses the common permission normalizer `build-tools/tools/patch/cross-platform.ts: chmodRecursive` to guarantee writable workspaces without affecting diffs.
- Node and Python macros include importer‑local patch files in `srcs` via the unified helper `//build-tools/lang:defs_common.bzl:prepare_language_wiring(...)`. Importer is derived from a single `lockfile:<path>#<importer>` label (enforced by `ensure_single_lockfile_label(...)`).
  - Labels must include the `#<importer>` suffix and contain **exactly one** `#`; malformed labels fail fast with deterministic error text.
  - Lockfile path normalization: any number of repeated leading `./` segments are stripped (example: `lockfile:././projects/apps/web/pnpm-lock.yaml#projects/apps/web` is treated as `lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web`).
  - Importer-dir consistency:
    - `#.` is allowed only for repo-root lockfiles (example: `lockfile:pnpm-lock.yaml#.`).
    - For non-root lockfiles, `<importer>` must equal the directory that contains `<path>` (example: `lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web`).
  - Supported importer labels: defined by the single contract artifact `build-tools/tools/lib/importer-roots.json` (rendered to Starlark as `build-tools/lang/importer_roots.bzl`). Any other importer label fails early during macro evaluation with deterministic error text.
  - To support additional importer roots, update **only** `build-tools/tools/lib/importer-roots.json`, then run glue generation (for example `i` or `node build-tools/tools/buck/glue-pipeline.ts`) so `build-tools/lang/importer_roots.bzl` is regenerated. The parity/enforcement tests will fail if the generated view is stale.
- Patch inputs are attached through `//build-tools/lang:patch_inputs.bzl` helpers. When a rule does not support `srcs`, call sites must choose a supported input attribute explicitly using `into = "<attr>"` or carry patch inputs via a small helper target.
  - For importer-scoped ecosystems (Node, Python), macro wiring is standardized via the unified helper surface re-exported from `//build-tools/lang:defs_common.bzl`:
    - `prepare_language_wiring(...)` with `wiring = "genrule"` for genrule-style wrappers (handles list vs dict `srcs`)
    - `prepare_language_wiring(...)` with `wiring = "non_genrule"` for non-genrule wrappers
    - `prepare_language_wiring(...)` with `wiring = "non_genrule_nix_calling"` for non-genrule wrappers that call Nix and need `global_nix_inputs()` wired as action inputs
    - `prepare_language_wiring(...)` with `wiring = "srcsless_rule"` for rule shapes that cannot accept `srcs` (synthetic dep carries patch inputs)
- Dev override environment variable names are a shared contract and are defined in `build-tools/tools/lib/dev-override-envs.json`. Tooling must not hardcode `NIX_*_DEV_OVERRIDE_JSON` names.

## Workflow

- Start: `build-tools/tools/bin/patch-pkg start go <importPath>`
  - Creates a writable workspace over the Nix store source for the module.
  - macOS uses APFS CoW (`cp -cR`) when available; otherwise falls back to `cp -a`. Other platforms use `cp -a`.
  - Writes/updates the Go dev override env var (as defined by `build-tools/tools/lib/dev-override-envs.json`; currently `NIX_GO_DEV_OVERRIDE_JSON`) for the current `module@version` key (local-only dev override).
  - Optional: pass `--echo-snippet` to print `export NIX_GO_DEV_OVERRIDE_JSON='{\"<module@version>\":\"<abs/path>\"}'` to stderr (parity with C++), instead of setting the env var in-process. Tooling derives the env var name from the manifest.
  - If `PATCH_EDITOR` is set, launches it with the workspace.

- Apply: `build-tools/tools/bin/patch-pkg apply go <importPath> [--target //<pkg>:name | --patch-dir <dir>]`
  - Produces a unified diff into the canonical filename under the target’s package‑local `patches/go/` directory (or into the directory passed via `--patch-dir`).
  - Clears dev overrides and ends the session. The workspace is left on disk for inspection; use `reset` to delete it.
  - No glue steps are required for Go; Buck invalidates via patch files in `srcs`. (Node still runs glue; see below.)

- Reset: `build-tools/tools/bin/patch-pkg reset go <importPath>`
  - Abandons changes, clears dev overrides, deletes the workspace.

- Session: `build-tools/tools/bin/patch-pkg session go <importPath>` (Ctrl-D=apply, Ctrl-C=reset)
  - Interactive session that ends by applying or resetting.
  - Node parity: `build-tools/tools/bin/patch-pkg session node <pkg>` uses identical Ctrl‑D/Ctrl‑C semantics.

## Canonical filenames

Package‑local: `<pkg>/patches/go/<encodedImport>@<version>.patch` (flat directory within the package). One patch per `module@version`.

Encoding policy:

- **Canonical encoding (produced by tools)**: encode `/` as `__` in the filename (example: `golang.org/x/net` → `golang.org__x__net`).
- **Decoding (used by Nix evaluation)**: decode **only** `__` back to `/`. This is intentionally strict so encoded filenames remain lossless (example: `lodash___core` decodes to `lodash/_core`, not `lodash/core`).
- **Linting note**: the patches linter uses a slightly more permissive normalization for duplicate detection so we can exercise collision checks even on case-insensitive filesystems, but patch application and provider tooling use the strict decode.

## Session store

`.patch-sessions.json` at repo root tracks local workspaces. It is ignored by Git and is local-only.

## Idempotency

Re-applying an unchanged workspace is a no-op. In that case we do not write a patch file; we still clear dev overrides and end the session so no stale override state leaks into later builds/tests.

For Go/C++, apply does not run glue. For Node and Python, provider sync and auto_map generation run automatically.

## Patch invalidation strategy (contract)

This repo supports two patch invalidation strategies. Treat this as a cross-language contract and keep it consistent across:

- **Starlark**: `//build-tools/lang:lang_contracts.bzl`
- **TypeScript**: `build-tools/tools/lib/lang-contracts.ts`

### package-local

Go and C++ use **package-local** patches. Patch files live under the Buck package of the target (for example `projects/libs/foo/patches/go/*.patch`). Those patch files are included in the target inputs (via `srcs` or an equivalent input attribute), so Buck invalidation is precise and no glue regeneration is required on apply/remove.

### importer-local

Node and Python use **importer-local** patches. Patch files live under an importer directory (for example `projects/apps/web/patches/node/*.patch` and `projects/apps/api/patches/python/*.patch`). Importer-scoped providers and `auto_map.bzl` are generated artifacts, so apply/remove regenerates glue to keep providers and mappings aligned with the lockfile and patch set.

### Graph-visible patch scope labels

Targets are stamped with exactly one patch scope label derived from the language contract:

- `patch_scope:package-local` (Go, C++)
- `patch_scope:importer-local` (Node, Python)

This is applied at shared wiring helper boundaries, not in per-language macro implementations.

To query by patch scope:

```bash
buck2 cquery 'attrfilter(labels, "patch_scope:package-local", //...)'
buck2 cquery 'attrfilter(labels, "patch_scope:importer-local", //...)'
```

Buck package boundary note (important):

- Importer-local patch inputs are attached via `native.glob(...)`, which cannot reach across Buck package boundaries.
- Therefore, **targets that include importer-local patches must be defined in the importer’s Buck package** (e.g. define the target in `projects/apps/web/TARGETS`, not `projects/apps/web/ui/TARGETS`).
- Subpackage call sites fail fast with deterministic guidance so patch edits never silently stop invalidating targets.

Provider patch inclusion policy (Node vs Python):

- **Node (PNPM)**: provider `patch_paths` includes **all importer-local patches** under `<importer>/patches/node/*.patch`.
- **Python (uv)**: provider `patch_paths` includes **only importer-local patches that match the `uv.lock` effective set**.
- The policy choice is explicit and required at the shared driver boundary: `build-tools/tools/lib/provider-sync-driver.ts` (`importerPatchInclusionPolicy`).

### Diagnostics (quick, canonical answers)

If you are unsure why a patch edit did or did not invalidate something, start with the two canonical diagnostics:

- `node build-tools/tools/buck/prebuild-guard.ts` prints one-liners that explain the invalidation surface using the contract vocabulary:
  - `patch_scope:importer-local`: invalidation is driven by macro action inputs under `<importer>/patches/<lang>`.
  - `patch_scope:package-local`: invalidation is driven by `<pkg>/patches/<lang>` included as action inputs.
- `node build-tools/tools/buck/gen-provider-index.ts` emits `third_party/providers/provider_index.json`, which maps provider targets to origin keys and includes additive patch-model metadata (`patch_scope`, `languages`, and where patch inputs are expected).

## Glue regeneration

Node and Python only (Go/C++ don’t require glue for patch invalidation). Local glue is not committed. Regenerate after apply or on-demand:

- Export graph: `node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`
- Sync providers: `node build-tools/tools/buck/sync-providers.ts`
- Generate provider index (and Node lockfile sidecar for Node): `node build-tools/tools/buck/gen-provider-index.ts`
  - Emits `third_party/providers/provider_index.bzl` and `build-tools/tools/buck/node-lock-index.json` (Node only)
- Generate auto_map: `node build-tools/tools/buck/gen-auto-map.ts --graph build-tools/tools/buck/graph.json --out third_party/providers/auto_map.bzl`

Running `node build-tools/tools/dev/install-deps.ts` in the dev shell runs the full sequence automatically. CI runs the same as separate stages.

### `BUCK_TARGET` behavior in `ensureGraph()`

Some tooling flows set `BUCK_TARGET` (for example `build-tools/tools/dev/build-selected.ts` and the `graph-generator-selected` Nix entrypoint). When `BUCK_TARGET` is set, `ensureGraph()` treats `build-tools/tools/buck/graph.json` as valid only if the exported graph already contains that target after normalization (drop cell prefixes and config suffixes).

If the existing graph is missing the requested target, `ensureGraph()` regenerates the graph before continuing. This keeps target-scoped tooling reliable in temp workspaces and partial clones where the graph may have been generated with a narrower query.

Provider index notes:

The provider index reader is shared across Node and Python via `build-tools/tools/lib/provider-index.ts:readImporterProviderIndexEntries(...)`. It normalizes importer labels, assembles deterministic provider names, and sorts output for stable ordering.

For Node only, `readNodeProviderIndexEntries()` returns an empty list when the YAML parser module is unavailable. This is expected in ultra-thin slices and prevents emitting partial or misleading Node provider index entries.

## Composite Graph API (tools reference)

When building glue or diagnostics, consume the Composite Graph rather than reading `build-tools/tools/buck/graph.json` directly. This keeps behavior consistent and lets tools benefit from sidecar indexes when present.

- Library: `build-tools/tools/lib/graph-view.ts` provides `readCompositeGraph({ graphPath?, providerIndexPath?, nodeLockIndexPath? })`.
- CLI: `node build-tools/tools/buck/graph-view.ts` prints the composite view as JSON for quick inspection.

Example:

```bash
node build-tools/tools/buck/graph-view.ts --graph build-tools/tools/buck/graph.json
```

If a sidecar is missing, the Composite Graph API returns an empty object for that index and continues.

Note on remove (Go/C++ vs Node/Python):

- Go/C++: `patch-pkg remove` does not regenerate glue. Local patches live under the target’s `patches/<lang>` directory and are included in the rule’s `srcs`, so removing a patch is picked up directly by Buck/Nix (precise invalidation, no provider/auto_map updates needed).
- Node/Python: still regenerate providers and `auto_map.bzl` on apply/remove because importer‑scoped providers are generated artifacts derived from the lockfile and the set of applicable patches.

## CI guardrails

Local builds warn when dev overrides are set; CI fails if any dev override env var is set. The canonical list of env var names is `build-tools/tools/lib/dev-override-envs.json`. These environment variables change derivation hashes and are never allowed in CI.

In addition, CI enforces patch directory invariants for Go/C++ local patch directories:

- For each package, `<pkg>/patches/{go,cpp}` is flat (no subdirectories)
- Files must be `.patch` only
- For Go/Node/Python, exactly one patch per decoded key (`<name>@<version>`) is allowed. Duplicate detection uses a permissive decode to catch collisions that can otherwise hide on case-insensitive filesystems.

Locally, run advisory mode:

```
node build-tools/tools/dev/patches-lint.ts --lang go
```

In CI, strict mode runs and exits nonzero on violations:

```
node build-tools/tools/ci/run-stage.ts --stage patches-lint
```

Python (uv) importer‑local patches use the same linter. To scope checks locally:

```
node build-tools/tools/dev/patches-lint.ts --lang python
```

## Python (uv) — importer‑local patches and invalidation

- Python targets use importer‑scoped lockfile labels: `lockfile:<path/to/uv.lock>#<importer>`.
- Exporter and provider sync share the same importer/lockfile conventions via `build-tools/tools/lib/importers.ts`:
  - When a Python target is missing a lockfile label, the exporter attaches one deterministically when a nearest `uv.lock` is discoverable.
  - Lockfile discovery for exporter labeling uses the shared nearest-lock helper.
  - Importer label is defined as the lockfile directory (`.` when the lockfile is at repo root).
- The Python library and test macros include importer‑local patch files in `srcs` for precise Buck invalidation:
  - Patches live under `<importer>/patches/python/*.patch` (e.g., `projects/apps/api/patches/python/...`).
  - Changing a patch only invalidates Python targets bound to that importer.
- `nix_python_binary` macro input does not accept `srcs` (matching the prelude `python_binary` UX), but the macro still routes through `prepare_language_wiring(..., wiring = "non_genrule_nix_calling")` and passes prepared `srcs` and `nix_inputs` to the Nix-backed rule wrapper (`python_nix_build`), so importer-local patch edits still deterministically invalidate the binary.
- Lockfile label enforcement and parsing are centralized in Starlark. For importer-scoped macros, **do not** parse lockfile labels directly; route through the canonical helper surface in `//build-tools/lang:defs_common.bzl`:
  - Prefer `prepare_language_wiring(...)` with `wiring = "non_genrule_nix_calling"` for Python non-genrule wrappers (`nix_python_library`, `nix_python_binary`, `nix_python_test`, `nix_python_wasm_*`)
  - Prefer `prepare_language_wiring(...)` with `wiring = "genrule"` for genrule-style wrappers (`nix_node_gen`, similar shims).
  - Implementation note: the unified helper encapsulates `ensure_single_lockfile_label(...)` and patch-input attachment (`include_importer_patches_from_labels(...)`) so error text, normalization, and list/dict input handling stay consistent across Node and Python.

Quick checks and guidance:

- Ensure exactly one `lockfile:<path>#<importer>` label is present on each Python target (the macros enforce this).
- Prefer passing the lockfile label via `lockfile_label=...` on macros. Avoid passing `lockfile:` labels via `labels`, because macros require exactly one lockfile label and do not allow duplicates.
- Place patches under the importer’s `patches/python/` directory; no cross‑package references.

## Node (PNPM) — importer‑local patches and invalidation

- Node targets use importer‑scoped lockfile labels: `lockfile:<path/to/pnpm-lock.yaml>#<importer>`.
- When a Node target is missing a lockfile label, the exporter attaches one deterministically when a nearest `pnpm-lock.yaml` is discoverable.
- The Node macros include importer‑local patch files in `srcs` to achieve precise Buck invalidation, mirroring Go:
  - Patches live under `<importer>/patches/node/*.patch` (e.g., `projects/apps/web/patches/node/...`).
  - Changing a patch only invalidates Node targets bound to that importer.
- Some Node genrule shims pass dict-shaped `srcs` mappings (dest → source) for deterministic in-action paths. In that mode, macros still carry importer-local patches and provider-edge inputs without changing the user mapping semantics:
  - Patch files are attached by adding synthetic dict entries under `__patch_inputs__/...` with a stable key derived from a canonical sanitizer (see `//build-tools/lang:sanitize.bzl:sanitize_name`). Collisions are resolved deterministically with a `__<n>` suffix.
  - Provider deps are attached by adding synthetic dict entries under `__provider_edges__/...` using the same sanitizer and collision contract.
  - The canonical prefix strings are defined once in `//build-tools/lang:dict_inputs.bzl` (`PATCH_INPUTS_KEY_PREFIX`, `PROVIDER_EDGES_KEY_PREFIX`) and re-exported via `//build-tools/lang:defs_common.bzl`. Do not hardcode these strings in macros or helpers.
- Provider stamps for Node are importer‑scoped and do not reference patch files as `srcs` (see Provider sync cookbook below); correctness comes from macro‑side `srcs` inclusion.
- Lockfile label enforcement and parsing are centralized: macros call `ensure_single_lockfile_label(...)` and then attach importer-local patch files using the shared `//build-tools/lang:patch_inputs.bzl` helpers:
  - Implementation note: Node macros use `//build-tools/lang:defs_common.bzl:prepare_language_wiring(...)` to standardize the wiring sequence:
    - enforce exactly one importer-scoped lockfile label
    - attach importer-local patch files as inputs (list and dict shapes)
    - realize provider edges deterministically

Quick checks and guidance:

- Ensure exactly one `lockfile:<path>#<importer>` label is present on each Node target (the macros enforce this).
- Prefer passing the lockfile label via `lockfile_label=...` on macros. Avoid passing `lockfile:` labels via `labels`, because macros require exactly one lockfile label and do not allow duplicates.
- Place patches under the importer’s `patches/node/` directory; no cross‑package references.
- Regenerate glue as needed (export graph → sync providers → gen auto_map). The prebuild guard will auto‑fix locally or fail fast in CI.

### Lockfile discovery (shared helper)

All glue that scans for PNPM lockfiles uses `build-tools/tools/lib/lockfiles.ts`:

- `findPnpmLockfiles(opts?: { roots?: string[]; ignore?: string[] }): Promise<string[]>`
- Ignores (by default): `.git`, `buck-out`, `node_modules`, `.pnpm-store`, `.clinic`, `coverage`
- Returns a deterministic, sorted list of relative paths (posix separators)

Callers include `build-tools/tools/buck/providers/node.ts`, `build-tools/tools/buck/gen-provider-index.ts` (indirect via providers), and `build-tools/tools/dev/langs-diagnose.ts`. Prefer this helper over bespoke scans to keep behavior consistent.

## Walkthroughs (step‑by‑step)

### Go — package‑local patching workflow

This example patches `golang.org/x/net` for a Go library target and places the patch under that library’s package directory.

1. Start a patch session

```bash
build-tools/tools/bin/patch-pkg start go golang.org/x/net
# prints a writable workspace path; open it in your editor
```

2. Make edits in the workspace (add log lines, fix a bug, etc.)

3. Apply the patch into the package‑local directory and end the session

```bash
# Option A (recommended): point to the Buck target to derive <pkg>/patches/go
build-tools/tools/bin/patch-pkg apply go golang.org/x/net --target //projects/libs/helper-lib:helper-lib

# Option B: specify the destination directory explicitly
build-tools/tools/bin/patch-pkg apply go golang.org/x/net --patch-dir projects/libs/helper-lib/patches/go
```

The command writes a file like:

```
projects/libs/helper-lib/patches/go/golang.org__x__net@v0.24.0.patch
```

4. Build and verify

```bash
# Rebuild only the affected targets; Buck invalidates via srcs
buck2 build //projects/libs/helper-lib:helper-lib

# Optional: run impacted tests
IMP=$(buck2 cquery 'testsof(rdeps(//..., //projects/libs/helper-lib:helper-lib))')
[ -n "$IMP" ] && buck2 test $IMP || true
```

5. Remove or iterate

```bash
# Remove the patch file and rebuild; no glue required
build-tools/tools/bin/patch-pkg remove go golang.org/x/net --target //projects/libs/helper-lib:helper-lib
```

Tips:

- No glue is needed for Go; package‑local patch files are included in `srcs`.
- Use `--target //<pkg>:name` when you want patch placement to follow the target’s package directory automatically.

### Node — importer‑scoped patching workflow (PNPM)

This example patches `lodash` for the `projects/apps/web` importer.

1. Start a patch session

```bash
build-tools/tools/bin/patch-pkg start node lodash --importer projects/apps/web
# prints the pnpm patch workspace; open and edit
```

2. Apply the patch and refresh glue

```bash
build-tools/tools/bin/patch-pkg apply node lodash --importer projects/apps/web
# This runs pnpm patch-commit, then:
#   - build-tools/tools/buck/sync-providers.ts
#   - build-tools/tools/buck/gen-auto-map.ts
```

2b. Check transitive required patch coverage (read-only by default)

```bash
build-tools/tools/bin/patch-pkg sync-required node --importer projects/apps/web
```

- The check resolves transitive Node patch requirements from local library deps.
- Missing required ids fail with deterministic diagnostics.
- Missing optional ids warn.
- The same read-only policy also runs in normal Node build entrypoint macros before Nix build execution.
- Diagnostics always include the exact remediation command:
  - `patch-pkg sync-required node --importer <importer>`
- Optional placeholder generation is explicit only:

```bash
build-tools/tools/bin/patch-pkg sync-required node --importer projects/apps/web --write-placeholders
```

A patch file appears under:

```
projects/apps/web/patches/node/lodash@<version>.patch
```

3. Build and/or test

```bash
buck2 build //projects/apps/web:bundle
buck2 test  //projects/apps/web:tests   # or your repo’s Node test targets
```

4. Remove or iterate

```bash
build-tools/tools/bin/patch-pkg remove node lodash --importer projects/apps/web
# Provider sync and auto_map will regenerate automatically
```

Notes:

- Node uses importer‑scoped providers; glue generation is required on apply/remove.
- Patches are also included in target `srcs` for precise invalidation.

### Python — importer‑scoped patching workflow (uv)

Python patching is importer‑scoped, like Node, but patch files are plain `*.patch` artifacts that we write directly under the importer. Glue regeneration runs on apply/remove to keep importer-scoped providers and `auto_map.bzl` aligned.

By default, patches are written to:

- If the importer lockfile is at repo root: `patches/python/`
- Otherwise: `<importer>/patches/python/` (for example `projects/apps/api/patches/python/`)

You can override the destination directory with `--patch-dir`:

- An **absolute** `--patch-dir` is used as-is.
- A **relative** `--patch-dir` is resolved against the repo root.

Example:

```bash
# Start a patch session (pick importer by locating the nearest uv.lock)
build-tools/tools/bin/patch-pkg start python requests --importer projects/apps/api

# Apply with default destination (<importer>/patches/python)
build-tools/tools/bin/patch-pkg apply python requests --importer projects/apps/api

# Or, override the destination directory explicitly
build-tools/tools/bin/patch-pkg apply python requests --importer projects/apps/api --patch-dir projects/apps/api/patches/python
```

### C++ — patching a nixpkgs dependency

This example patches a nixpkgs package (e.g., `pkgs.zlib`) and writes a package‑local patch file for a C++ library target.

1. Start a patch session

```bash
build-tools/tools/bin/patch-pkg start cpp pkgs.zlib
# prints a writable workspace containing the zlib sources; open and edit
# By default this sets a process-local C++ dev override env var (as defined by `build-tools/tools/lib/dev-override-envs.json`; currently `NIX_CPP_DEV_OVERRIDE_JSON`) for the selected attr.
# Pass --echo-snippet if you prefer to export the override in your shell manually.
```

2. Apply the patch into the package‑local directory

```bash
# Option A: derive destination from a Buck target’s package
build-tools/tools/bin/patch-pkg apply cpp pkgs.zlib --target //projects/libs/cppdemo:lib

# Option B: specify the destination directory explicitly
build-tools/tools/bin/patch-pkg apply cpp pkgs.zlib --patch-dir projects/libs/cppdemo/patches/cpp
```

3. Build and verify

```bash
buck2 build //projects/libs/cppdemo:lib
```

4. Remove or iterate

```bash
build-tools/tools/bin/patch-pkg remove cpp pkgs.zlib --target //projects/libs/cppdemo:lib
```

Notes:

- No glue is required for C++; package‑local patch files are included in `srcs` and passed to the Nix C++ derivations.
- `nix_cpp_test(...)` is a split macro (planner-visible stub + executed runner). The planner-visible stub target (`<name>__planner`) also carries package-local `patches/cpp/*.patch` files as real inputs via `srcs`, so patch edits invalidate the planner boundary precisely.
- If your C++ targets link against Go C archives, that integration is handled by the planner/templates and requires no special steps in this workflow.
- C++ macros now use the shared nixpkgs label helper (`append_nixpkg_labels` from `build-tools/lang/defs_common.bzl`) for stamping `nixpkg:` labels. This change only removes duplication; behavior and exported graphs are unchanged.
- Alternative (overlay, opt‑in): You can also manage C++ patches globally under `patches/cpp/*.patch` via the nix overlay entry‑point; see `docs/cpp/overlays.md` for details. The overlay is disabled by default; local patching remains the canonical workflow.
