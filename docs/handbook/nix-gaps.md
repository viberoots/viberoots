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

Planner coverage note: Go library and binary target kinds are supported by the Nix planner templates (`goLib` and `goApp`) for `graph-generator-selected`, and the public Go macros route through Nix-backed rules.

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

- `nix_node_gen` → Nix build (public wrapper calls `graph-generator-selected`; planner companion uses Node planner `mkGen`).
- `nix_node_test` → Nix build (`node_nix_test`).
- `nix_node_lib` → Nix build (alias of `nix_node_gen` with planner kind `lib` / `mkLib`).
- `nix_node_bin` → Nix build (alias of `nix_node_gen` with planner kind `bin` / `mkBin`).
- `node_webapp` → Nix build (calls `nix build` in genrule).
- `nix_node_cli_bin` → Nix build (calls `nix build` in genrule for both bundle modes).
- `node_asset_stage` → Nix build (`standalone nix-calling genrule route`).
- `node_wasm_inline_module` → Nix build (`standalone nix-calling genrule route`).

Node macro outcome classification:

| Macro                     | Outcome category          | Current route | Notes                                                                   |
| ------------------------- | ------------------------- | ------------- | ----------------------------------------------------------------------- |
| `nix_node_gen`            | artifact-producing        | Nix build     | Public target is a Nix-calling wrapper; planner companion uses `mkGen`. |
| `nix_node_test`           | artifact-producing (test) | Nix build     | Already routed via `node_nix_test`.                                     |
| `nix_node_lib`            | artifact-producing        | Nix build     | Alias of `nix_node_gen` with planner kind `lib` (`mkLib`).              |
| `nix_node_bin`            | artifact-producing        | Nix build     | Alias of `nix_node_gen` with planner kind `bin` (`mkBin`).              |
| `node_webapp`             | orchestration wrapper     | Nix build     | Uses `genrule` to call `nix build`.                                     |
| `nix_node_cli_bin`        | artifact-producing        | Nix build     | Both `bundle = True` and `bundle = False` use Nix-calling routes.       |
| `node_asset_stage`        | artifact-producing        | Nix build     | Uses a standalone Node Nix-calling genrule route with shared wiring.    |
| `node_wasm_inline_module` | artifact-producing        | Nix build     | Uses a standalone Node Nix-calling genrule route with shared wiring.    |

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

- `rust_library` → Nix build (`rust_nix_build`).
- `rust_binary` → Nix build (`rust_nix_build`).

## Hermeticity risks (non-Nix paths)

Any macro that is a **Buck build** or **Stub (artifact expected)** can be impacted by:

- System tool versions (Go, Python, compiler toolchains).
- Host-specific environment (PATH, locale, OS differences).
- Differences between devshell and non-devshell workflows.

## Exception policy (intentional non-build macros)

I keep a machine-checked source of truth at `docs/handbook/nix-gaps-exceptions.json`.
Each exception entry must include:

- `macro`
- `kind` (`probe-only`)
- `justification`

Allowed non-build public macros:

- `cpp_sanitize_probe` (test-only sanitizer probe with no production artifact contract).

## Enforcement gates

I keep machine-checked enforcement in `build-tools/tools/dev/nix-gaps-inventory-check.ts`.
The policy data lives in `docs/handbook/nix-gaps-exceptions.json`:

- `exceptions`: allowed probe-only non-build macros.
- `artifactRouteAllowlist`: temporary non-Nix artifact routes that are still allowed.

Current temporary allowlist entries:

- None.

## Toolchains

- `toolchains.go` → Nix build (flake output).
- `toolchains.python` → Nix build (flake output).
- Buck toolchains read Nix store paths from `toolchains/toolchain_paths.bzl`.
  - Generate with `build-tools/tools/dev/gen-toolchain-paths.ts` (runs during `i`).
  - If the file is missing or points outside `/nix/store`, Buck fails fast.

## References

- `toolchains/TARGETS` uses `system_go_toolchain`.
- `build-tools/go/private/cgo_wiring.bzl` wires `_go_toolchain = "@repo_toolchains//:go"`.
