# PR-1 Relocation Plan (Unified Language Wiring)

I will add a single macro wiring entrypoint under `//lang` and route all macro call sites through it. This keeps patch scope decisions inside the language contract and removes patch-model branching from macro files.

## New entrypoint

- Add `lang/language_wiring.bzl:prepare_language_wiring(...)`.
- Re-export it from `lang/defs_common.bzl` as the canonical wiring helper.

## Call sites to update

- Go macros: `build-tools/go/defs.bzl` (`nix_go_library`, `nix_go_binary`, `nix_go_test`, `nix_go_tiny_wasm_lib`).
- C++ macros: `build-tools/cpp/defs.bzl` (`_cpp_common`), `build-tools/cpp/wasm_defs.bzl` (`nix_cpp_wasm_static_lib`).
- Node macros: `build-tools/node/defs_core.bzl` (`nix_node_gen`, `nix_node_test`), `build-tools/node/defs_nix.bzl` (shared Nix-calling genrule wiring).
- Python macros: `build-tools/python/defs.bzl` (`nix_python_library`, `nix_python_binary`, `nix_python_test`, `nix_python_extension_module`, `nix_python_wasm_*`), `build-tools/python/defs_pyext_wasm.bzl` (`nix_python_wasm_extension_module`).

## Helpers to keep internal

- Package-local: `lang/internal/package_local_wiring.bzl:prepare_package_local_wiring(...)`.
- Importer-scoped: `lang/internal/importer_wiring*.bzl:prepare_importer_*`.
- Package-local WASM: `lang/wasm_package_local_wiring.bzl:prepare_package_local_wasm_wiring(...)`.

## Tests and docs to update

- Add parity and non-mutation tests for the unified entrypoint.
- Update `abstractions.md`, `docs/handbook/macro-stamping-cookbook.md`, and `docs/handbook/adding-language.md` to name the unified entrypoint as canonical and mark per-model helpers as internal.
