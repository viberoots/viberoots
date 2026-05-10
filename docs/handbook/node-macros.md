## Node macros (webapp + CLI)

This repo’s Node macros that invoke Nix are intentionally small. They keep Node-specific behavior local, and centralize Nix command assembly (escaping, timeout wrapper, outPath capture) under `//build-tools/lang`.

They also use the shared importer-scoped wiring helpers so lockfile enforcement, importer derivation, importer-local patch inputs, and provider-edge realization stay consistent across Node and Python:

- `//build-tools/lang:defs_common.bzl:prepare_language_wiring(...)` with `wiring = "nix_calling_genrule"` for importer-scoped genrule-style macros that invoke Nix (webapp and bundled CLI).

Buck package boundary note:

Node macros include importer-local patches via `native.glob(...)`. Because Buck cannot glob outside the current package, **any Node target that includes importer-local patches must be defined in the importer package** (for example `projects/apps/web/TARGETS`, not a subpackage like `projects/apps/web/ui/TARGETS`). Subpackage call sites fail fast with deterministic guidance.

### Macros

- **`node_webapp(...)`** (`build-tools/node/defs_nix.bzl`)
  - Builds the importer webapp via Nix (`.#node-webapp.<importer>`) and copies `dist/` into `$OUT`.
  - For `webapp:ssr` targets:
    - `framework:express`, `framework:next`, and `framework:vite` all normalize to `dist/server/index.js` + `dist/client/`.
    - Production startup contract remains one Node command: `node dist/server/index.js`.
    - Missing SSR artifacts fail the build directly. There is no fallback to static hosting behavior.
  - Requires exactly one importer-scoped lockfile label: `lockfile:<path>#<importer>`.
    - If `lockfile_label` is omitted and no `lockfile:` label is present, it defaults to
      `lockfile:<package>/pnpm-lock.yaml#<package>` and fails fast if the lockfile is missing.
  - `lockfile_label` (explicit or defaulted) is the single authoritative source of importer identity.
  - Do not pass a separate `importer` argument. If you do, it must match the lockfile label importer or the macro fails fast.
  - Provide the lockfile label via `lockfile_label=...`. Do not pass a `lockfile:` entry in `labels` (even if it matches), because macros require exactly one lockfile label.

- **`node_vercel_next_artifact(...)`** (`build-tools/node/defs_vercel.bzl`)
  - Builds `.#node-vercel-next.<importer>` through the filtered flake helper and copies the resulting `vercel-prebuilt/` directory into `$OUT`.
  - Consumes the existing `node-webapp` Next SSR output, so `node_webapp` remains the canonical local/protected SSR runtime build and this macro only packages the Vercel Build Output API shape.
  - Requires `vercel.project.json` by default. That file is a Buck action input and declares Vercel project/runtime metadata.
  - Fails closed when app-local `.vercel` state or undeclared `VERCEL_*` environment variables are present.
  - Stamps `kind:app`, `webapp:ssr`, `framework:next`, `deployable:app`, `deployment-component:ssr-webapp`, and `vercel:prebuilt`.
  - Uses the same importer-scoped lockfile contract and optional `importer` consistency check as `node_webapp(...)`.

- **`nix_node_cli_bin(..., bundle=True)`** (`build-tools/node/defs_nix.bzl`)
  - Produces a single-file, shebanged bundle for a Node CLI by building the per-importer flake attr and copying the emitted bundle to `$OUT`.
  - Requires exactly one importer-scoped lockfile label: `lockfile:<path>#<importer>`.
    - If `lockfile_label` is omitted and no `lockfile:` label is present, it defaults to
      `lockfile:<package>/pnpm-lock.yaml#<package>` and fails fast if the lockfile is missing.
  - `lockfile_label` (explicit or defaulted) is the single authoritative source of importer identity.
  - Do not pass a separate `importer` argument. If you do, it must match the lockfile label importer or the macro fails fast.
  - Bundled mode uses a fixed entry today: **`src/index.ts`**.
    - If `entry` is set while `bundle=True`, it must be `src/index.ts` (or omitted).
    - To copy an arbitrary entry file, use `bundle=False`.

