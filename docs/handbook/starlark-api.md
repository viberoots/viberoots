# Starlark API reference

This reference is a public interface guide for macros used in `TARGETS`. I keep it focused on the call site API. Implementation detail is tracked elsewhere.

## Index

- `@viberoots//build-tools/go:defs.bzl`
  - `nix_go_library`
  - `nix_go_binary`
  - `nix_go_test`
  - `nix_go_carchive`
  - `nix_go_tiny_wasm_lib`
  - `nix_go_tiny_wasm_static_lib`
- `@viberoots//build-tools/cpp:defs.bzl`
  - `nix_cpp_library`
  - `nix_cpp_binary`
  - `nix_cpp_headers`
  - `nix_cpp_test`
  - `nix_cpp_node_addon`
  - `nix_cpp_wasm_static_lib`
  - `nix_cpp_wasm_emscripten_lib`
  - `cpp_sanitize_probe`
- `@viberoots//build-tools/node:defs.bzl`
  - `nix_node_gen`
  - `nix_node_test`
  - `nix_node_lib`
  - `nix_node_bin`
  - `node_webapp`
  - `node_vercel_next_artifact`
  - `node_service_artifact`
  - `nix_node_cli_bin`
  - `node_asset_stage`
  - `node_wasm_inline_module`
- `@viberoots//build-tools/python:defs.bzl`
  - `nix_python_library`
  - `nix_python_binary`
  - `nix_python_test`
  - `nix_python_extension_module`
  - `nix_python_wasm_extension_module`
  - `nix_python_wasm_app`
  - `nix_python_wasm_lib`
- `@viberoots//build-tools/rust:defs.bzl`
  - `rust_library`
  - `rust_static_library`
  - `rust_cdylib`
  - `rust_c_ffi_library`
  - `rust_cxx_bridge_library`
  - `rust_proc_macro`
  - `rust_binary`
  - `rust_test`
  - `tauri_app`
  - `rust_wasm_library`
  - `rust_wasi_binary`
  - `rust_wasm_static_library`
  - `rust_wasm_browser_package`
  - `rust_wasm_component`
  - `rust_python_extension`
  - `rust_python_wasm_extension`
  - `rust_node_addon`

## Planned Route Inventory

These names are loadable public symbols that fail during analysis until their reviewed builders
land. They must not appear in the artifact-producing Index until their builders are reviewed and
enabled.

- `@viberoots//build-tools/rust:defs.bzl`
  - `tauri_android_app` (`loadable-disabled`)
  - `tauri_ios_app` (`loadable-disabled`)
  - `tauri_mobile_suite` (`loadable-disabled`; declares stable `:<name>_desktop`,
    `:<name>_ios`, and `:<name>_android` labels, with mobile labels failing
    `platform-not-enabled` until builders land)

### Disabled mobile Tauri macros

`tauri_ios_app` and `tauri_android_app` declare the final mobile target shape, validate their
contract fields, and export typed Tauri metadata for graph tooling. They are not artifact-producing
routes yet: configured analysis fails with `platform-not-enabled` until the reviewed Android and iOS
builders land.

Shared direct attrs:

- `name`: target name.
- `frontend_dist`: one Buck-built frontend target.
- `crate`: Rust crate name. Defaults to `""` while disabled.
- `srcs`: Rust source files owned by the Tauri target.
- `tauri_root`: `.` or `src-tauri`. Defaults to `.`.
- `tauri_config`: canonical Tauri config path. Defaults to `tauri.conf.json`.
- `resources`: explicit `{"src": "...", "dest": "..."}` mappings; duplicate destinations are
  rejected.
- `capabilities`, `permissions`, `icons`: package-relative source paths. Wildcards and escaping paths
  are rejected.
- `app_commands`, `app_windows`: reviewed command and window identifiers. `app_windows` defaults to
  `["main"]`.
- `tauri_artifact_kind`, `tauri_signing_mode`, `tauri_deployment_eligibility`: mobile artifact
  metadata enums. Release-admitted artifacts must be `release-signed`; debug/local and simulator
  artifacts stay `not-eligible`.

Android-only attrs:

- `android_config`: package-relative Android Tauri config, typically `mobile/android.config.json`.
- `android_project_srcs`: tracked normalized Android project sources such as `gen/mobile/android/**`.
- `android_package`: reverse-DNS Android application id. Also accepted through
  `tauri_package_name`.
- `android_min_sdk`: positive integer, default `24`.
- `android_compile_sdk`: positive integer, default `35`.
- Default metadata: `tauri_artifact_kind = "android-debug-apk"`,
  `tauri_signing_mode = "debug-local"`, and
  `tauri_deployment_eligibility = "not-eligible"`.

iOS-only attrs:

- `ios_config`: package-relative iOS Tauri config, typically `mobile/ios.config.json`.
- `ios_project_srcs`: tracked normalized iOS project sources such as `gen/mobile/ios/**`.
- `ios_bundle_identifier`: reverse-DNS bundle id. Also accepted through `tauri_bundle_identifier`.
- `ios_deployment_target`: iOS deployment target string, default `"17.0"`.
- Default metadata: `tauri_artifact_kind = "ios-simulator-bundle"`,
  `tauri_signing_mode = "unsigned-local"`, and
  `tauri_deployment_eligibility = "not-eligible"`.

`tauri_mobile_suite(name, frontend_dist, **kwargs)` declares stable siblings:
`:<name>_desktop`, `:<name>_ios`, and `:<name>_android`. The desktop sibling is the existing
`tauri_app` route. Mobile siblings use the disabled public mobile macros above. By default, the
suite shares `crate`, `frontend_dist`, `tauri_root`, `tauri_config`, `srcs`, `resources`,
`capabilities`, `permissions`, `icons`, `app_commands`, and `app_windows` across all three
platforms. Use `desktop_overrides`, `ios_overrides`, and `android_overrides` dicts for explicit
per-platform differences, including a different `frontend_dist` or platform identity fields.

The scaffold template keeps desktop-only output by default. Mobile scaffold requests are gated by
the template's mobile opt-in; until later PRs enable that gate, requesting `targets` with `ios` or
`android` fails closed with the platform-not-enabled diagnostic. The template also accepts the
planned mobile identity and SDK fields above plus `include_mobile_release_placeholders`; release
placeholders are an opt-in scaffold surface only and do not make public mobile artifact builds
available.

## Additional public surfaces

These macros are public and loaded from `TARGETS`, but intentionally excluded from the
Index because the Index is consumed by `nix-gaps` inventory checks for artifact-producing
language macro coverage.

- `//build-tools/tools/tests:defs.bzl`
  - `auto_zx_tests` (test target autoload helper)

## `extra_module_providers` in plain English

If you are building normal app/library targets, you can usually ignore this argument.

Simple rule:

- Use `deps` for code your target really uses.
- Use `extra_module_providers` when you need to attach extra context that is not a normal code dependency.

Think of it like this:

- `deps` = "I need this to compile or run."
- `extra_module_providers` = "I also want this target's metadata/context attached."

### Common usage scenarios

#### Scenario A: normal app or library work (most teams)

- Do not set `extra_module_providers`.
- Just use `deps`.

```python
nix_go_library(
    name = "util",
    srcs = ["util.go"],
    deps = [":core"],
)
```

#### Scenario B: custom helper target should travel with this target

- Keep real code deps in `deps`.
- Add the helper in `extra_module_providers`.

```python
nix_cpp_library(
    name = "core",
    srcs = ["src/core.cc"],
    deps = [":headers"],
    extra_module_providers = ["//third_party/providers:build_context"],
)
```

#### Scenario C: shared helper plus package-local helper

- This is common in larger repos with shared conventions plus local package rules.

```python
nix_go_binary(
    name = "server",
    srcs = ["main.go"],
    deps = [":app_lib"],
    extra_module_providers = [
        "//third_party/providers:shared_policy",
        ":local_provider",
    ],
)
```

### Quick checklist

- If you are asking "do I import or run this code?" put it in `deps`.
- If you are asking "do I want extra metadata/context attached?" consider `extra_module_providers`.
- If you are unsure, start without it. Add it only when you have a concrete tooling/graph need.

## Nixpkgs Source Selection

Nix-backed macros that consume `nixpkg_deps` accept source-selection fields:

- `nixpkgs_profile`: string. Defaults to `"default"`. This names the nixpkgs profile used for the
  target's base package universe.
- `nixpkg_pins`: dict. Defaults to `{}`. Pin entries map normalized nixpkgs attrs to an object with
  `nixpkgs_profile` and a non-empty `rationale`.

Example shape:

```python
nix_cpp_library(
    name = "native",
    srcs = ["native.cc"],
    nixpkg_deps = ["pkgs.openssl", "pkgs.zlib"],
    nixpkgs_profile = "default",
    nixpkg_pins = {
        "pkgs.openssl": {
            "nixpkgs_profile": "nixpkgs-23_11",
            "rationale": "Compatibility with a legacy TLS peer during migration.",
        },
    },
)
```

Use `nixpkgs_profile` for target-level source selection. Use `nixpkg_pins` for narrow per-attr
exceptions. Pins redirect attrs already consumed by the selected target; they do not create new
package dependencies. If repeated pins become the common case, move the target to that
`nixpkgs_profile` instead. Selected C++ builds use the target profile for compiler/stdenv and
ordinary unpinned `nixpkg_deps`; pinned attrs resolve from their pin profiles. Go CGO and Python
native-extension nixpkg attrs use the same source-selection resolver, as do C++ Node addons.
BUILD files must not put raw commits or raw flake URLs in these fields.
Consumer workspaces that need an additional named profile can expose the generated lockfile-backed
`nixpkgs_23_11` input through `.viberoots/workspace/nixpkgs-source-registry-extension.nix`;
selected-build, filtered-snapshot, remote source-snapshot, and cache-manifest paths preserve
normalized `nixpkgs_profile` and `nixpkg_pins` profile evidence. Planner inspection output names the
target, base profile, normalized attrs, supplying profiles, resolution kind, and pin rationale where
one applies; raw commits remain in the lockfile or registry evidence instead of default diagnostics.
Regression coverage also keeps profile-local overlays isolated: an overlay attached to one named
profile affects only attrs resolved from that profile, including pinned attrs, and filtered snapshots
fail closed with the registry path when registry evidence is missing.

## Go macros

Load from `@viberoots//build-tools/go:defs.bzl`.

### `nix_go_library(name, **kwargs)`

Use this for a Go library target that other Go targets depend on.

Public args:

