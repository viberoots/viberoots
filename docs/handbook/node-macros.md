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

- **Escaping**: use `escape_buck_cmd_subst(...)` from `//lang:nix_shell.bzl` to turn `$(...)` into `$$(...)` inside `cmd` strings (Buck genrules treat `$(...)` as a macro).
- **Out path capture**: use `nix_build_out_path_cmd(...)` from `//lang:nix_shell.bzl` to capture a derivation output path without creating GC roots:
  - always use `nix build --no-link --print-out-paths | tail -n1`
  - never use `--out-link`
