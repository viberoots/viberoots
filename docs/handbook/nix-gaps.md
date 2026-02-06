# Nix gaps (public macro inventory)

This document maps every public Starlark macro to its build path. I use it to track where builds are not executed via Nix and where system tool variants can affect outputs.

## Legend

- **Nix build** means the macro calls Nix or a Nix-backed rule.
- **Buck build** means the macro calls a Buck rule directly.
- **Stub or probe** means the macro does not build a real artifact.

## Go macros

- `nix_go_library` → Buck build (`go_library`).
- `nix_go_binary` → Buck build (`go_binary`).
- `nix_go_test` → Buck build (`go_test`).
- `nix_go_carchive` → Stub or probe (planner-visible stub).
- `nix_go_tiny_wasm_lib` → Nix build (`go_nix_build_wasm`).

## C++ macros

- `nix_cpp_library` → Nix build (`cpp_nix_build`).
- `nix_cpp_binary` → Nix build (`cpp_nix_build`).
- `nix_cpp_headers` → Stub or probe (planner-visible stub).
- `nix_cpp_test` → Nix build (`cpp_nix_test`).
- `nix_cpp_node_addon` → Nix build (`cpp_nix_build`).
- `nix_cpp_wasm_static_lib` → Nix build (`cpp_nix_build`).
- `nix_cpp_wasm_emscripten_lib` → Stub or probe (planner-visible stub).
- `cpp_sanitize_probe` → Stub or probe (test probe).

## Node macros

- `nix_node_gen` → Buck build (`genrule`). Not Nix unless `cmd` calls Nix.
- `nix_node_test` → Nix build (`node_nix_test`).
- `nix_node_lib` → Buck build (`genrule` via `nix_node_gen`).
- `nix_node_bin` → Buck build (`genrule` via `nix_node_gen`).
- `node_webapp` → Nix build (calls `nix build` in genrule).
- `nix_node_cli_bin` → Mixed:
  - `bundle = False` → Buck build (copy via `genrule`).
  - `bundle = True` → Nix build (calls `nix build` in genrule).
- `node_asset_stage` → Buck build (`genrule`).
- `node_wasm_inline_module` → Buck build (`nix_node_gen` genrule).

## Python macros

- `nix_python_library` → Buck build (`python_library`).
- `nix_python_binary` → Buck build (`python_binary`).
- `nix_python_test` → Buck build (`python_test`).
- `nix_python_extension_module` → Stub or probe (`python_pyext_stub`).
- `nix_python_wasm_extension_module` → Stub or probe (`python_pyext_stub`).
- `nix_python_wasm_app` → Buck build (`python_library`).
- `nix_python_wasm_lib` → Buck build (`python_library`).

## Rust macros

- `rust_library` → Stub or probe (`genrule`).
- `rust_binary` → Stub or probe (`genrule`).

## Hermeticity risks (non-Nix paths)

Any macro that is a **Buck build** or **Stub or probe** can be impacted by:

- System tool versions (Go, Python, compiler toolchains).
- Host-specific environment (PATH, locale, OS differences).
- Differences between devshell and non-devshell workflows.

## References

- `toolchains/TARGETS` uses `system_go_toolchain`.
- `build-tools/go/private/cgo_wiring.bzl` wires `_go_toolchain = "@repo_toolchains//:go"`.