- `name` string. Target name.
  - Example: `nix_go_library(name = "util")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `srcs` list of file paths. Go source files.
  - Example: `srcs = ["util.go"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `deps` list of labels. Direct deps for the library.
  - Example: `deps = [":core", "//projects/libs/logging:logging"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `repo_cgo_deps` list of labels. Extra repo local deps needed for CGO.
  - Example: `repo_cgo_deps = ["//third_party:openssl"]`
  - Used for / scenarios: Adds repository-local native dependencies required by CGO builds. Use it when Go code bridges to C/C++ components defined in-repo.
- `extra_module_providers` list of labels. Extra module labels to attach.
  - Example: `extra_module_providers = ["//third_party:zlib"]`
  - Used for / scenarios: Attaches additional module-surface providers to this target. Use it when downstream module discovery needs metadata from auxiliary producers.
- `nix_cgo_pkgconfig` dict. Unsupported. Must be empty if present.
  - Example: `nix_cgo_pkgconfig = {}`
  - Used for / scenarios: Reserved/unsupported CGO pkg-config surface in this repo. Keep empty to satisfy compatibility checks without enabling alternate behavior.

### `nix_go_binary(name, **kwargs)`

Use this for a Go executable built from package sources and deps.

Public args:

- `name` string. Target name.
  - Example: `nix_go_binary(name = "server")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `srcs` list of file paths. Go source files.
  - Example: `srcs = ["main.go"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `deps` list of labels. Direct deps for the binary.
  - Example: `deps = [":app_lib"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `repo_cgo_deps` list of labels. Extra repo local deps needed for CGO.
  - Example: `repo_cgo_deps = ["//third_party:openssl"]`
  - Used for / scenarios: Adds repository-local native dependencies required by CGO builds. Use it when Go code bridges to C/C++ components defined in-repo.
- `extra_module_providers` list of labels. Extra module labels to attach.
  - Example: `extra_module_providers = ["//third_party:zlib"]`
  - Used for / scenarios: Attaches additional module-surface providers to this target. Use it when downstream module discovery needs metadata from auxiliary producers.
- `nix_cgo_pkgconfig` dict. Unsupported. Must be empty if present.
  - Example: `nix_cgo_pkgconfig = {}`
  - Used for / scenarios: Reserved/unsupported CGO pkg-config surface in this repo. Keep empty to satisfy compatibility checks without enabling alternate behavior.

### `nix_go_test(name, **kwargs)`

Use this for Go tests that should run with the repo’s Go tooling and deps.

Public args:

- `name` string. Target name.
  - Example: `nix_go_test(name = "util_test")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `srcs` list of file paths. Go test files.
  - Example: `srcs = ["util_test.go"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `deps` list of labels. Direct deps for the test.
  - Example: `deps = [":util"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `extra_module_providers` list of labels. Optional normalized extra providers merged into deps.
  - Example: `extra_module_providers = ["//third_party/providers:lf_demo"]`
  - Used for / scenarios: Attaches additional module-surface providers to this target. Use it when downstream module discovery needs metadata from auxiliary producers.
- `library` label or string. If set, it points to the library under test.
  - Example: `library = ":util"`
  - Used for / scenarios: Identifies the library-under-test for test wiring and ownership semantics. Use it when test behavior or reporting must point at a canonical library target.
- `link_deps` list of labels. Link deps for test intent.
  - Example: `link_deps = ["//third_party:openssl"]`
  - Used for / scenarios: Declares dependencies that should be linked (not just compiled against). Use it for native/system libs that must be present at link/runtime boundaries.
- `header_deps` list of labels. Header deps for test intent.
  - Example: `header_deps = ["//third_party:zlib"]`
  - Used for / scenarios: Declares dependencies that only provide headers/include paths. Use it when compilation needs headers but link ownership remains elsewhere.
- `link_closure` string. Link closure policy. Default is `direct`.
  - Example: `link_closure = "direct"`
  - Used for / scenarios: Selects whether link dependencies remain direct or expand transitively. Use `direct` for strict minimal link graphs and `transitive` when nested native deps must follow through.
- Allowed values:
  - `direct` uses only the direct `link_deps`.
  - `transitive` follows `link_deps` recursively.
- `link_closure_overrides` dict. Per dep closure overrides.
  - Example: `link_closure_overrides = {"//third_party:openssl": "transitive"}`
  - Used for / scenarios: Overrides `link_closure` for specific dependency edges. Use it when most deps should stay direct but a few must be transitive (or vice versa).
  - Allowed values for each override:
    - `direct` uses only the direct `link_deps` for that dep.
    - `transitive` follows that dep's `link_deps` recursively.

### `nix_go_carchive(name, **kwargs)`

Use this when you need a Go library output suitable for linking from C or C++.
I build via the Nix planner and produce a directory containing `lib/*.a` and `include/*.h`.

Public args:

- `name` string. Target name.
  - Example: `nix_go_carchive(name = "go_carchive")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `deps` list of labels. Direct deps for the archive.
  - Example: `deps = [":core"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `srcs` list of file paths. Go source files (and package-local patch inputs).
  - Example: `srcs = ["main.go"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `extra_module_providers` list of labels. Optional normalized extra providers merged into deps.
  - Example: `extra_module_providers = ["//third_party/providers:lf_demo"]`
  - Used for / scenarios: Attaches additional module-surface providers to this target. Use it when downstream module discovery needs metadata from auxiliary producers.

### `nix_go_tiny_wasm_lib(name, **kwargs)`

Use this for a TinyGo WebAssembly library output.

`nix_go_tiny_wasm_static_lib` uses the same source and link-intent arguments but emits a
deterministic static WebAssembly archive. It requires a package-local `wasm_header`, accepts
`wasm_abi = "bare"`, and publishes exact target, allocator, libc, exception, and link-only runtime
authority for compatible Rust and C++ consumers. A TinyGo WASI static archive is rejected because
its allocator symbols conflict with final WASI runtime ownership. TinyGo module consumers support
bare or WASI and accept reviewed Rust and C++ static producers; TinyGo-to-TinyGo archive linking is
not supported.

Public args:

- `name` string. Target name.
  - Example: `nix_go_tiny_wasm_lib(name = "tiny_wasm")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `srcs` list of file paths. Go source files.
  - Example: `srcs = ["main.go"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `deps` list of labels. Direct deps for the wasm lib.
  - Example: `deps = [":core"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `link_deps` list of labels. Link deps for wasm intent.
  - Example: `link_deps = ["//third_party:openssl"]`
  - Used for / scenarios: Declares dependencies that should be linked (not just compiled against). Use it for native/system libs that must be present at link/runtime boundaries.
- `link_closure` string. Link closure policy. Default is `direct`.
  - Example: `link_closure = "direct"`
  - Used for / scenarios: Selects whether link dependencies remain direct or expand transitively. Use `direct` for strict minimal link graphs and `transitive` when nested native deps must follow through.
- Allowed values:
  - `direct` uses only the direct `link_deps`.
  - `transitive` follows `link_deps` recursively.
- `link_closure_overrides` dict. Per dep closure overrides.
  - Example: `link_closure_overrides = {"//third_party:openssl": "transitive"}`
  - Used for / scenarios: Overrides `link_closure` for specific dependency edges. Use it when most deps should stay direct but a few must be transitive (or vice versa).
  - Allowed values for each override:
    - `direct` uses only the direct `link_deps` for that dep.
    - `transitive` follows that dep's `link_deps` recursively.
- `use_selected_wasm` bool. Select a specific wasm variant produced by the build.
  - Example: `use_selected_wasm = True`
  - Used for / scenarios: Forces selection of the planner-selected wasm variant artifact. Use it when producers emit multiple wasm outputs and call sites need deterministic selection.
- `go_source_roots` list of strings. Optional source roots for generated wasm module-surface metadata.
  - Example: `go_source_roots = ["."]`
  - Used for / scenarios: Declares Go module-surface source roots. Use it when source roots differ from defaults and module metadata must map paths correctly.
- `extra_module_providers` list of labels. Extra module labels to attach.
  - Example: `extra_module_providers = ["//third_party:zlib"]`
  - Used for / scenarios: Attaches additional module-surface providers to this target. Use it when downstream module discovery needs metadata from auxiliary producers.

## C++ macros

Load from `@viberoots//build-tools/cpp:defs.bzl`.

### `nix_cpp_library(name, **kwargs)`

Use this for a C++ library consumed by other C++ targets.

Public args:

- `name` string. Target name.
  - Example: `nix_cpp_library(name = "core")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `srcs` list of file paths. C++ sources.
  - Example: `srcs = ["src/core.cc"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":headers"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `link_deps` list of labels. Link deps.
  - Example: `link_deps = ["//third_party:openssl"]`
  - Used for / scenarios: Declares dependencies that should be linked (not just compiled against). Use it for native/system libs that must be present at link/runtime boundaries.
- `header_deps` list of labels. Header deps.
  - Example: `header_deps = ["//third_party:zlib"]`
  - Used for / scenarios: Declares dependencies that only provide headers/include paths. Use it when compilation needs headers but link ownership remains elsewhere.
- `link_mode` string. `static` or `shared`. Default is `static`.
  - Example: `link_mode = "shared"`
  - Used for / scenarios: Chooses static vs shared linkage strategy. Use static for hermetic distribution and shared when ABI/dynamic loading requirements demand it.
- Allowed values:
  - `static` produces a static library.
  - `shared` produces a shared library.
- `link_kind` string. Legacy alias for `link_mode`.
  - Example: `link_kind = "static"`
  - Used for / scenarios: Legacy spelling of `link_mode`. Use only for compatibility with existing call sites during migration.
  - Allowed values:
    - `static` produces a static library.
    - `shared` produces a shared library.
- `link_closure` string. Link closure policy. Default is `direct`.
  - Example: `link_closure = "direct"`
  - Used for / scenarios: Selects whether link dependencies remain direct or expand transitively. Use `direct` for strict minimal link graphs and `transitive` when nested native deps must follow through.
- Allowed values:
  - `direct` uses only the direct `link_deps`.
  - `transitive` follows `link_deps` recursively.
- `link_closure_overrides` dict. Per dep closure overrides.
  - Example: `link_closure_overrides = {"//third_party:openssl": "transitive"}`
  - Used for / scenarios: Overrides `link_closure` for specific dependency edges. Use it when most deps should stay direct but a few must be transitive (or vice versa).
  - Allowed values for each override:
    - `direct` uses only the direct `link_deps` for that dep.
    - `transitive` follows that dep's `link_deps` recursively.
- `extra_module_providers` list of labels. Extra module labels to attach.
  - Example: `extra_module_providers = ["//third_party:zlib"]`
  - Used for / scenarios: Attaches additional module-surface providers to this target. Use it when downstream module discovery needs metadata from auxiliary producers.

### `nix_cpp_binary(name, **kwargs)`

Use this for a C++ executable.

Public args:

- `name` string. Target name.
  - Example: `nix_cpp_binary(name = "app")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `srcs` list of file paths. C++ sources.
  - Example: `srcs = ["src/main.cc"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `link_deps` list of labels. Link deps.
  - Example: `link_deps = ["//third_party:openssl"]`
  - Used for / scenarios: Declares dependencies that should be linked (not just compiled against). Use it for native/system libs that must be present at link/runtime boundaries.
- `header_deps` list of labels. Header deps.
  - Example: `header_deps = ["//third_party:zlib"]`
  - Used for / scenarios: Declares dependencies that only provide headers/include paths. Use it when compilation needs headers but link ownership remains elsewhere.
- `link_mode` string. `static` or `shared`. Default is `static`.
  - Example: `link_mode = "static"`
  - Used for / scenarios: Chooses static vs shared linkage strategy. Use static for hermetic distribution and shared when ABI/dynamic loading requirements demand it.
- Allowed values:
  - `static` produces a static library or binary.
  - `shared` produces a shared library.
- `link_kind` string. Legacy alias for `link_mode`.
  - Example: `link_kind = "static"`
  - Used for / scenarios: Legacy spelling of `link_mode`. Use only for compatibility with existing call sites during migration.
  - Allowed values:
    - `static` produces a static library or binary.
    - `shared` produces a shared library.
- `link_closure` string. Link closure policy. Default is `direct`.
  - Example: `link_closure = "direct"`
  - Used for / scenarios: Selects whether link dependencies remain direct or expand transitively. Use `direct` for strict minimal link graphs and `transitive` when nested native deps must follow through.
- Allowed values:
  - `direct` uses only the direct `link_deps`.
  - `transitive` follows `link_deps` recursively.
- `link_closure_overrides` dict. Per dep closure overrides.
  - Example: `link_closure_overrides = {"//third_party:openssl": "transitive"}`
  - Used for / scenarios: Overrides `link_closure` for specific dependency edges. Use it when most deps should stay direct but a few must be transitive (or vice versa).
  - Allowed values for each override:
    - `direct` uses only the direct `link_deps` for that dep.
    - `transitive` follows that dep's `link_deps` recursively.
- `extra_module_providers` list of labels. Extra module labels to attach.
  - Example: `extra_module_providers = ["//third_party:zlib"]`
  - Used for / scenarios: Attaches additional module-surface providers to this target. Use it when downstream module discovery needs metadata from auxiliary producers.

### `nix_cpp_headers(name, **kwargs)`

Use this for header-only C++ libraries where no binary artifact is needed.

Public args:

- `name` string. Target name.
  - Example: `nix_cpp_headers(name = "headers")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `srcs` list of file paths. Header files.
  - Example: `srcs = ["include/core.h"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `link_deps` list of labels. Link deps.
  - Example: `link_deps = ["//third_party:openssl"]`
  - Used for / scenarios: Declares dependencies that should be linked (not just compiled against). Use it for native/system libs that must be present at link/runtime boundaries.
- `header_deps` list of labels. Header deps.
  - Example: `header_deps = ["//third_party:zlib"]`
  - Used for / scenarios: Declares dependencies that only provide headers/include paths. Use it when compilation needs headers but link ownership remains elsewhere.
- `link_mode` string. Must not be `shared`.
  - Example: `link_mode = "static"`
  - Used for / scenarios: Chooses static vs shared linkage strategy. Use static for hermetic distribution and shared when ABI/dynamic loading requirements demand it.
- `link_kind` string. Legacy alias for `link_mode`.
  - Example: `link_kind = "static"`
  - Used for / scenarios: Legacy spelling of `link_mode`. Use only for compatibility with existing call sites during migration.
- Allowed values:
  - `static` produces a header only target.
  - `shared` is invalid for header only targets.
- `link_closure` string. Link closure policy. Default is `direct`.
  - Example: `link_closure = "direct"`
  - Used for / scenarios: Selects whether link dependencies remain direct or expand transitively. Use `direct` for strict minimal link graphs and `transitive` when nested native deps must follow through.
- Allowed values:
  - `direct` uses only the direct `link_deps`.
  - `transitive` follows `link_deps` recursively.

### `nix_cpp_test(name, **kwargs)`

Use this for C++ tests.

Public args:

- `name` string. Target name.
  - Example: `nix_cpp_test(name = "core_test")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `srcs` list of file paths. C++ test sources.
  - Example: `srcs = ["tests/core_test.cc"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `link_deps` list of labels. Link deps.
  - Example: `link_deps = ["//third_party:openssl"]`
  - Used for / scenarios: Declares dependencies that should be linked (not just compiled against). Use it for native/system libs that must be present at link/runtime boundaries.
- `header_deps` list of labels. Header deps.
  - Example: `header_deps = ["//third_party:zlib"]`
  - Used for / scenarios: Declares dependencies that only provide headers/include paths. Use it when compilation needs headers but link ownership remains elsewhere.
- `link_mode` string. `static` or `shared`. Default is `static`.
  - Example: `link_mode = "static"`
  - Used for / scenarios: Chooses static vs shared linkage strategy. Use static for hermetic distribution and shared when ABI/dynamic loading requirements demand it.
- `link_kind` string. Legacy alias for `link_mode`.
  - Example: `link_kind = "static"`
  - Used for / scenarios: Legacy spelling of `link_mode`. Use only for compatibility with existing call sites during migration.
- Allowed values:
  - `static` produces a static binary.
  - `shared` produces a shared library test binary.
- `link_closure` string. Link closure policy. Default is `direct`.
  - Example: `link_closure = "direct"`
  - Used for / scenarios: Selects whether link dependencies remain direct or expand transitively. Use `direct` for strict minimal link graphs and `transitive` when nested native deps must follow through.
- Allowed values:
  - `direct` uses only the direct `link_deps`.
  - `transitive` follows `link_deps` recursively.
- `link_closure_overrides` dict. Per dep closure overrides.
  - Example: `link_closure_overrides = {"//third_party:openssl": "transitive"}`
  - Used for / scenarios: Overrides `link_closure` for specific dependency edges. Use it when most deps should stay direct but a few must be transitive (or vice versa).
  - Allowed values for each override:
    - `direct` uses only the direct `link_deps` for that dep.
    - `transitive` follows that dep's `link_deps` recursively.

### `nix_cpp_node_addon(name, **kwargs)`

Use this for Node-API addons implemented in C++.

Public args:

- `name` string. Target name.
  - Example: `nix_cpp_node_addon(name = "native_addon")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `addon_name` string. Optional name used by packaging.
  - Example: `addon_name = "my_addon"`
  - Used for / scenarios: Sets packaged Node addon name distinct from target name. Use it when runtime import/name expectations differ from Buck label naming.
- `srcs` list of file paths. C++ sources.
  - Example: `srcs = ["src/addon.cc"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `link_deps` list of labels. Link deps.
  - Example: `link_deps = ["//third_party:openssl"]`
  - Used for / scenarios: Declares dependencies that should be linked (not just compiled against). Use it for native/system libs that must be present at link/runtime boundaries.
- `header_deps` list of labels. Header deps.
  - Example: `header_deps = ["//third_party:zlib"]`
  - Used for / scenarios: Declares dependencies that only provide headers/include paths. Use it when compilation needs headers but link ownership remains elsewhere.
- `link_mode` string. `static` or `shared`. Default is `static`.
  - Example: `link_mode = "shared"`
  - Used for / scenarios: Chooses static vs shared linkage strategy. Use static for hermetic distribution and shared when ABI/dynamic loading requirements demand it.
- `link_kind` string. Legacy alias for `link_mode`.
  - Example: `link_kind = "shared"`
  - Used for / scenarios: Legacy spelling of `link_mode`. Use only for compatibility with existing call sites during migration.
- `link_closure` string. Link closure policy. Default is `direct`.
  - Example: `link_closure = "direct"`
  - Used for / scenarios: Selects whether link dependencies remain direct or expand transitively. Use `direct` for strict minimal link graphs and `transitive` when nested native deps must follow through.
- `link_closure_overrides` dict. Per dep closure overrides.
  - Example: `link_closure_overrides = {"//third_party:openssl": "transitive"}`
  - Used for / scenarios: Overrides `link_closure` for specific dependency edges. Use it when most deps should stay direct but a few must be transitive (or vice versa).
- `extra_module_providers` list of labels. Extra module labels to attach.
  - Example: `extra_module_providers = ["//third_party:zlib"]`
  - Used for / scenarios: Attaches additional module-surface providers to this target. Use it when downstream module discovery needs metadata from auxiliary producers.

### `nix_cpp_wasm_static_lib(name, **kwargs)`

Use this for a C++ static library compiled to WebAssembly.

Public args:

- `name` string. Target name.
  - Example: `nix_cpp_wasm_static_lib(name = "core_wasm")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `srcs` list of file paths. C++ sources.
  - Example: `srcs = ["src/core.cc"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `wasm_abi` string. `bare` or `wasi`. Default is `bare`.
  - Example: `wasm_abi = "wasi"`
  - Used for / scenarios: Chooses the target wasm ABI. Use `bare` for minimal wasm runtimes and `wasi` for WASI host environments and syscalls.
- Allowed values:
  - `bare` builds for `wasm32-unknown-unknown`.
  - `wasi` builds for `wasm32-wasi`.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `link_deps` list of labels. Link deps.
  - Example: `link_deps = ["//third_party:openssl"]`
  - Used for / scenarios: Declares dependencies that should be linked (not just compiled against). Use it for native/system libs that must be present at link/runtime boundaries.
- `header_deps` list of labels. Header deps.
  - Example: `header_deps = ["//third_party:zlib"]`
  - Used for / scenarios: Declares dependencies that only provide headers/include paths. Use it when compilation needs headers but link ownership remains elsewhere.
- `cpp_source_roots` list of strings. Optional source roots for generated wasm module-surface metadata.
  - Example: `cpp_source_roots = ["."]`
  - Used for / scenarios: Declares C++ module-surface source roots. Use it when generated metadata should resolve headers/sources from non-default roots.

### `nix_cpp_wasm_emscripten_lib(name, **kwargs)`

Use this for Emscripten builds that produce JS and WASM outputs.

Public args:

- `name` string. Target name.
  - Example: `nix_cpp_wasm_emscripten_lib(name = "core_ems")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `srcs` list of file paths. Source files.
  - Example: `srcs = ["src/lib.cc"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `link_deps` list of labels. Link deps.
  - Example: `link_deps = ["//third_party:openssl"]`
  - Used for / scenarios: Declares dependencies that should be linked (not just compiled against). Use it for native/system libs that must be present at link/runtime boundaries.
- `header_deps` list of labels. Header deps.
  - Example: `header_deps = ["//third_party:zlib"]`
  - Used for / scenarios: Declares dependencies that only provide headers/include paths. Use it when compilation needs headers but link ownership remains elsewhere.
- `exported_functions` list of strings. Optional Emscripten export list.
  - Example: `exported_functions = ["_malloc", "_free"]`
  - Used for / scenarios: Declares the exported symbol list for Emscripten outputs. Use it to control JS-callable/native-visible surface and avoid over-exporting.

### `cpp_sanitize_probe(name, label)`

Use this for sanitizer parity probes in tests.

Public args:

- `name` string. Target name.
  - Example: `cpp_sanitize_probe(name = "sanitize_probe", label = "//foo:bar")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `label` string. Label to sanitize for the probe.
  - Example: `label = "//foo:bar"`
  - Used for / scenarios: Provides the raw label string to sanitize in probe macros. Use it for parity/normalization tests of label handling behavior.

## Node macros

Load from `@viberoots//build-tools/node:defs.bzl`.

### `nix_node_gen(name, srcs = [], out = None, cmd = None, deps = [], labels = [], lockfile_label = None, patch_options = None, kind = "gen", **kwargs)`

Use this for Node artifact-producing generators that run through the Nix selected planner path.
The public target is a Nix-calling wrapper; a planner companion target retains the original `cmd`.

Public args:

- `name` string. Target name.
  - Example: `nix_node_gen(name = "gen_file")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `srcs` list of labels or files. Inputs for the genrule.
  - Example: `srcs = ["src/index.ts"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `out` string. Output filename.
  - Example: `out = "index.out"`
  - Used for / scenarios: Names the produced output file or directory. Use it to match downstream contract paths and packaging expectations.
- `cmd` string. Shell command executed by the planner companion target.
  - Example: `cmd = "cp $(location src/index.ts) $OUT"`
  - Used for / scenarios: Defines the shell command executed by the planner/helper target. Use it when artifact generation is custom rather than fully macro-derived.
- `deps` list of labels. Direct deps for the genrule.
  - Example: `deps = [":tools"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:web"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"`
  - Used for / scenarios: Pins dependency resolution context to an importer lockfile. Use it whenever Node/Python macros must resolve third-party deps for a specific workspace importer.
- `patch_options` dict. Optional per-patch behavior overrides for importer-local Node patches.
  - Example: `patch_options = {"lodash@4.17.21": {"optional": true}}`
  - Used for / scenarios: Configures per-patch requirement policy (for example optional vs required). Use it when importer-local patch sets vary by environment or rollout stage.
- `kind` string. Optional kind label value. Default is `gen`.
  - Example: `kind = "gen"`
  - Used for / scenarios: Sets the `kind:*` classification label for the target. Use it to align with policy, discovery, and contract tooling expectations.
- Allowed values:
  - `addon` Node add-on artifact.
  - `app` application target.
  - `bin` executable target.
  - `bundle` bundled artifact.
  - `carchive` Go c-archive target.
  - `gen` generic generator target.
  - `headers` header-only target.
  - `lib` library target.
  - `packaging` packaging step target.
  - `pyext` Python extension module target.
  - `pyext_wasm` Python wasm extension module target.
  - `probe` test probe target.
  - `test` test target.
  - `wasm` wasm target.

### `nix_node_test(name, srcs = [], out = None, cmd = None, patterns = None, env = {}, timeout_sec = 600, deps = [], labels = [], lockfile_label = None, kind = "test", **kwargs)`

Use this for Node tests.

Public args:

- `name` string. Target name.
  - Example: `nix_node_test(name = "unit_tests")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `patterns` list of strings. Test file patterns.
  - Example: `patterns = ["**/*.test.ts"]`
  - Used for / scenarios: Defines test file globs for node test execution. Use it to scope which tests run in large packages or mixed test layouts.
- `env` dict. Environment variables for the test runner.
  - Example: `env = {"NODE_ENV": "test"}`
  - Used for / scenarios: Supplies environment variables for the test process. Use it when tests need explicit runtime toggles, ports, or backend markers.
- `timeout_sec` int. Timeout in seconds. Default is `600`.
  - Example: `timeout_sec = 300`
  - Used for / scenarios: Sets per-test timeout budget in seconds. Use higher values for integration/e2e flows and lower values to fail fast on unit suites.
- `srcs` list of labels or files. Inputs for the test rule.
  - Example: `srcs = ["src/index.ts"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `out` string. Output filename for the stamp file.
  - Example: `out = "unit_tests.stamp"`
  - Used for / scenarios: Names the produced output file or directory. Use it to match downstream contract paths and packaging expectations.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":lib"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:web"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"`
  - Used for / scenarios: Pins dependency resolution context to an importer lockfile. Use it whenever Node/Python macros must resolve third-party deps for a specific workspace importer.
- `kind` string. Optional kind label value. Default is `test`.
  - Example: `kind = "test"`
  - Used for / scenarios: Sets the `kind:*` classification label for the target. Use it to align with policy, discovery, and contract tooling expectations.
- Allowed values:
  - `addon` Node add-on artifact.
  - `app` application target.
  - `bin` executable target.
  - `bundle` bundled artifact.
  - `carchive` Go c-archive target.
  - `gen` generic generator target.
  - `headers` header-only target.
  - `lib` library target.
  - `packaging` packaging step target.
  - `pyext` Python extension module target.
  - `pyext_wasm` Python wasm extension module target.
  - `probe` test probe target.
  - `test` test target.
  - `wasm` wasm target.
- `cmd` string. Accepted but ignored by the runner.
  - Example: `cmd = "unused"`
  - Used for / scenarios: Defines the shell command executed by the planner/helper target. Use it when artifact generation is custom rather than fully macro-derived.

### `nix_node_lib(name, patch_options = None, **kwargs)`

Use this for Node library targets that produce generated artifacts.
This is an alias of `nix_node_gen(..., kind = "lib")`.

Public args:

- `name` string. Target name.
  - Example: `nix_node_lib(name = "node_lib")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `patch_options` dict. Optional per-patch behavior overrides.
  - Example: `patch_options = {"lodash@4.17.21": {"optional": true}}`
  - Used for / scenarios: Configures per-patch requirement policy (for example optional vs required). Use it when importer-local patch sets vary by environment or rollout stage.
- `ts_module_roots` list of strings. Optional TypeScript source roots used for module surface metadata.
  - Example: `ts_module_roots = ["src", "generated"]`
  - Used for / scenarios: Declares TypeScript module-surface roots. Use it when module metadata should be generated from specific source trees.
- `srcs` list of labels or files. Inputs.
  - Example: `srcs = ["src/index.ts"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `out` string. Output filename.
  - Example: `out = "lib.out"`
  - Used for / scenarios: Names the produced output file or directory. Use it to match downstream contract paths and packaging expectations.
- `cmd` string. Shell command to run.
  - Example: `cmd = "cp $(location src/index.ts) $OUT"`
  - Used for / scenarios: Defines the shell command executed by the planner/helper target. Use it when artifact generation is custom rather than fully macro-derived.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":shared"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:web"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"`
  - Used for / scenarios: Pins dependency resolution context to an importer lockfile. Use it whenever Node/Python macros must resolve third-party deps for a specific workspace importer.

### `nix_node_bin(name, **kwargs)`

Use this for Node targets that produce an executable file.
This is an alias of `nix_node_gen(..., kind = "bin")`.

Public args:

- `name` string. Target name.
  - Example: `nix_node_bin(name = "node_bin")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `srcs` list of labels or files. Inputs.
  - Example: `srcs = ["src/cli.ts"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `out` string. Output filename.
  - Example: `out = "cli.out"`
  - Used for / scenarios: Names the produced output file or directory. Use it to match downstream contract paths and packaging expectations.
- `cmd` string. Shell command to run.
  - Example: `cmd = "cp $(location src/cli.ts) $OUT"`
  - Used for / scenarios: Defines the shell command executed by the planner/helper target. Use it when artifact generation is custom rather than fully macro-derived.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":lib"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:web"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"`
  - Used for / scenarios: Pins dependency resolution context to an importer lockfile. Use it whenever Node/Python macros must resolve third-party deps for a specific workspace importer.

### `node_webapp(name, deps = [], labels = [], lockfile_label = None, importer = None, out = None, ts_module_roots = ["src/ts-modules"], **kwargs)`

Use this for Vite-style web apps built from a Node workspace.

Public args:

- `name` string. Target name.
  - Example: `node_webapp(name = "webapp")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `deps` list of labels. Optional direct deps.
  - Example: `deps = [":web_runtime"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:web"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"`
  - Used for / scenarios: Pins dependency resolution context to an importer lockfile. Use it whenever Node/Python macros must resolve third-party deps for a specific workspace importer.
- `importer` string. Optional package name. Must match the lockfile label suffix.
  - Example: `importer = "projects/apps/web"`
  - Used for / scenarios: Pins an explicit importer package path for lockfile-coupled macros. Use it when auto-inference is ambiguous or when wiring must be explicit in shared helpers.
- `out` string. Output directory name. Default is `dist`.
  - Example: `out = "dist"`
  - Used for / scenarios: Names the produced output file or directory. Use it to match downstream contract paths and packaging expectations.
- `ts_module_roots` list of strings. TypeScript module roots for generated module-surface metadata.
  - Example: `ts_module_roots = ["src/ts-modules"]`
  - Used for / scenarios: Declares TypeScript module-surface roots. Use it when module metadata should be generated from specific source trees.

### `node_vercel_next_artifact(name, labels = [], lockfile_label = None, importer = None, vercel_config = "vercel.project.json", out = None, **kwargs)`

Use this for Next SSR apps that need a Vercel Build Output API artifact.

Public args:

- `name` string. Target name.
  - Example: `node_vercel_next_artifact(name = "vercel_artifact")`
  - Used for / scenarios: Defines the deployable prebuilt artifact label for a Next SSR app.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:web"]`
  - Used for / scenarios: Adds ownership or selection metadata. The macro already stamps `kind:app`, `webapp:ssr`, `framework:next`, `deployable:app`, `deployment-component:ssr-webapp`, and `vercel:prebuilt`.
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"`
  - Used for / scenarios: Pins dependency resolution context to the app importer lockfile.
- `importer` string. Optional package name. Must match the lockfile label suffix.
  - Example: `importer = "projects/apps/web"`
  - Used for / scenarios: Pins an explicit importer package path when wiring must be checked directly.
- `vercel_config` string. Declared Vercel artifact config file. Defaults to `vercel.project.json`.
  - Example: `vercel_config = "vercel.project.json"`
  - Used for / scenarios: Declares project/runtime metadata as a Buck action input. Ambient `.vercel` state and undeclared `VERCEL_*` variables fail the build.
- `out` string. Output directory name. Default is `vercel-prebuilt`.
  - Example: `out = "vercel-prebuilt"`
  - Used for / scenarios: Names the directory containing `.vercel/output` and `artifact-identity.json`.

### `nix_node_cli_bin(name, entry = None, out = None, labels = [], deps = [], lockfile_label = None, bundle = False, importer = None, **kwargs)`

Use this for Node command line tools. Choose `bundle = True` when you want a single file output.

Public args:

- `name` string. Target name.
  - Example: `nix_node_cli_bin(name = "cli")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `entry` string. Entry file for the CLI. Defaults to `bin/<name>` when `bundle = False`. Must be `src/index.ts` when `bundle = True`.
  - Example: `entry = "bin/cli"`
  - Used for / scenarios: Selects the CLI entrypoint source file. Use it when the default entry convention does not match your package layout.
- `out` string. Output filename. Defaults to `name`.
  - Example: `out = "my-cli"`
  - Used for / scenarios: Names the produced output file or directory. Use it to match downstream contract paths and packaging expectations.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:web"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":lib"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"`
  - Used for / scenarios: Pins dependency resolution context to an importer lockfile. Use it whenever Node/Python macros must resolve third-party deps for a specific workspace importer.
- `bundle` bool. Use a bundled Nix build when true.
  - Example: `bundle = True`
  - Used for / scenarios: Switches between copy-style CLI output and bundled single-file output. Use `True` for distributable single artifacts and `False` for simple local wrappers.
- Allowed values:
  - `False` copies the entry file to the output.
  - `True` builds a single file bundle.
- `importer` string. Optional package name. Must match the lockfile label suffix.
  - Example: `importer = "projects/apps/web"`
  - Used for / scenarios: Pins an explicit importer package path for lockfile-coupled macros. Use it when auto-inference is ambiguous or when wiring must be explicit in shared helpers.

### `node_asset_stage(name, app, assets = [], out = None, deps = [], wasm_module_roots = [], module_deps = [], module_surface_deps = [], **kwargs)`

Use this to stage a webapp output with extra assets into one directory.

Public args:

- `name` string. Target name.
  - Example: `node_asset_stage(name = "web_assets")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `app` same-cell target label. Webapp output to copy.
  - Example: `app = ":webapp"`
  - Used for / scenarios: Points staging to the primary webapp output to copy. Use it as the base artifact before adding runtime assets or rewrites.
- `assets` list of dicts. Each item requires `src` and `dest`, and may set one selector.
  - Example: `assets = [{"src": "//assets:logo", "dest": "img/logo.svg"}]`
  - Used for / scenarios: Declares additional staged assets and destination paths. Use it to normalize runtime contracts (browser/server/inline) across producer output shapes.
  - Optional selector keys:
    - `artifact_name` string. Exact wasm filename when `src` resolves to a directory.
      - Example: `{"src": "//libs:py_wasm", "artifact_name": "pyext.wasm", "dest": "wasm/py.wasm"}`
    - `artifact_glob` string. Glob selector for controlled unstable names when `src` resolves to a directory.
      - Example: `{"src": "//libs:wasm_out", "artifact_glob": "module-*.wasm", "dest": "wasm/module.wasm"}`
    - `source_path` string. Exact repository-relative source for a raw `export_file` label.
    - `output_path` string. Exact artifact-relative output for a generated raw-file target.
    - `kind` string (`file` or `wasm`). Required when an extensionless asset is ambiguous.
  - Do not set both `artifact_name` and `artifact_glob` on the same asset.
- Directory resolution defaults when no selector is set:
  - Prefer `top.wasm` when present.
  - Otherwise require exactly one `*.wasm` match (scan bounded to directory, one level, and two levels).
  - Fail deterministically on zero or multiple matches with a disambiguation message.
- `out` string. Output directory name. Default is `dist`.
  - Example: `out = "dist"`
  - Used for / scenarios: Names the produced output file or directory. Use it to match downstream contract paths and packaging expectations.
- `deps` list of labels. Optional direct deps.
  - Example: `deps = [":app_raw"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `wasm_module_roots` list of strings. Optional wasm source roots for generated module-surface metadata.
  - Example: `wasm_module_roots = ["src/wasm-producer"]`
  - Used for / scenarios: Declares wasm source roots for module-surface metadata. Use it when wasm producers live outside default locations.
- `module_deps` list of labels. Optional module deps that are normalized and mapped to `__surface` deps.
  - Example: `module_deps = ["//projects/libs/demo-wasm"]`
  - Used for / scenarios: Declares high-level module dependencies that are normalized into surface deps. Use it for ergonomic wiring from producer targets to module metadata consumers.
- `module_surface_deps` list of labels. Optional explicit surface deps merged with inferred `module_deps`.
  - Example: `module_surface_deps = ["//projects/libs/demo-wasm:demo-wasm__surface"]`
  - Used for / scenarios: Declares explicit module surface dependencies. Use it when you need precise control beyond inferred `module_deps` mapping.
- Common `**kwargs` include `labels` and `lockfile_label`.

### `node_wasm_inline_module(name, src, out = None, artifact_name = None, artifact_glob = None, labels = [], lockfile_label = None, **kwargs)`

Use this to wrap a wasm file into a JS module for Node usage.

Public args:

- `name` string. Target name.
  - Example: `node_wasm_inline_module(name = "inline_wasm")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `src` label or path string. Wasm file input.
  - Example: `src = ":core_wasm"`
  - Used for / scenarios: Controls `src` for this macro. Use it when the default behavior does not match your package layout, dependency graph, or runtime contract.
- `out` string. Output filename. Default is `index.js`.
  - Example: `out = "inline.js"`
  - Used for / scenarios: Names the produced output file or directory. Use it to match downstream contract paths and packaging expectations.
- `artifact_name` string. Exact wasm filename when `src` resolves to a directory.
  - Example: `artifact_name = "cpp_emscripten.wasm"`
  - Used for / scenarios: Selects an exact artifact filename when a source resolves to a directory. Use it when directory outputs contain multiple wasm files and selection must be explicit.
- `artifact_glob` string. Glob selector for controlled unstable names when `src` resolves to a directory.
  - Example: `artifact_glob = "module-*.wasm"`
  - Used for / scenarios: Selects artifacts by glob when names include controlled variability. Use it for versioned/hash-suffixed outputs where exact names are not stable.
- Do not set both `artifact_name` and `artifact_glob`.
- Directory resolution defaults when no selector is set:
  - Prefer `top.wasm` when present.
  - Otherwise require exactly one `*.wasm` match (bounded scan).
  - Fail deterministically on zero or multiple matches with a clear selector hint.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:web"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"`
  - Used for / scenarios: Pins dependency resolution context to an importer lockfile. Use it whenever Node/Python macros must resolve third-party deps for a specific workspace importer.

### End-to-end webapp WASM examples

These examples show complete wiring for webapps that need runtime WASM assets plus an inline module.
Contract notes for all examples:

- `top.wasm` is the canonical browser-runtime filename expected by the client helper (`new URL("/top.wasm", ...)`).
- `server/wasm/<default-module>.wasm` is the canonical server-side runtime path used by SSR runtimes.
- Producer outputs can keep their native filename (for example `lib/top.wasm` or `pyext.wasm`), while `node_asset_stage(..., dest = ".../top.wasm")` normalizes the runtime path.

#### Augmenting scaffolded webapp templates

Scaffolded webapps start with no wasm modules (`assets = []` in `node_asset_stage(...)`).
Use these patterns to add runtime wasm/ts wiring incrementally.

#### Scenario 1: add wasm dependencies from other targets

```python
# TARGETS (in a scaffolded app package)
load("@viberoots//build-tools/node:defs.bzl", "node_asset_stage", "node_wasm_inline_module", "node_webapp")
load("@viberoots//build-tools/python:defs.bzl", "nix_python_wasm_lib")

nix_python_wasm_lib(
    name = "py_wasm",
    labels = ["backend:pyodide"],
)

node_webapp(name = "app_raw")

node_wasm_inline_module(
    name = "py_wasm_inline",
    src = ":py_wasm",
)

node_asset_stage(
    name = "app",
    app = ":app_raw",
    assets = [
        {"src": ":py_wasm", "dest": "top.wasm"},
        {"src": ":py_wasm_inline", "dest": "wasm-inline/py.js"},
        {"src": ":py_wasm", "dest": "server/wasm/top.wasm"},
    ],
)
```

#### Scenario 2: add TypeScript module dependencies (module-surface tracking)

```python
# TARGETS (in a scaffolded app package)
load("@viberoots//build-tools/node:defs.bzl", "node_asset_stage", "node_webapp")

node_webapp(
    name = "app_raw",
    # Optional explicit source roots for the app ts surface.
    ts_module_roots = ["src/ts-modules"],
)

node_asset_stage(
    name = "app",
    app = ":app_raw",
    # Inferred to //projects/libs/demo-ts:demo-ts__surface
    module_deps = ["//projects/libs/demo-ts:demo-ts"],
    # Optional explicit surface deps can be merged in:
    # module_surface_deps = ["//projects/libs/extra-ts:extra-ts__surface"],
    assets = [],
)
```

#### Scenario 3: add local wasm files from the app package

```python
# TARGETS (in a scaffolded app package)
load("@viberoots//build-tools/node:defs.bzl", "node_asset_stage", "node_wasm_inline_module", "node_webapp")

node_webapp(name = "app_raw")

node_wasm_inline_module(
    name = "wasm_inline",
    src = "src/wasm-contract/top.wasm",
)

node_asset_stage(
    name = "app",
    app = ":app_raw",
    assets = [
        {"src": "src/wasm-contract/top.wasm", "dest": "top.wasm"},
        {"src": ":wasm_inline", "dest": "wasm-inline/index.js"},
        {"src": "src/wasm-contract/top.wasm", "dest": "server/wasm/top.wasm"},
    ],
)
```

```python
# static webapp: top.wasm + wasm-inline module in dist/
load("@viberoots//build-tools/node:defs.bzl", "node_asset_stage", "node_wasm_inline_module", "node_webapp")

node_webapp(
    name = "app_raw",
)

node_wasm_inline_module(
    name = "wasm_inline",
    src = "src/wasm-contract/top.wasm",
)

node_asset_stage(
    name = "app",
    app = ":app_raw",
    assets = [
        {"src": "src/wasm-contract/top.wasm", "dest": "top.wasm"},
        {"src": ":wasm_inline", "dest": "wasm-inline/index.js"},
        {"src": "src/wasm-contract/top.wasm", "dest": "server/wasm/top.wasm"},
    ],
    labels = ["lang:node", "kind:app", "webapp:static"],
    out = "dist",
)
```

```python
# Vite webapp + Python wasm library:
# normalize Python producer output to canonical runtime contract paths
load("@viberoots//build-tools/node:defs.bzl", "node_asset_stage", "node_wasm_inline_module", "node_webapp")
load("@viberoots//build-tools/python:defs.bzl", "nix_python_wasm_lib")

nix_python_wasm_lib(
    name = "py_wasm",
    labels = ["backend:pyodide"],
    lockfile_label = "lockfile:projects/libs/demo-py-wasm/uv.lock#projects/libs/demo-py-wasm",
)

node_webapp(
    name = "app_raw",
)

node_wasm_inline_module(
    name = "py_wasm_inline",
    src = "//projects/libs/demo-py-wasm:py_wasm",
)

node_asset_stage(
    name = "app",
    app = ":app_raw",
    assets = [
        {"src": "//projects/libs/demo-py-wasm:py_wasm", "dest": "top.wasm"},
        {"src": ":py_wasm_inline", "dest": "wasm-inline/py.js"},
        {"src": "//projects/libs/demo-py-wasm:py_wasm", "dest": "server/wasm/top.wasm"},
    ],
    labels = ["lang:node", "kind:app", "webapp:static"],
    out = "dist",
)
```

```python
# SSR express webapp: client + server contract paths
load("@viberoots//build-tools/node:defs.bzl", "node_asset_stage", "node_wasm_inline_module", "node_webapp")

node_webapp(
    name = "app_raw",
)

node_wasm_inline_module(
    name = "wasm_inline",
    src = "src/wasm-contract/top.wasm",
)

node_asset_stage(
    name = "app",
    app = ":app_raw",
    assets = [
        {"src": "src/wasm-contract/top.wasm", "dest": "client/top.wasm"},
        {"src": ":wasm_inline", "dest": "client/wasm-inline/index.js"},
        {"src": "src/wasm-contract/top.wasm", "dest": "server/wasm/top.wasm"},
    ],
    labels = ["lang:node", "kind:app", "webapp:ssr", "framework:express"],
    out = "dist",
)
```

```python
# SSR next webapp: client/public + server contract paths
load("@viberoots//build-tools/node:defs.bzl", "node_asset_stage", "node_wasm_inline_module", "node_webapp")

node_webapp(
    name = "app_raw",
)

node_wasm_inline_module(
    name = "wasm_inline",
    src = "app/wasm-contract/top.wasm",
)

node_asset_stage(
    name = "app",
    app = ":app_raw",
    assets = [
        {"src": "app/wasm-contract/top.wasm", "dest": "client/public/top.wasm"},
        {"src": ":wasm_inline", "dest": "client/public/wasm-inline/index.js"},
        {"src": "app/wasm-contract/top.wasm", "dest": "server/wasm/top.wasm"},
    ],
    labels = ["lang:node", "kind:app", "webapp:ssr", "framework:next"],
    out = "dist",
)
```

TypeScript usage examples (actual imports + runtime use):

```ts
// client-side usage in scaffolded webapps:
// import the generated wasm-contract helper and instantiate the module bytes.
import { defaultWasmModuleKey, readWasmModuleBytes } from "./wasm-contract";

type AddExports = { add: (a: number, b: number) => number };

export async function callAddFromDefaultModule(a: number, b: number): Promise<number> {
  const moduleKey = defaultWasmModuleKey();
  if (!moduleKey) {
    throw new Error("no wasm modules configured; add assets in node_asset_stage(...) first");
  }

  const bytes = await readWasmModuleBytes(moduleKey);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exp = instance.exports as unknown as AddExports;
  return exp.add(a, b);
}
```

```ts
// server-side usage in scaffolded SSR apps:
// import the generated server helper and use it in request handlers/health checks.
import { defaultWasmModuleKey, readServerWasmContractByteLength } from "./wasm-contract";

export async function wasmServerHealth(): Promise<{ module: string; bytes: number }> {
  const module = defaultWasmModuleKey();
  if (!module) return { module: "", bytes: 0 };
  const bytes = await readServerWasmContractByteLength();
  return { module, bytes };
}
```

```ts
// inline module usage from TypeScript (produced by node_wasm_inline_module):
// the generated JS exports wasmBytes(), which you import like any normal package module.
import { wasmBytes } from "@libs/demo-wasm-inline";

type AddExports = { add: (a: number, b: number) => number };

export async function callInlineAdd(a: number, b: number): Promise<number> {
  const bytes = wasmBytes();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exp = instance.exports as unknown as AddExports;
  return exp.add(a, b);
}
```

## Python macros

Load from `@viberoots//build-tools/python:defs.bzl`.

### `nix_python_library(name, lockfile_label = None, deps = [], **kwargs)`

Use this for Python libraries consumed by other Python targets.

Public args:

- `name` string. Target name.
  - Example: `nix_python_library(name = "py_lib")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `srcs` list of file paths. Python sources.
  - Example: `srcs = ["pkg/__init__.py"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:etl"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/etl/uv.lock#projects/apps/etl"`
  - Used for / scenarios: Pins dependency resolution context to an importer lockfile. Use it whenever Node/Python macros must resolve third-party deps for a specific workspace importer.
- `nixpkg_deps` list of strings. System deps used by native extensions.
  - Example: `nixpkg_deps = ["openssl", "zlib"]`
  - Used for / scenarios: Declares nixpkgs system dependencies needed by native build/runtime paths. Use it for OpenSSL, zlib, and other external libs not provided by repo targets.

### `nix_python_binary(name, lockfile_label = None, deps = [], **kwargs)`

Use this for Python executables.

Public args:

- `name` string. Target name.
  - Example: `nix_python_binary(name = "etl")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":py_lib"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:etl"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/etl/uv.lock#projects/apps/etl"`
  - Used for / scenarios: Pins dependency resolution context to an importer lockfile. Use it whenever Node/Python macros must resolve third-party deps for a specific workspace importer.
- `main` string. Main file.
  - Example: `main = "main.py"`
  - Used for / scenarios: Selects the Python main file for executable entry. Use it to make binary startup explicit when package defaults are not desired.
- `srcs` list is not accepted by this macro.
  - If provided, macro fails with: `nix_python_binary does not accept srcs; use main/main_module + deps instead`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `nixpkg_deps` list of strings. System deps used by native extensions.
  - Example: `nixpkg_deps = ["openssl", "zlib"]`
  - Used for / scenarios: Declares nixpkgs system dependencies needed by native build/runtime paths. Use it for OpenSSL, zlib, and other external libs not provided by repo targets.

### `nix_python_test(name, lockfile_label = None, deps = [], **kwargs)`

Use this for Python tests.

Public args:

- `name` string. Target name.
  - Example: `nix_python_test(name = "py_tests")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `srcs` list of file paths. Python test files.
  - Example: `srcs = ["tests/test_app.py"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":py_lib"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:etl"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/etl/uv.lock#projects/apps/etl"`
  - Used for / scenarios: Pins dependency resolution context to an importer lockfile. Use it whenever Node/Python macros must resolve third-party deps for a specific workspace importer.
- `nixpkg_deps` list of strings. System deps used by native extensions.
  - Example: `nixpkg_deps = ["openssl", "zlib"]`
  - Used for / scenarios: Declares nixpkgs system dependencies needed by native build/runtime paths. Use it for OpenSSL, zlib, and other external libs not provided by repo targets.

### `nix_python_extension_module(name, module, srcs, headers = [], lockfile_label = None, deps = [], nixpkg_deps = [], cflags = [], ldflags = [], build_py_deps = [], link_deps = [], header_deps = [], link_closure = "direct", link_closure_overrides = None, **kwargs)`

Use this for CPython extension modules implemented in C or C++.

Public args:

- `name` string. Target name.
  - Example: `nix_python_extension_module(name = "native_ext", module = "mypkg._native", srcs = ["native/ext.cc"])`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `module` string. Python module name for the extension.
  - Example: `module = "mypkg._native"`
  - Used for / scenarios: Defines the Python import module path for extension outputs. Use it so import-time resolution matches package namespace conventions.
- `srcs` list of file paths. Extension sources.
  - Example: `srcs = ["native/ext.cc"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `headers` list of file paths. Header inputs.
  - Example: `headers = ["native/ext.h"]`
  - Used for / scenarios: Declares header files required during native compilation. Use it to ensure compile actions track header edits and include paths.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":py_lib"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:etl"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/etl/uv.lock#projects/apps/etl"`
  - Used for / scenarios: Pins dependency resolution context to an importer lockfile. Use it whenever Node/Python macros must resolve third-party deps for a specific workspace importer.
- `nixpkg_deps` list of strings. System deps for native build.
  - Example: `nixpkg_deps = ["openssl", "zlib"]`
  - Used for / scenarios: Declares nixpkgs system dependencies needed by native build/runtime paths. Use it for OpenSSL, zlib, and other external libs not provided by repo targets.
- `cflags` list of strings. Extra C/C++ compiler flags.
  - Example: `cflags = ["-O2"]`
  - Used for / scenarios: Adds extra C/C++ compiler flags. Use it for optimization, warning, ABI, or platform-specific compile requirements.
- `ldflags` list of strings. Extra linker flags.
  - Example: `ldflags = ["-Wl,-rpath,$ORIGIN"]`
  - Used for / scenarios: Adds extra linker flags. Use it for rpath, symbol, or platform-specific linking requirements.
- `build_py_deps` list of labels. Python deps used at build time.
  - Example: `build_py_deps = [":codegen"]`
  - Used for / scenarios: Declares Python dependencies needed at build-time (codegen/setup), not runtime. Use it when native build steps import Python helpers.
- `link_deps` list of labels. Link deps.
  - Example: `link_deps = ["//third_party:openssl"]`
  - Used for / scenarios: Declares dependencies that should be linked (not just compiled against). Use it for native/system libs that must be present at link/runtime boundaries.
- `header_deps` list of labels. Header deps.
  - Example: `header_deps = ["//third_party:zlib"]`
  - Used for / scenarios: Declares dependencies that only provide headers/include paths. Use it when compilation needs headers but link ownership remains elsewhere.
- `link_closure` string. Link closure policy. Default is `direct`.
  - Example: `link_closure = "direct"`
  - Used for / scenarios: Selects whether link dependencies remain direct or expand transitively. Use `direct` for strict minimal link graphs and `transitive` when nested native deps must follow through.
- `link_closure_overrides` dict. Per dep closure overrides.
  - Example: `link_closure_overrides = {"//third_party:openssl": "transitive"}`
  - Used for / scenarios: Overrides `link_closure` for specific dependency edges. Use it when most deps should stay direct but a few must be transitive (or vice versa).

### `nix_python_wasm_extension_module(name, module, srcs, headers = [], lockfile_label = None, deps = [], labels = [], cflags = [], ldflags = [], build_py_deps = [], link_deps = [], header_deps = [], link_closure = "direct", link_closure_overrides = None, **kwargs)`

Use this for CPython extension modules targeting wasm.

Public args:

- `name` string. Target name.
  - Example: `nix_python_wasm_extension_module(name = "py_wasm_ext", module = "mypkg._native", srcs = ["native/ext.cc"], labels = ["backend:wasi"])`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `module` string. Python module name for the extension.
  - Example: `module = "mypkg._native"`
  - Used for / scenarios: Defines the Python import module path for extension outputs. Use it so import-time resolution matches package namespace conventions.
- `srcs` list of file paths. Extension sources.
  - Example: `srcs = ["native/ext.cc"]`
  - Used for / scenarios: Declares the source/input files that participate in analysis and invalidation. Use it to include the exact files that should trigger rebuilds when edited.
- `headers` list of file paths. Header inputs.
  - Example: `headers = ["native/ext.h"]`
  - Used for / scenarios: Declares header files required during native compilation. Use it to ensure compile actions track header edits and include paths.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":py_lib"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Must include exactly one `backend:*` label.
  - Example: `labels = ["backend:wasi"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- Allowed values for `backend:*`:
  - `backend:wasi` builds a WASI-compatible module.
  - `backend:pyodide` builds a Pyodide-compatible module.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/etl/uv.lock#projects/apps/etl"`
  - Used for / scenarios: Pins dependency resolution context to an importer lockfile. Use it whenever Node/Python macros must resolve third-party deps for a specific workspace importer.
- `cflags` list of strings. Extra C/C++ compiler flags.
  - Example: `cflags = ["-O2"]`
  - Used for / scenarios: Adds extra C/C++ compiler flags. Use it for optimization, warning, ABI, or platform-specific compile requirements.
- `ldflags` list of strings. Extra linker flags.
  - Example: `ldflags = ["-Wl,-rpath,$ORIGIN"]`
  - Used for / scenarios: Adds extra linker flags. Use it for rpath, symbol, or platform-specific linking requirements.
- `build_py_deps` list of labels. Python deps used at build time.
  - Example: `build_py_deps = [":codegen"]`
  - Used for / scenarios: Declares Python dependencies needed at build-time (codegen/setup), not runtime. Use it when native build steps import Python helpers.
- `link_deps` list of labels. Link deps.
  - Example: `link_deps = ["//third_party:openssl"]`
  - Used for / scenarios: Declares dependencies that should be linked (not just compiled against). Use it for native/system libs that must be present at link/runtime boundaries.
- `header_deps` list of labels. Header deps.
  - Example: `header_deps = ["//third_party:zlib"]`
  - Used for / scenarios: Declares dependencies that only provide headers/include paths. Use it when compilation needs headers but link ownership remains elsewhere.
- `link_closure` string. Link closure policy. Default is `direct`.
  - Example: `link_closure = "direct"`
  - Used for / scenarios: Selects whether link dependencies remain direct or expand transitively. Use `direct` for strict minimal link graphs and `transitive` when nested native deps must follow through.
- Allowed values:
  - `direct` uses only the direct `link_deps`.
  - `transitive` follows `link_deps` recursively.
- `link_closure_overrides` dict. Per dep closure overrides.
  - Example: `link_closure_overrides = {"//third_party:openssl": "transitive"}`
  - Used for / scenarios: Overrides `link_closure` for specific dependency edges. Use it when most deps should stay direct but a few must be transitive (or vice versa).
  - Allowed values for each override:
    - `direct` uses only the direct `link_deps` for that dep.
    - `transitive` follows that dep's `link_deps` recursively.

### `nix_python_wasm_app(name, lockfile_label = None, deps = [], labels = [], **kwargs)`

Use this for Python apps targeting wasm runtimes.

Public args:

- `name` string. Target name.
  - Example: `nix_python_wasm_app(name = "py_wasm_app")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":py_lib"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:etl"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/etl/uv.lock#projects/apps/etl"`
  - Used for / scenarios: Pins dependency resolution context to an importer lockfile. Use it whenever Node/Python macros must resolve third-party deps for a specific workspace importer.
- `nixpkg_deps` list of strings. System deps used by native extensions.
  - Example: `nixpkg_deps = ["openssl", "zlib"]`
  - Used for / scenarios: Declares nixpkgs system dependencies needed by native build/runtime paths. Use it for OpenSSL, zlib, and other external libs not provided by repo targets.
- `python_source_roots` list of strings. Optional source roots for generated wasm module-surface metadata.
  - Example: `python_source_roots = ["."]`
  - Used for / scenarios: Declares Python module-surface source roots. Use it when package layout is non-standard and source attribution must remain stable.
- The macro stamps wasm labels and appends `wasm:app`.

### `nix_python_wasm_lib(name, lockfile_label = None, deps = [], labels = [], **kwargs)`

Use this for Python libraries targeting wasm runtimes.

Public args:

- `name` string. Target name.
  - Example: `nix_python_wasm_lib(name = "py_wasm_lib")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":py_lib"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:etl"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/etl/uv.lock#projects/apps/etl"`
  - Used for / scenarios: Pins dependency resolution context to an importer lockfile. Use it whenever Node/Python macros must resolve third-party deps for a specific workspace importer.
- `nixpkg_deps` list of strings. System deps used by native extensions.
  - Example: `nixpkg_deps = ["openssl", "zlib"]`
  - Used for / scenarios: Declares nixpkgs system dependencies needed by native build/runtime paths. Use it for OpenSSL, zlib, and other external libs not provided by repo targets.
- `python_source_roots` list of strings. Optional source roots for generated wasm module-surface metadata.
  - Example: `python_source_roots = ["."]`
  - Used for / scenarios: Declares Python module-surface source roots. Use it when package layout is non-standard and source attribution must remain stable.
- The macro stamps wasm labels and appends `wasm:lib`.

## Rust macros

Load from `@viberoots//build-tools/rust:defs.bzl`.

The artifact-producing Rust macros accept the following remote-execution evidence labels:

- `source_snapshot_bundle` supplies the typed `SourceSnapshotInfo` bundle containing the declared
  source root, source manifest, and graph. It is mutually exclusive with the lower-level
  `source_snapshot` and `source_snapshot_manifest` arguments.
- `materialization_manifest` declares the reviewed Nix store paths and immutable identities that
  the action must materialize.
- `artifact_contract` declares the expected output identity and artifact shape.
- `tool_closure` declares the immutable executable/tool closure used by the action.
- `remote_builder_smoke` declares the reviewed builder and toolchain smoke evidence.

A target labeled `remote:ready` must provide the complete five-label evidence set. The evidence is
part of the action's declared inputs: Rust build and test actions validate the source snapshot,
materialize its declared state into action-owned writable storage, and execute the selected build or
real Cargo test harness from that state. Local-only targets may omit the set; partial sets do not
establish remote readiness.

All artifact-producing Rust macros also accept `behavior_probe`, a bool that defaults to `False`.
This is a narrow reproducibility-qualification API, not a general post-build hook. When enabled,
the Nix artifact builder executes the installed output with the kind-specific reviewed observer,
extracts the reserved `viberoots_observed_behavior` result, requires the protected value `42` or
`43`, and writes only `$out/share/viberoots-rust/observed-behavior`. Native binaries and tests run
their installed executables; libraries and extensions expose the reserved symbol through their
reviewed ABI; WASM invokes that export with the pinned runtime. Tauri observes the packaged
frontend WASM only after its path and digest match the package manifest.

`behavior_probe = True` therefore changes artifact construction and output identity. It accepts no
command, path, environment, or expected-value override and fails closed when the artifact lacks the
reserved observation contract. Use it only for protected reproducibility and patch-lifecycle
fixtures whose sources intentionally implement that contract; ordinary application and library
targets must leave it disabled.

### `rust_library(name, **kwargs)`

Use this for Rust libraries.

Public args:

- `name` string. Target name.
  - Example: `rust_library(name = "rust_lib")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `srcs` list of file paths. Rust sources.
  - Example: `srcs = ["src/lib.rs"]`
  - Used for / scenarios: Adds explicit source inputs, including non-Rust assets. The macro also declares the package-local `**/*.rs` Cargo source closure for same-root dependency invalidation.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `extra_module_providers` list of labels. Optional normalized extra providers merged into deps.
  - Example: `extra_module_providers = ["//third_party/providers:lf_demo"]`
  - Used for / scenarios: Attaches additional module-surface providers to this target. Use it when downstream module discovery needs metadata from auxiliary producers.
- `cargo_manifest` string. Defaults to and, in the native baseline, must equal the canonical package-local `Cargo.toml`.
- `cargo_lock` string. Defaults to and, in the native baseline, must equal the canonical package-local `Cargo.lock`.
- `cargo_output_hashes` dict. Nix hashes keyed by `package-version` for locked Git dependencies.
  Registry dependencies use their lockfile checksums.
- `cargo_fixed_sources` dict. Exact source-qualified package identities mapped to reviewed JSON
  `buildInput` records emitted by `u`, plus the declared Cargo registry name. These path-free
  records contain only the immutable Nix store path, NAR hash, lock source, and checksum used for
  credential-free offline builds; authoring-only Cargo cache origins are rejected.
- `crate` string. Cargo package name; defaults to the Buck target name.
- `cargo_package` string. Reviewed Cargo package identity exported for composition diagnostics;
  defaults to `crate`.
- `public_crate` string. Cargo dependency key used by cross-root consumers; defaults to `crate`.
- `crate_type` is fixed by the public artifact macro. `rust_library` is `rlib`.
- `host_role` is `target` except for `rust_proc_macro`, which is built for the native host.
- `generated_outputs` lists stable graph-visible outputs produced by the crate contract.
- `features` list of strings. Explicit Cargo features; defaults to empty.
- `default_features` bool. Whether Cargo default features are enabled; defaults to `True`.
- `profile` string. Cargo profile, `release` or `dev`; defaults to `release`.
- `target` string. Native macros require this to be empty. WASM macros set their reviewed triple.
- `local_patch_dirs` list of strings. Normalized package-relative Rust patch input directories without traversal; defaults to `patches/rust`.
- `nixpkg_deps` list of strings. Declared nixpkgs packages available to Cargo build scripts.
- `nixpkgs_profile` string. Named source profile for the toolchain and unpinned native dependencies; defaults to `default`.
- `nixpkg_pins` dict. Per-attribute source-profile overrides with a non-empty rationale.
- `link_deps`, `header_deps`, `link_closure`, and `link_closure_overrides` are not public ordinary
  Rust arguments. They are accepted only by `rust_c_ffi_library` and
  `rust_cxx_bridge_library`, where the generated binding configuration is ABI authority.
  Handwritten `extern` declarations cannot opt an ordinary Rust target into native linking.

Cross-root Rust entries in `deps` must match reviewed Cargo path dependencies exactly. The path
must normalize to the dependency target's repository-relative Cargo root without escaping the
repository. Package name, public crate name, and declared version must agree. Missing, extra,
ambiguous, cyclic, external, and incompatible edges fail during planning. Cargo compiles the
transitive source closure; Buck `.rlib` outputs are not injected into Cargo.

### `rust_static_library(name, **kwargs)`

Builds the Cargo library as `staticlib` and exposes a deterministic `lib<name>.a` Buck artifact.
It accepts the ordinary non-interop library arguments documented for `rust_library`.

### `rust_cdylib(name, **kwargs)`

Builds the Cargo library as `cdylib` and normalizes the platform dynamic-library output to the
deterministic Buck artifact `lib<name>.cdylib`. Runtime native dependencies remain explicit.

### `rust_c_ffi_library(name, binding_config, artifact = "static", **kwargs)`

Builds an explicit C ABI outcome. `artifact` is `static` or `shared`; the macro fixes Cargo to
`staticlib` or `cdylib`. `binding_config` is package-local reviewed JSON using schema
`viberoots.rust-interop.v1`. The pinned Nix generator installs `<public_crate>.h` and a binding
manifest and injects generated Rust import declarations/export signature checks. Only
`panic_strategy = "abort"` and `thread_safety = "send-sync"` are implemented; allocator ownership
is checked against explicit producer/destructor annotations. Native `link_deps`, `header_deps`,
`link_closure`, and `link_closure_overrides` are available here because this macro supplies the
reviewed generated ABI boundary.

### `rust_cxx_bridge_library(name, binding_config, artifact = "static", **kwargs)`

Builds the same stable C ABI artifact plus generated `<public_crate>.hpp` and `.cc` C++ bridge
outputs. `exception_policy` is `noexcept` or `contained`; `cxx_standard` must match the pinned
`c++17`/libc++ bridge standard. Exported callbacks require `contained`, the exact callback/context
shape, and a typed callback fallback; callbacks under `noexcept` are rejected.
C++ consumers list the target in both `link_deps` and `header_deps`. Direct Rust C++ ABI exposure
and cross-language unwinding are unsupported.

### `rust_proc_macro(name, **kwargs)`

Builds the Cargo library as a host `proc-macro` and exposes `lib<name>.proc-macro` for artifact
inspection. Cross-root Cargo consumers compile the proc-macro from its declared source path with
Cargo's host toolchain; they do not consume this normalized inspection artifact.

### `rust_binary(name, **kwargs)`

Use this for Rust executables.

Public args:

- `name` string. Target name.
  - Example: `rust_binary(name = "rust_bin")`
  - Used for / scenarios: Defines the target label used by other targets and tooling. Use it to create a stable API name for the artifact in this package.
- `srcs` list of file paths. Rust sources.
  - Example: `srcs = ["src/main.rs"]`
  - Used for / scenarios: Adds explicit source inputs, including non-Rust assets. The macro also declares the package-local `**/*.rs` Cargo source closure for same-root dependency invalidation.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
  - Used for / scenarios: Declares direct build/runtime dependencies. Use it when this target imports, links, or executes code from other repo targets.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
  - Used for / scenarios: Adds metadata labels used by selection, policy checks, and inventory tooling. Use it for ownership, runtime, framework, or contract classification.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
  - Used for / scenarios: Controls which packages may depend on this target. Use it to keep internal targets private or intentionally publish reusable APIs.
- `extra_module_providers` list of labels. Optional normalized extra providers merged into deps.
  - Example: `extra_module_providers = ["//third_party/providers:lf_demo"]`
  - Used for / scenarios: Attaches additional module-surface providers to this target. Use it when downstream module discovery needs metadata from auxiliary producers.
- `cargo_manifest` string. Defaults to and, in the native baseline, must equal the canonical package-local `Cargo.toml`.
- `cargo_lock` string. Defaults to and, in the native baseline, must equal the canonical package-local `Cargo.lock`.
- `cargo_output_hashes` dict. Uses the same locked Git source contract as `rust_library`.
- `cargo_fixed_sources` dict. Uses the same reviewed registry materialization contract as
  `rust_library`.
- `crate` string. Cargo package name; defaults to the Buck target name.
- `features` list of strings. Explicit Cargo features; defaults to empty.
- `default_features` bool. Whether Cargo default features are enabled; defaults to `True`.
- `profile` string. Cargo profile, `release` or `dev`; defaults to `release`.
- `target` string. Native macros require this to be empty.
- `local_patch_dirs` list of strings. Normalized package-relative Rust patch input directories without traversal; defaults to `patches/rust`.
- `nixpkg_deps`, `nixpkgs_profile`, and `nixpkg_pins` use the same source-selection contract as `rust_library`.

### `rust_test(name, **kwargs)`

Use this for native Cargo tests. It accepts the same Cargo, source-selection, dependency, patch,
label, and visibility arguments as `rust_library`. Buck executes the Nix-built Cargo harnesses
through a bounded project-relative external runner. Tests are not runnable application entries.

### `tauri_app(name, frontend_dist, **kwargs)`

Builds a credential-free, platform-ad-hoc Tauri desktop application. The artifact is not
release-signed or release-admitted. The target stamps `kind:app`, `app:tauri`, and
`platform:aarch64-darwin`; only that platform currently has reviewed package and launch evidence.
The Buck graph also carries a typed `tauri_target` record with `platform = "desktop-darwin"`,
`artifactKind = "macos-app"`, `signingMode = "adhoc-platform"`, and
`deploymentEligibility = "not-eligible"`. iOS and Android values are planned route metadata only
until their builders are reviewed. The disabled mobile symbols accept `load()` but fail analysis
with a platform-not-enabled diagnostic. The shared mobile source contract reserves package-relative
`android_config`, `ios_config`, `android_project_srcs`, and `ios_project_srcs` fields as declared
inputs for the builder PRs.

- `frontend_dist` is required and must name a Buck-built static Node application, normally the
  output of `node_asset_stage`. Tauri `beforeBuildCommand` and `beforeDevCommand` hooks are rejected.
- `tauri_root` is `.` or `src-tauri`; `tauri_config` defaults to `tauri.conf.json` within that
  bounded root.
- `resources` contains `{"src": "<root-relative source>", "dest": "<bundle destination>"}`
  mappings. Destinations must be unique and traversal-free.
- `sidecar_deps` contains equivalent mappings whose `src` values are reviewed `kind:bin`,
  `sidecar:reviewed` targets.
- `app_commands`, `app_windows`, `permissions`, and `capabilities` declare the least-privilege
  command and window universe. Command names use Rust/Tauri identifiers. Each configured window has
  exactly one capability owner; each capability may admit an exact subset of the declared
  command-derived permissions, including none. Undeclared windows, commands, plugin or future
  permissions, wildcards, duplicate identifiers, and ambiguous window coverage are rejected.
- The frontend uses its locked module-based `@tauri-apps/api` dependency. The global API is
  rejected.
- Ordinary Rust `deps` continue to represent Cargo path dependencies. C/C++ code must remain behind
  `rust_c_ffi_library` or `rust_cxx_bridge_library`; `tauri_app` does not admit direct
  `link_deps`/`header_deps`.

Production runnable metadata points at the built executable and application bundle. Development
uses the explicit bounded Tauri watcher. Remote CSP origins, plugins, updater artifacts, signing,
notarization, publication admission, Linux
promotion, and release-hermetic claims are outside this experimental macro.

### `rust_wasm_library(name, wasm_abi = "bare", **kwargs)`

Builds a Cargo `cdylib` for `wasm32-unknown-unknown` or `wasm32-wasip1` and emits `<name>.wasm`.
It accepts the shared Cargo, patch, and source-selection arguments. Compatible Rust/C++ static WASM
libraries may be supplied through `link_deps`, `link_closure`, and `link_closure_overrides`.
See [Rust WebAssembly Operations](rust-wasm-operations.md) for browser, component, staging, and
deployment workflows.

### `rust_wasi_binary(name, **kwargs)`

Builds a `wasm32-wasip1` Cargo binary and emits `<name>.wasm` for a WASI preview1 runtime.
Compatible WASI static libraries use the same explicit link-intent arguments.

### `rust_wasm_static_library(name, wasm_abi = "bare", **kwargs)`

Builds a Cargo `staticlib` for `wasm32-unknown-unknown` or `wasm32-wasip1`. `wasm_header` is a
required package-local C header installed beside the archive. The target publishes a versioned
module-surface companion and may participate in Rust and TinyGo direct/transitive link closure.
`wasm_optimize` and `wasm_debug` set the Rust compile-time optimization and debuginfo policy for
every relocatable member; final-module Binaryen transforms are intentionally not applied. Static libraries reject
`exported_functions` because the final linked module, rather than an archive, owns its exports.

### `rust_wasm_browser_package(name, **kwargs)`

Builds a freestanding Cargo `cdylib`, runs pinned wasm-bindgen, and exposes a directory containing
JavaScript, TypeScript declarations, `<crate>_bg.wasm`, and `package.json`. `exported_functions`
is an optional allowlist; `wasm_optimize` is `none`, `speed`, or `size`; `wasm_debug` controls
stripping; and `wasm_source_map` explicitly enables a source map. The directory can be consumed by
`node_asset_stage`; its background module can also be selected by `artifact_name` for staging or
inline generation.

### `rust_wasm_component(name, wit, wit_world, **kwargs)`

Builds and validates a component from a package-local WIT file and explicit world.
`component_adapter` is `none` or `wasi-preview1-reactor`; WASI requires the pinned reactor adapter
and bare components require `none`. Command components are not exposed through this library-shaped
macro. The Nix output includes the component, normalized WIT, and a provenance manifest naming all
tools and the selected adapter. `exported_functions` is validated against the emitted component WIT
world, not merely against pre-component core-WASM symbols.

All Rust WASM macros accept `wasm_optimize` and `wasm_debug`. Module, WASI binary, browser, and
component macros accept `exported_functions`; it is an enforced output allowlist, with only
ABI-required runtime exports retained. Components apply it to the selected WIT world. Only browser
packages accept `wasm_source_map`. Public Buck outputs are typed family directories preserving the
primary artifact, reviewed header or normalized WIT, and producer manifests. WASM targets reject
native `header_deps` and nixpkg inputs and compare ABI, target, allocator, exception, and runtime
authority on every static link edge.

### `rust_python_extension(name, module, **kwargs)`

Build a native Cargo `cdylib` for CPython. `module` is the dotted import name. `python_abi` defaults
to `selected`; an explicit `cp<major><minor>` value must match the selected Nix interpreter, which
also supplies the extension suffix. Optional `build_py_deps` requires exactly one importer-scoped
Python `uv.lock` label (inferred from the package by default) and resolves packages from that
lock's uv2nix wheelhouse. `runtime_deps`, `link_deps`, and `header_deps` remain explicit graph
inputs. Recursive runtime packages and their dynamic-library closure are relocated beside the
extension. Python consumers stage the result through the shared `kind:pyext` contract.

### `rust_python_wasm_extension(name, backend, module, **kwargs)`

Build a Cargo `cdylib` as a PyO3-compatible PyEmscripten side module for the pinned Pyodide
runtime. `backend` must be `pyodide`; `backend = "wasi"` fails closed because the shared Python
WASI runtime cannot load dynamic extension modules. `module` is the dotted Python import name, and
the installed artifact uses the shared Python WASM layout:
`site/<dotted-module><PYODIDE_EXT_SUFFIX>`.

The macro fixes `target = "wasm32-unknown-emscripten"` and `crate_type = "cdylib"`, uses Nix-store
Cargo, rustc, and `emcc`, keeps Cargo locked and offline, and records the PyEmscripten ABI identity
in the Rust materialization evidence. Optional `build_py_deps` uses the same importer-scoped
`uv.lock` authority as `rust_python_extension`.

`link_deps` and `header_deps` are valid for this Pyodide backend. Link deps must be reviewed C/C++
WASM static producers with `lang:cpp`, `kind:wasm`, and `wasm:static`; header deps must be C/C++
header targets. The planner passes the resolved static archives and include roots to the Rust
PyEmscripten build, matching the C/C++ Pyodide overlay contract.

Use PyO3's cross-build environment (`PYO3_CROSS=1`, the pinned CPython minor, and the pinned
Pyodide/Emscripten headers) rather than host Python discovery. Package-local Rust patches are
declared with `local_patch_dirs`; rebuild the Python WASM app to validate the patched overlay and
then remove the patch to restore the original artifact identity. Patch validation should observe
the imported Pyodide value before patch, after patch, and after exact removal. Publication rejects
ABI drift before staging, including a missing `PyInit_<leaf>` export, unexpected public exports,
pthread or atomic target features, Pyodide extension-suffix drift, and PyO3 cross-build mismatches.
Use `scaf new rust pyodide-extension <name> --yes` for the source-owned scaffold that includes
locked Cargo metadata, a Python WASM consumer, package-local Rust patch storage, and Pyodide import
guidance.

### `rust_node_addon(name, addon_name = None, node_api_version = 8, platform = "selected", **kwargs)`

Build a Cargo `cdylib` as a stable `<addon_name>.node` Node-API artifact. `addon_name` must match
`[A-Za-z_][A-Za-z0-9_-]*`, and consumers reject duplicate stable names. `node_api_version` must be
8, 9, or 10. The build selects that pinned header contract, audits the binary for the corresponding
API floor and absence of higher pinned APIs, requires Node's loader-visible version export, and
load-probes the installed artifact with the managed runtime.
`platform` defaults to the selected Nix system and an explicit mismatched system is rejected. The
graph planner resolves transitive `kind:addon` dependencies through the same language-neutral
artifact route used for C++ addons. Bundled CLIs stage them in `bin/native`, services in `native`,
and webapps in `dist/native`; each staging route also carries the relocated runtime-library
directory.
