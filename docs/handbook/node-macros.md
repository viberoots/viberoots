## Node macros (webapp + CLI)

This repo’s Node macros that invoke Nix are intentionally small. They keep Node-specific behavior local, and centralize Nix command assembly (escaping, timeout wrapper, outPath capture) under `//lang`.

They also use the shared importer-scoped wiring helpers so lockfile enforcement, importer derivation, importer-local patch inputs, and provider-edge realization stay consistent across Node and Python:

- `//lang:defs_common.bzl:prepare_importer_nix_calling_genrule_wiring_v2(...)` for importer-scoped genrule-style macros that invoke Nix (webapp and bundled CLI).

Buck package boundary note:

Node macros include importer-local patches via `native.glob(...)`. Because Buck cannot glob outside the current package, **any Node target that includes importer-local patches must be defined in the importer package** (for example `apps/web/TARGETS`, not a subpackage like `apps/web/ui/TARGETS`). Subpackage call sites fail fast with deterministic guidance.

### Macros

- **`node_webapp(...)`** (`node/defs_nix.bzl`)
  - Builds the importer webapp via Nix (`.#node-webapp.<importer>`) and copies `dist/` into `$OUT`.
  - Requires exactly one importer-scoped lockfile label: `lockfile:<path>#<importer>`.

- **`nix_node_cli_bin(..., bundle=True)`** (`node/defs_nix.bzl`)
  - Produces a single-file, shebanged bundle for a Node CLI by building the per-importer flake attr and copying the emitted bundle to `$OUT`.
  - Requires exactly one importer-scoped lockfile label: `lockfile:<path>#<importer>`.
  - Bundled mode uses a fixed entry today: **`src/index.ts`**.
    - If `entry` is set while `bundle=True`, it must be `src/index.ts` (or omitted).
    - To copy an arbitrary entry file, use `bundle=False`.

### Related: `nix_node_test` (stamp policy)

`nix_node_test(...)` is also Nix-backed, but it is not a genrule-style “macro builds via Nix” command string like `node_webapp` / bundled `nix_node_cli_bin`.

- It still **wires `global_nix_inputs()` as real action inputs** (via `srcs`) so changes like `flake.lock` invalidate tests deterministically.
- It intentionally sets **`stamp=False`** when wiring global inputs to avoid exporter label noise for tests. Correctness must not depend on labels.
- Macro authors should treat this as an importer-scoped, non-genrule, Nix-calling shape and route through `//lang:defs_common.bzl:prepare_importer_non_genrule_nix_calling_wiring_v2(...)`.

See `docs/handbook/node-tests.md` for usage and runner semantics.

### Nix invocation policy (required)

When a Node macro assembles a shell command that invokes Nix:

- **Bootstrap (workspace + flake root)**: use `nix_calling_genrule_bootstrap(...)` from `//lang:nix_shell.bzl` so genrule-style macros standardize:
  - optional `tools/buck/workspace-root.env` sourcing (for temp repos and sandboxed actions)
  - `WORKSPACE_ROOT`/`REPO_ROOT`/`FLK_ROOT` derivation and validation
  - unified PNPM store handling (`include_pnpm_store=True`) and optional enforcement skip (bundling scenarios)
- **Required env exports**: use the small helpers in `//lang:nix_shell.bzl` so call sites don’t drift on env conventions:
  - `nix_calling_env_export_buck_graph_json(...)`
  - `nix_calling_env_export_nix_pnpm_fetch_timeout(...)`
- **Out path capture**: use `nix_calling_genrule_nix_build_out_path_prefix(...)` (or `nix_build_out_path_cmd(...)` for rare cases) from `//lang:nix_shell.bzl` to capture a derivation output path without creating GC roots:
  - always use `nix build --no-link --print-out-paths | tail -n1`
  - never use `--out-link`

Debugging:

- Set `BNX_NIX_CALL_DEBUG=1` to enable `set -x` tracing inside Nix-calling genrule commands and to enable verbose diagnostics in the Node CLI bundler shim.
