## Node macros (webapp + CLI)

This repo’s Node macros that invoke Nix are intentionally small. They keep Node-specific behavior local, and centralize Nix command assembly (escaping, timeout wrapper, outPath capture) under `//lang`.

They also use the shared importer-scoped wiring helpers so lockfile enforcement, importer derivation, importer-local patch inputs, and provider-edge realization stay consistent across Node and Python:

- `//lang:importer_wiring.bzl:prepare_importer_non_genrule_wiring(...)`
- `//lang:nix_calling_macros.bzl:wire_global_nix_inputs(...)`

### Macros

- **`node_webapp(...)`** (`node/defs_nix.bzl`)
  - Builds the importer webapp via Nix (`.#node-webapp.<importer>`) and copies `dist/` into `$OUT`.
  - Requires exactly one importer-scoped lockfile label: `lockfile:<path>#<importer>`.

- **`nix_node_cli_bin(..., bundle=True)`** (`node/defs_nix.bzl`)
  - Produces a single-file, shebanged bundle for a Node CLI via the bundler shim.
  - Requires exactly one importer-scoped lockfile label: `lockfile:<path>#<importer>`.
  - Bundled mode uses a fixed entry today: **`src/index.ts`**.
    - If `entry` is set while `bundle=True`, it must be `src/index.ts` (or omitted).
    - To copy an arbitrary entry file, use `bundle=False`.

### Nix invocation policy (required)

When a Node macro assembles a shell command that invokes Nix:

- **Bootstrap (workspace + flake root)**: use `nix_calling_genrule_bootstrap(...)` from `//lang:nix_shell.bzl` so genrule-style macros standardize:
  - optional `tools/buck/workspace-root.env` sourcing (for temp repos and sandboxed actions)
  - `WORKSPACE_ROOT`/`REPO_ROOT`/`FLK_ROOT` derivation and validation
  - unified PNPM store handling (`include_pnpm_store=True`) and optional enforcement skip (bundling scenarios)
- **Out path capture**: use `nix_calling_genrule_nix_build_out_path_prefix(...)` (or `nix_build_out_path_cmd(...)` for rare cases) from `//lang:nix_shell.bzl` to capture a derivation output path without creating GC roots:
  - always use `nix build --no-link --print-out-paths | tail -n1`
  - never use `--out-link`

Debugging:

- Set `BNX_NIX_CALL_DEBUG=1` to enable `set -x` tracing inside Nix-calling genrule commands and to enable verbose diagnostics in the Node CLI bundler shim.
