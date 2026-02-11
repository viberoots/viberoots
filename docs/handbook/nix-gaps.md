# Nix gaps (public macro inventory)

This document maps every public Starlark macro to its build path. I use it to track where artifact-producing builds are not executed via Nix and where system tool variants can affect outputs.

## Legend

- **Nix build** means the macro calls Nix or a Nix-backed rule.
- **Buck build** means the macro produces artifacts through Buck rules and is still a migration gap.
- **Stub (artifact expected)** means the macro contract expects a build artifact, but the current implementation is still a stub.
- **Probe-only exception** means the macro is intentionally non-build and does not produce a production artifact.

## Go macros

- `nix_go_library` → Nix build (`graph-generator-selected`).
- `nix_go_binary` → Nix build (`graph-generator-selected`).
- `nix_go_test` → Nix build (`graph-generator-selected`).
- `nix_go_carchive` → Nix build (`goCArchive`).
- `nix_go_tiny_wasm_lib` → Nix build (`go_nix_build_wasm`).

Planner coverage note: Go library and binary target kinds are now supported by the Nix planner templates (`goLib` and `goApp`) for `graph-generator-selected`. Macro routing remains Buck until PR-6.

## C++ macros

- `nix_cpp_library` → Nix build (`cpp_nix_build`).
- `nix_cpp_binary` → Nix build (`cpp_nix_build`).
- `nix_cpp_headers` → Nix build (`cpp_nix_build`, planner `cppHeaders`).
- `nix_cpp_test` → Nix build (`cpp_nix_test`).
- `nix_cpp_node_addon` → Nix build (`cpp_nix_build`).
- `nix_cpp_wasm_static_lib` → Nix build (`cpp_nix_build`).
- `nix_cpp_wasm_emscripten_lib` → Nix build (`cpp_nix_build`, planner `cppWasmEmscriptenLib`).
- `cpp_sanitize_probe` → Probe-only exception (test probe).

## Node macros

- `nix_node_gen` → Nix build (`graph-generator-selected` via Node planner `mkGen`).
- `nix_node_test` → Nix build (`node_nix_test`).
- `nix_node_lib` → Nix build (`graph-generator-selected` via Node planner `mkLib`).
- `nix_node_bin` → Nix build (`graph-generator-selected` via Node planner `mkBin`).
- `node_webapp` → Nix build (calls `nix build` in genrule).
- `nix_node_cli_bin` → Mixed:
  - `bundle = False` → Buck build (copy via `genrule`).
  - `bundle = True` → Nix build (calls `nix build` in genrule).
- `node_asset_stage` → Nix build (`nix_node_gen` route).
- `node_wasm_inline_module` → Nix build (`nix_node_gen` route).

Node macro outcome classification:

| Macro                     | Outcome category                 | Current route | Notes                                                            |
| ------------------------- | -------------------------------- | ------------- | ---------------------------------------------------------------- |
| `nix_node_gen`            | artifact-producing               | Nix build     | Routed through Node planner `mkGen` for selected planner builds. |
| `nix_node_test`           | artifact-producing (test)        | Nix build     | Already routed via `node_nix_test`.                              |
| `nix_node_lib`            | artifact-producing               | Nix build     | Routed through Node planner `mkLib` for selected planner builds. |
| `nix_node_bin`            | artifact-producing               | Nix build     | Routed through Node planner `mkBin` for selected planner builds. |
| `node_webapp`             | orchestration wrapper            | Nix build     | Uses `genrule` to call `nix build`.                              |
| `nix_node_cli_bin`        | mixed wrapper/artifact-producing | Mixed         | `bundle = True` is Nix; `bundle = False` remains Buck copy path. |
| `node_asset_stage`        | artifact-producing               | Nix build     | Routes through the Node `nix_node_gen` macro path.               |
| `node_wasm_inline_module` | artifact-producing               | Nix build     | Routes through the Node `nix_node_gen` macro path.               |

## Python macros

- `nix_python_library` → Nix build (`graph-generator-selected`).
- `nix_python_binary` → Nix build (`graph-generator-selected`).
- `nix_python_test` → Nix build (`graph-generator-selected`).
- `nix_python_extension_module` → Nix build (`pyext`).
- `nix_python_wasm_extension_module` → Nix build (`pyext_wasm`).
- `nix_python_wasm_app` → Nix build (`pyWasmApp`).
- `nix_python_wasm_lib` → Nix build (`pyWasmLib`).

Notes on Nix-backed Python outputs:

- I expect binaries to expose `bin/py-<sanitized-target>`.
- I expect tests to expose `bin/pytest-<sanitized-target>`.
- I keep Buck outputs as stamps for libraries; the Nix output still contains `bin/pylib-<sanitized-target>` if needed.

## Rust macros

- `rust_library` → Stub (artifact expected; `genrule`).
- `rust_binary` → Stub (artifact expected; `genrule`).

## Hermeticity risks (non-Nix paths)

Any macro that is a **Buck build** or **Stub (artifact expected)** can be impacted by:

- System tool versions (Go, Python, compiler toolchains).
- Host-specific environment (PATH, locale, OS differences).
- Differences between devshell and non-devshell workflows.

## Exception policy (intentional non-build macros)

These macros are allowed to remain non-build only when they are probe/test-only by design:

- `cpp_sanitize_probe` (test probe only, no production artifact contract).

## Toolchains

- `toolchains.go` → Nix build (flake output).
- `toolchains.python` → Nix build (flake output).
- Buck toolchains read Nix store paths from `toolchains/toolchain_paths.bzl`.
  - Generate with `build-tools/tools/dev/gen-toolchain-paths.ts` (runs during `i`).
  - If the file is missing or points outside `/nix/store`, Buck fails fast.

## References

- `toolchains/TARGETS` uses `system_go_toolchain`.
- `build-tools/go/private/cgo_wiring.bzl` wires `_go_toolchain = "@repo_toolchains//:go"`.