- **`nix_node_lib(..., patch_options = {...})`** (`build-tools/node/defs_core.bzl`)
  - Infers transitive Node patch requirements from local patch files in `<importer>/patches/node/*.patch`.
  - Canonical requirement ids are lowercase `<name>@<version>` and use existing filename decoding (`__` -> `/`, split by last `@`).
  - `patch_options` supports per-id overrides:
    - `patch_options = {"debug@4.3.4": {"optional": True}}`
  - Unknown option keys fail macro validation.
  - Unknown ids fail macro validation, except stale optional entries (`optional = True`) which warn and are ignored.
  - Requirements are exported as labels for downstream enforcement:
    - `node_patch_required:<name>@<version>`
    - `node_patch_optional:<name>@<version>`

### Transitive Node patch preflight on build entrypoints

Before Nix build execution, Node build entrypoint macros run read-only transitive patch requirement checks through `build-tools/tools/buck/enforce-node-patch-requirements.ts --check --importer <importer>`.

- Entry points covered:
  - `nix_node_gen` and wrappers (`nix_node_lib`)
  - `node_webapp`
  - `node_vercel_next_artifact`
  - `nix_node_cli_bin` (`bundle=True` and `bundle=False`)
  - `node_asset_stage`
  - `node_wasm_inline_module`
- Policy:
  - Missing required transitive patch ids fail the build.
  - Missing optional transitive patch ids warn and do not fail.
  - Diagnostics include the importer-specific remediation command:
    - `patch-pkg sync-required node --importer <importer>`
- Command assembly is shared via `//build-tools/lang:nix_shell.bzl:nix_calling_node_patch_requirements_preflight(...)`.

### Related: `nix_node_test` (stamp policy)

`nix_node_test(...)` is also Nix-backed, but it is not a genrule-style “macro builds via Nix” command string like `node_webapp` / bundled `nix_node_cli_bin`.

- It still **wires `global_nix_inputs()` as real action inputs** (via `srcs`) so changes like `flake.lock` invalidate tests deterministically.
- It intentionally sets **`stamp=False`** when wiring global inputs to avoid exporter label noise for tests. Correctness must not depend on labels.
- Macro authors should treat this as an importer-scoped, non-genrule, Nix-calling shape and route through `//build-tools/lang:defs_common.bzl:prepare_language_wiring(...)` with `wiring = "non_genrule_nix_calling"`.

See `docs/handbook/node-tests.md` for usage and runner semantics.

### Nix invocation policy (required)

When a Node macro assembles a shell command that invokes Nix:

- **Bootstrap (workspace + flake root)**: use `nix_calling_genrule_bootstrap(...)` from `//build-tools/lang:nix_shell.bzl` so genrule-style macros standardize:
  - optional `build-tools/tools/buck/workspace-root.env` sourcing (for temp repos and sandboxed actions)
  - `WORKSPACE_ROOT`/`REPO_ROOT`/`FLK_ROOT` derivation and validation
  - unified PNPM store handling (`include_pnpm_store=True`) and optional enforcement skip (bundling scenarios)
- **Required env exports**: use the small helpers in `//build-tools/lang:nix_shell.bzl` so call sites don’t drift on env conventions:
  - `nix_calling_env_export_buck_graph_json(...)`
  - `nix_calling_env_export_nix_pnpm_fetch_timeout(...)`
- **Out path capture**: use `nix_calling_genrule_nix_build_out_path_prefix(...)` (or `nix_build_out_path_cmd(...)` for rare cases) from `//build-tools/lang:nix_shell.bzl` to capture a derivation output path without creating GC roots:
  - always use `nix build --no-link --print-out-paths | tail -n1`
  - never use `--out-link`

Debugging:

- Set `VBR_NIX_CALL_DEBUG=1` to enable `set -x` tracing inside Nix-calling genrule commands and to enable verbose diagnostics in the Node CLI bundler shim.

### Dependency parity (package.json vs Buck deps)

I enforce that workspace dependencies in `package.json` are mirrored in Buck `deps` for Node targets in the same importer package. The source of truth is `package.json`. The check uses `build-tools/tools/node/workspace-map.json` to map package names to Buck labels.

`build-tools/tools/node/workspace-map.json` is generated by `build-tools/tools/node/gen-workspace-map.ts` as part of the glue pipeline. I do not edit it by hand.

The install workflow runs a check and prints a warning when drift is detected. CI runs the same check and fails on drift. I fix drift by running:

`node build-tools/tools/buck/enforce-node-deps.ts --fix`
