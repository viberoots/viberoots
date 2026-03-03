# Starlark API reference

This reference is a public interface guide for macros used in `TARGETS`. I keep it focused on the call site API. Implementation detail is tracked elsewhere.

## Index

- `//build-tools/go:defs.bzl`
  - `nix_go_library`
  - `nix_go_binary`
  - `nix_go_test`
  - `nix_go_carchive`
  - `nix_go_tiny_wasm_lib`
- `//build-tools/cpp:defs.bzl`
  - `nix_cpp_library`
  - `nix_cpp_binary`
  - `nix_cpp_headers`
  - `nix_cpp_test`
  - `nix_cpp_node_addon`
  - `nix_cpp_wasm_static_lib`
  - `nix_cpp_wasm_emscripten_lib`
  - `cpp_sanitize_probe`
- `//build-tools/node:defs.bzl`
  - `nix_node_gen`
  - `nix_node_test`
  - `nix_node_lib`
  - `nix_node_bin`
  - `node_webapp`
  - `nix_node_cli_bin`
  - `node_asset_stage`
  - `node_wasm_inline_module`
- `//build-tools/python:defs.bzl`
  - `nix_python_library`
  - `nix_python_binary`
  - `nix_python_test`
  - `nix_python_extension_module`
  - `nix_python_wasm_extension_module`
  - `nix_python_wasm_app`
  - `nix_python_wasm_lib`
- `//build-tools/rust:defs.bzl`
  - `rust_library`
  - `rust_binary`

## Go macros

Load from `//build-tools/go:defs.bzl`.

### `nix_go_library(name, **kwargs)`

Use this for a Go library target that other Go targets depend on.

Public args:

- `name` string. Target name.
  - Example: `nix_go_library(name = "util")`
- `srcs` list of file paths. Go source files.
  - Example: `srcs = ["util.go"]`
- `deps` list of labels. Direct deps for the library.
  - Example: `deps = [":core", "//projects/libs/logging:logging"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
- `repo_cgo_deps` list of labels. Extra repo local deps needed for CGO.
  - Example: `repo_cgo_deps = ["//third_party:openssl"]`
- `extra_module_providers` list of labels. Extra module labels to attach.
  - Example: `extra_module_providers = ["//third_party:zlib"]`
- `nix_cgo_pkgconfig` dict. Unsupported. Must be empty if present.
  - Example: `nix_cgo_pkgconfig = {}`

### `nix_go_binary(name, **kwargs)`

Use this for a Go executable built from package sources and deps.

Public args:

- `name` string. Target name.
  - Example: `nix_go_binary(name = "server")`
- `srcs` list of file paths. Go source files.
  - Example: `srcs = ["main.go"]`
- `deps` list of labels. Direct deps for the binary.
  - Example: `deps = [":app_lib"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
- `repo_cgo_deps` list of labels. Extra repo local deps needed for CGO.
  - Example: `repo_cgo_deps = ["//third_party:openssl"]`
- `extra_module_providers` list of labels. Extra module labels to attach.
  - Example: `extra_module_providers = ["//third_party:zlib"]`
- `nix_cgo_pkgconfig` dict. Unsupported. Must be empty if present.
  - Example: `nix_cgo_pkgconfig = {}`

### `nix_go_test(name, **kwargs)`

Use this for Go tests that should run with the repo’s Go tooling and deps.

Public args:

- `name` string. Target name.
  - Example: `nix_go_test(name = "util_test")`
- `srcs` list of file paths. Go test files.
  - Example: `srcs = ["util_test.go"]`
- `deps` list of labels. Direct deps for the test.
  - Example: `deps = [":util"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
- `library` label or string. If set, it points to the library under test.
  - Example: `library = ":util"`
- `link_deps` list of labels. Link deps for test intent.
  - Example: `link_deps = ["//third_party:openssl"]`
- `header_deps` list of labels. Header deps for test intent.
  - Example: `header_deps = ["//third_party:zlib"]`
- `link_closure` string. Link closure policy. Default is `direct`.
  - Example: `link_closure = "direct"`
- Allowed values:
  - `direct` uses only the direct `link_deps`.
  - `transitive` follows `link_deps` recursively.
- `link_closure_overrides` dict. Per dep closure overrides.
  - Example: `link_closure_overrides = {"//third_party:openssl": "transitive"}`
  - Allowed values for each override:
    - `direct` uses only the direct `link_deps` for that dep.
    - `transitive` follows that dep's `link_deps` recursively.
  - Allowed values for each override:
    - `direct` uses only the direct `link_deps` for that dep.
    - `transitive` follows that dep's `link_deps` recursively.

### `nix_go_carchive(name, **kwargs)`

Use this when you need a Go library output suitable for linking from C or C++.
I build via the Nix planner and produce a directory containing `lib/*.a` and `include/*.h`.

Public args:

- `name` string. Target name.
  - Example: `nix_go_carchive(name = "go_carchive")`
- `deps` list of labels. Direct deps for the archive.
  - Example: `deps = [":core"]`
- `srcs` list of file paths. Go source files (and package-local patch inputs).
  - Example: `srcs = ["main.go"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`

### `nix_go_tiny_wasm_lib(name, **kwargs)`

Use this for a TinyGo WebAssembly library output.

Public args:

- `name` string. Target name.
  - Example: `nix_go_tiny_wasm_lib(name = "tiny_wasm")`
- `srcs` list of file paths. Go source files.
  - Example: `srcs = ["main.go"]`
- `deps` list of labels. Direct deps for the wasm lib.
  - Example: `deps = [":core"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
- `link_deps` list of labels. Link deps for wasm intent.
  - Example: `link_deps = ["//third_party:openssl"]`
- `header_deps` list of labels. Header deps for wasm intent.
  - Example: `header_deps = ["//third_party:zlib"]`
- `link_closure` string. Link closure policy. Default is `direct`.
  - Example: `link_closure = "direct"`
- Allowed values:
  - `direct` uses only the direct `link_deps`.
  - `transitive` follows `link_deps` recursively.
- `link_closure_overrides` dict. Per dep closure overrides.
  - Example: `link_closure_overrides = {"//third_party:openssl": "transitive"}`
  - Allowed values for each override:
    - `direct` uses only the direct `link_deps` for that dep.
    - `transitive` follows that dep's `link_deps` recursively.
- `use_selected_wasm` bool. Select a specific wasm variant produced by the build.
  - Example: `use_selected_wasm = True`
- `extra_module_providers` list of labels. Extra module labels to attach.
  - Example: `extra_module_providers = ["//third_party:zlib"]`

## C++ macros

Load from `//build-tools/cpp:defs.bzl`.

### `nix_cpp_library(name, **kwargs)`

Use this for a C++ library consumed by other C++ targets.

Public args:

- `name` string. Target name.
  - Example: `nix_cpp_library(name = "core")`
- `srcs` list of file paths. C++ sources.
  - Example: `srcs = ["src/core.cc"]`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":headers"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
- `link_deps` list of labels. Link deps.
  - Example: `link_deps = ["//third_party:openssl"]`
- `header_deps` list of labels. Header deps.
  - Example: `header_deps = ["//third_party:zlib"]`
- `link_mode` string. `static` or `shared`. Default is `static`.
  - Example: `link_mode = "shared"`
- Allowed values:
  - `static` produces a static library.
  - `shared` produces a shared library.
- `link_kind` string. Legacy alias for `link_mode`.
  - Example: `link_kind = "static"`
  - Allowed values:
    - `static` produces a static library.
    - `shared` produces a shared library.
- `link_closure` string. Link closure policy. Default is `direct`.
  - Example: `link_closure = "direct"`
- Allowed values:
  - `direct` uses only the direct `link_deps`.
  - `transitive` follows `link_deps` recursively.
- `link_closure_overrides` dict. Per dep closure overrides.
  - Example: `link_closure_overrides = {"//third_party:openssl": "transitive"}`
  - Allowed values for each override:
    - `direct` uses only the direct `link_deps` for that dep.
    - `transitive` follows that dep's `link_deps` recursively.
- `extra_module_providers` list of labels. Extra module labels to attach.
  - Example: `extra_module_providers = ["//third_party:zlib"]`

### `nix_cpp_binary(name, **kwargs)`

Use this for a C++ executable.

Public args:

- `name` string. Target name.
  - Example: `nix_cpp_binary(name = "app")`
- `srcs` list of file paths. C++ sources.
  - Example: `srcs = ["src/main.cc"]`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
- `link_deps` list of labels. Link deps.
  - Example: `link_deps = ["//third_party:openssl"]`
- `header_deps` list of labels. Header deps.
  - Example: `header_deps = ["//third_party:zlib"]`
- `link_mode` string. `static` or `shared`. Default is `static`.
  - Example: `link_mode = "static"`
- Allowed values:
  - `static` produces a static library or binary.
  - `shared` produces a shared library.
- `link_kind` string. Legacy alias for `link_mode`.
  - Example: `link_kind = "static"`
  - Allowed values:
    - `static` produces a static library or binary.
    - `shared` produces a shared library.
- `link_closure` string. Link closure policy. Default is `direct`.
  - Example: `link_closure = "direct"`
- Allowed values:
  - `direct` uses only the direct `link_deps`.
  - `transitive` follows `link_deps` recursively.
- `link_closure_overrides` dict. Per dep closure overrides.
  - Example: `link_closure_overrides = {"//third_party:openssl": "transitive"}`
  - Allowed values for each override:
    - `direct` uses only the direct `link_deps` for that dep.
    - `transitive` follows that dep's `link_deps` recursively.
- `extra_module_providers` list of labels. Extra module labels to attach.
  - Example: `extra_module_providers = ["//third_party:zlib"]`

### `nix_cpp_headers(name, **kwargs)`

Use this for header-only C++ libraries where no binary artifact is needed.

Public args:

- `name` string. Target name.
  - Example: `nix_cpp_headers(name = "headers")`
- `srcs` list of file paths. Header files.
  - Example: `srcs = ["include/core.h"]`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
- `link_deps` list of labels. Link deps.
  - Example: `link_deps = ["//third_party:openssl"]`
- `header_deps` list of labels. Header deps.
  - Example: `header_deps = ["//third_party:zlib"]`
- `link_mode` string. Must not be `shared`.
  - Example: `link_mode = "static"`
- Allowed values:
  - `static` produces a header only target.
  - `shared` is invalid for header only targets.

### `nix_cpp_test(name, **kwargs)`

Use this for C++ tests.

Public args:

- `name` string. Target name.
  - Example: `nix_cpp_test(name = "core_test")`
- `srcs` list of file paths. C++ test sources.
  - Example: `srcs = ["tests/core_test.cc"]`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
- `link_deps` list of labels. Link deps.
  - Example: `link_deps = ["//third_party:openssl"]`
- `header_deps` list of labels. Header deps.
  - Example: `header_deps = ["//third_party:zlib"]`
- `link_mode` string. `static` or `shared`. Default is `static`.
  - Example: `link_mode = "static"`
- Allowed values:
  - `static` produces a static binary.
  - `shared` produces a shared library test binary.
- `link_closure` string. Link closure policy. Default is `direct`.
  - Example: `link_closure = "direct"`
- Allowed values:
  - `direct` uses only the direct `link_deps`.
  - `transitive` follows `link_deps` recursively.
- `link_closure_overrides` dict. Per dep closure overrides.
  - Example: `link_closure_overrides = {"//third_party:openssl": "transitive"}`
  - Allowed values for each override:
    - `direct` uses only the direct `link_deps` for that dep.
    - `transitive` follows that dep's `link_deps` recursively.

### `nix_cpp_node_addon(name, **kwargs)`

Use this for Node-API addons implemented in C++.

Public args:

- `name` string. Target name.
  - Example: `nix_cpp_node_addon(name = "native_addon")`
- `addon_name` string. Optional name used by packaging.
  - Example: `addon_name = "my_addon"`
- `srcs` list of file paths. C++ sources.
  - Example: `srcs = ["src/addon.cc"]`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`

### `nix_cpp_wasm_static_lib(name, **kwargs)`

Use this for a C++ static library compiled to WebAssembly.

Public args:

- `name` string. Target name.
  - Example: `nix_cpp_wasm_static_lib(name = "core_wasm")`
- `srcs` list of file paths. C++ sources.
  - Example: `srcs = ["src/core.cc"]`
- `wasm_abi` string. `bare` or `wasi`. Default is `bare`.
  - Example: `wasm_abi = "wasi"`
- Allowed values:
  - `bare` builds for `wasm32-unknown-unknown`.
  - `wasi` builds for `wasm32-wasi`.
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
- `link_deps` list of labels. Link deps.
  - Example: `link_deps = ["//third_party:openssl"]`
- `header_deps` list of labels. Header deps.
  - Example: `header_deps = ["//third_party:zlib"]`

### `nix_cpp_wasm_emscripten_lib(name, **kwargs)`

Use this for Emscripten builds that produce JS and WASM outputs.

Public args:

- `name` string. Target name.
  - Example: `nix_cpp_wasm_emscripten_lib(name = "core_ems")`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
- `srcs` list of file paths. Source files.
  - Example: `srcs = ["src/lib.cc"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`

### `cpp_sanitize_probe(name, label)`

Use this for sanitizer parity probes in tests.

Public args:

- `name` string. Target name.
  - Example: `cpp_sanitize_probe(name = "sanitize_probe", label = "//foo:bar")`
- `label` string. Label to sanitize for the probe.
  - Example: `label = "//foo:bar"`

## Node macros

Load from `//build-tools/node:defs.bzl`.

### `nix_node_gen(name, srcs = [], out = None, cmd = None, deps = [], labels = [], lockfile_label = None, kind = "gen", **kwargs)`

Use this for Node artifact-producing generators that run through the Nix selected planner path.
The public target is a Nix-calling wrapper; a planner companion target retains the original `cmd`.

Public args:

- `name` string. Target name.
  - Example: `nix_node_gen(name = "gen_file")`
- `srcs` list of labels or files. Inputs for the genrule.
  - Example: `srcs = ["src/index.ts"]`
- `out` string. Output filename.
  - Example: `out = "index.out"`
- `cmd` string. Shell command executed by the planner companion target.
  - Example: `cmd = "cp $(location src/index.ts) $OUT"`
- `deps` list of labels. Direct deps for the genrule.
  - Example: `deps = [":tools"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:web"]`
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"`
- `kind` string. Optional kind label value. Default is `gen`.
  - Example: `kind = "gen"`
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
- `patterns` list of strings. Test file patterns.
  - Example: `patterns = ["**/*.test.ts"]`
- `env` dict. Environment variables for the test runner.
  - Example: `env = {"NODE_ENV": "test"}`
- `timeout_sec` int. Timeout in seconds. Default is `600`.
  - Example: `timeout_sec = 300`
- `srcs` list of labels or files. Inputs for the test rule.
  - Example: `srcs = ["src/index.ts"]`
- `out` string. Output filename for the stamp file.
  - Example: `out = "unit_tests.stamp"`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":lib"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:web"]`
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"`
- `kind` string. Optional kind label value. Default is `test`.
  - Example: `kind = "test"`
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

### `nix_node_lib(name, **kwargs)`

Use this for Node library targets that produce generated artifacts.
This is an alias of `nix_node_gen(..., kind = "lib")`.

Public args:

- `name` string. Target name.
  - Example: `nix_node_lib(name = "node_lib")`
- `srcs` list of labels or files. Inputs.
  - Example: `srcs = ["src/index.ts"]`
- `out` string. Output filename.
  - Example: `out = "lib.out"`
- `cmd` string. Shell command to run.
  - Example: `cmd = "cp $(location src/index.ts) $OUT"`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":shared"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:web"]`
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"`

### `nix_node_bin(name, **kwargs)`

Use this for Node targets that produce an executable file.
This is an alias of `nix_node_gen(..., kind = "bin")`.

Public args:

- `name` string. Target name.
  - Example: `nix_node_bin(name = "node_bin")`
- `srcs` list of labels or files. Inputs.
  - Example: `srcs = ["src/cli.ts"]`
- `out` string. Output filename.
  - Example: `out = "cli.out"`
- `cmd` string. Shell command to run.
  - Example: `cmd = "cp $(location src/cli.ts) $OUT"`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":lib"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:web"]`
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"`

### `node_webapp(name, labels = [], lockfile_label = None, importer = None, out = None, **kwargs)`

Use this for Vite-style web apps built from a Node workspace.

Public args:

- `name` string. Target name.
  - Example: `node_webapp(name = "webapp")`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:web"]`
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"`
- `importer` string. Optional package name. Must match the lockfile label suffix.
  - Example: `importer = "projects/apps/web"`
- `out` string. Output directory name. Default is `dist`.
  - Example: `out = "dist"`

### `nix_node_cli_bin(name, entry = None, out = None, labels = [], deps = [], lockfile_label = None, bundle = False, importer = None, **kwargs)`

Use this for Node command line tools. Choose `bundle = True` when you want a single file output.

Public args:

- `name` string. Target name.
  - Example: `nix_node_cli_bin(name = "cli")`
- `entry` string. Entry file for the CLI. Defaults to `bin/<name>` when `bundle = False`. Must be `src/index.ts` when `bundle = True`.
  - Example: `entry = "bin/cli"`
- `out` string. Output filename. Defaults to `name`.
  - Example: `out = "my-cli"`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:web"]`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":lib"]`
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"`
- `bundle` bool. Use a bundled Nix build when true.
  - Example: `bundle = True`
- Allowed values:
  - `False` copies the entry file to the output.
  - `True` builds a single file bundle.
- `importer` string. Optional package name. Must match the lockfile label suffix.
  - Example: `importer = "projects/apps/web"`

### `node_asset_stage(name, app, assets = [], out = None, deps = [], labels = [], lockfile_label = None, **kwargs)`

Use this to stage a webapp output with extra assets into one directory.

Public args:

- `name` string. Target name.
  - Example: `node_asset_stage(name = "web_assets")`
- `app` label. Webapp output to copy.
  - Example: `app = ":webapp"`
- `assets` list of dicts. Each item requires `src` and `dest`, and may set one selector.
  - Example: `assets = [{"src": "//assets:logo", "dest": "img/logo.svg"}]`
  - Optional selector keys:
    - `artifact_name` string. Exact wasm filename when `src` resolves to a directory.
      - Example: `{"src": "//libs:py_wasm", "artifact_name": "pyext.wasm", "dest": "wasm/py.wasm"}`
    - `artifact_glob` string. Glob selector for controlled unstable names when `src` resolves to a directory.
      - Example: `{"src": "//libs:wasm_out", "artifact_glob": "module-*.wasm", "dest": "wasm/module.wasm"}`
  - Do not set both `artifact_name` and `artifact_glob` on the same asset.
- Directory resolution defaults when no selector is set:
  - Prefer `top.wasm` when present.
  - Otherwise require exactly one `*.wasm` match (scan bounded to directory, one level, and two levels).
  - Fail deterministically on zero or multiple matches with a disambiguation message.
- `out` string. Output directory name. Default is `dist`.
  - Example: `out = "dist"`
- `deps` list of labels. Optional direct deps.
  - Example: `deps = [":app_raw"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:web"]`
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"`

### `node_wasm_inline_module(name, src, out = None, artifact_name = None, artifact_glob = None, labels = [], lockfile_label = None, **kwargs)`

Use this to wrap a wasm file into a JS module for Node usage.

Public args:

- `name` string. Target name.
  - Example: `node_wasm_inline_module(name = "inline_wasm")`
- `src` label. Wasm file input.
  - Example: `src = ":core_wasm"`
- `out` string. Output filename. Default is `index.js`.
  - Example: `out = "inline.js"`
- `artifact_name` string. Exact wasm filename when `src` resolves to a directory.
  - Example: `artifact_name = "cpp_emscripten.wasm"`
- `artifact_glob` string. Glob selector for controlled unstable names when `src` resolves to a directory.
  - Example: `artifact_glob = "module-*.wasm"`
- Do not set both `artifact_name` and `artifact_glob`.
- Directory resolution defaults when no selector is set:
  - Prefer `top.wasm` when present.
  - Otherwise require exactly one `*.wasm` match (bounded scan).
  - Fail deterministically on zero or multiple matches with a clear selector hint.
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:web"]`
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"`

### End-to-end webapp WASM examples

These examples show complete wiring for webapps that need runtime WASM assets plus an inline module.
Contract notes for all examples:

- `top.wasm` is the canonical browser-runtime filename expected by the client helper (`new URL("/top.wasm", ...)`).
- `server/wasm-contract/top.wasm` is the canonical server-side parity path used by SSR runtimes.
- Producer outputs can keep their native filename (for example `lib/top.wasm` or `pyext.wasm`), while `node_asset_stage(..., dest = ".../top.wasm")` normalizes the runtime path.

```python
# static webapp: top.wasm + wasm-inline module in dist/
load("//build-tools/node:defs.bzl", "node_asset_stage", "node_wasm_inline_module", "node_webapp")

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
        {"src": "src/wasm-contract/top.wasm", "dest": "server/wasm-contract/top.wasm"},
    ],
    labels = ["lang:node", "kind:app", "webapp:static"],
    out = "dist",
)
```

```python
# Vite webapp + Python wasm library:
# normalize Python producer output to canonical runtime contract paths
load("//build-tools/node:defs.bzl", "node_asset_stage", "node_wasm_inline_module", "node_webapp")
load("//build-tools/python:defs.bzl", "nix_python_wasm_lib")

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
        {"src": "//projects/libs/demo-py-wasm:py_wasm", "dest": "server/wasm-contract/top.wasm"},
    ],
    labels = ["lang:node", "kind:app", "webapp:static"],
    out = "dist",
)
```

```python
# SSR express webapp: client + server contract paths
load("//build-tools/node:defs.bzl", "node_asset_stage", "node_wasm_inline_module", "node_webapp")

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
        {"src": "src/wasm-contract/top.wasm", "dest": "server/wasm-contract/top.wasm"},
    ],
    labels = ["lang:node", "kind:app", "webapp:ssr", "framework:express"],
    out = "dist",
)
```

```python
# SSR next webapp: client/public + server contract paths
load("//build-tools/node:defs.bzl", "node_asset_stage", "node_wasm_inline_module", "node_webapp")

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
        {"src": "app/wasm-contract/top.wasm", "dest": "server/wasm-contract/top.wasm"},
    ],
    labels = ["lang:node", "kind:app", "webapp:ssr", "framework:next"],
    out = "dist",
)
```

TypeScript usage examples:

```ts
// client-side usage (static, SSR vite, and SSR next)
// For SSR next, these URLs resolve from dist/client/public.
// For static and SSR vite, they resolve from dist/ and dist/client.
export async function readWasmContractBytes(): Promise<Uint8Array> {
  const wasmUrl = new URL("/top.wasm", window.location.href).toString();
  const wasmRes = await fetch(wasmUrl);
  if (!wasmRes.ok) throw new Error(`failed to load wasm: ${wasmRes.status}`);

  const inlineUrl = new URL("/wasm-inline/index.js", window.location.href).toString();
  const inlineRes = await fetch(inlineUrl);
  if (!inlineRes.ok) throw new Error(`failed to load inline module: ${inlineRes.status}`);

  return new Uint8Array(await wasmRes.arrayBuffer());
}
```

```ts
// server-side usage (SSR vite and SSR next)
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fsp from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wasmCandidates = [
  path.resolve(__dirname, "wasm-contract", "top.wasm"),
  path.resolve(__dirname, "../client/top.wasm"),
  path.resolve(__dirname, "../client/public/top.wasm"),
];

export async function readServerWasmContractByteLength(): Promise<number> {
  for (const candidate of wasmCandidates) {
    try {
      const bytes = await fsp.readFile(candidate);
      return bytes.byteLength;
    } catch {}
  }
  throw new Error("server wasm contract asset is missing from expected runtime paths");
}
```

## Python macros

Load from `//build-tools/python:defs.bzl`.

### `nix_python_library(name, lockfile_label = None, deps = [], **kwargs)`

Use this for Python libraries consumed by other Python targets.

Public args:

- `name` string. Target name.
  - Example: `nix_python_library(name = "py_lib")`
- `srcs` list of file paths. Python sources.
  - Example: `srcs = ["pkg/__init__.py"]`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:etl"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/etl/uv.lock#projects/apps/etl"`
- `nixpkg_deps` list of strings. System deps used by native extensions.
  - Example: `nixpkg_deps = ["openssl", "zlib"]`

### `nix_python_binary(name, lockfile_label = None, deps = [], **kwargs)`

Use this for Python executables.

Public args:

- `name` string. Target name.
  - Example: `nix_python_binary(name = "etl")`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":py_lib"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:etl"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/etl/uv.lock#projects/apps/etl"`
- `main` string. Main file.
  - Example: `main = "main.py"`
- `main_module` string. Main module name.
  - Example: `main_module = "app.main"`
- `nixpkg_deps` list of strings. System deps used by native extensions.
  - Example: `nixpkg_deps = ["openssl", "zlib"]`

### `nix_python_test(name, lockfile_label = None, deps = [], **kwargs)`

Use this for Python tests.

Public args:

- `name` string. Target name.
  - Example: `nix_python_test(name = "py_tests")`
- `srcs` list of file paths. Python test files.
  - Example: `srcs = ["tests/test_app.py"]`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":py_lib"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:etl"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/etl/uv.lock#projects/apps/etl"`
- `nixpkg_deps` list of strings. System deps used by native extensions.
  - Example: `nixpkg_deps = ["openssl", "zlib"]`

### `nix_python_extension_module(name, module, srcs, headers = [], lockfile_label = None, deps = [], nixpkg_deps = [], cflags = [], ldflags = [], build_py_deps = [], link_deps = [], header_deps = [], link_closure = "direct", link_closure_overrides = None, **kwargs)`

Use this for CPython extension modules implemented in C or C++.

Public args:

- `name` string. Target name.
  - Example: `nix_python_extension_module(name = "native_ext", module = "mypkg._native", srcs = ["native/ext.cc"])`
- `module` string. Python module name for the extension.
  - Example: `module = "mypkg._native"`
- `srcs` list of file paths. Extension sources.
  - Example: `srcs = ["native/ext.cc"]`
- `headers` list of file paths. Header inputs.
  - Example: `headers = ["native/ext.h"]`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":py_lib"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:etl"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/etl/uv.lock#projects/apps/etl"`
- `nixpkg_deps` list of strings. System deps for native build.
  - Example: `nixpkg_deps = ["openssl", "zlib"]`
- `cflags` list of strings. Extra C/C++ compiler flags.
  - Example: `cflags = ["-O2"]`
- `ldflags` list of strings. Extra linker flags.
  - Example: `ldflags = ["-Wl,-rpath,$ORIGIN"]`
- `build_py_deps` list of labels. Python deps used at build time.
  - Example: `build_py_deps = [":codegen"]`
- `link_deps` list of labels. Link deps.
  - Example: `link_deps = ["//third_party:openssl"]`
- `header_deps` list of labels. Header deps.
  - Example: `header_deps = ["//third_party:zlib"]`
- `link_closure` string. Link closure policy. Default is `direct`.
  - Example: `link_closure = "direct"`
- `link_closure_overrides` dict. Per dep closure overrides.
  - Example: `link_closure_overrides = {"//third_party:openssl": "transitive"}`

### `nix_python_wasm_extension_module(name, module, srcs, headers = [], lockfile_label = None, deps = [], labels = [], cflags = [], ldflags = [], build_py_deps = [], link_deps = [], header_deps = [], link_closure = "direct", link_closure_overrides = None, **kwargs)`

Use this for CPython extension modules targeting wasm.

Public args:

- `name` string. Target name.
  - Example: `nix_python_wasm_extension_module(name = "py_wasm_ext", module = "mypkg._native", srcs = ["native/ext.cc"], labels = ["backend:wasi"])`
- `module` string. Python module name for the extension.
  - Example: `module = "mypkg._native"`
- `srcs` list of file paths. Extension sources.
  - Example: `srcs = ["native/ext.cc"]`
- `headers` list of file paths. Header inputs.
  - Example: `headers = ["native/ext.h"]`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":py_lib"]`
- `labels` list of strings. Must include exactly one `backend:*` label.
  - Example: `labels = ["backend:wasi"]`
- Allowed values for `backend:*`:
  - `backend:wasi` builds a WASI-compatible module.
  - `backend:pyodide` builds a Pyodide-compatible module.
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/etl/uv.lock#projects/apps/etl"`
- `cflags` list of strings. Extra C/C++ compiler flags.
  - Example: `cflags = ["-O2"]`
- `ldflags` list of strings. Extra linker flags.
  - Example: `ldflags = ["-Wl,-rpath,$ORIGIN"]`
- `build_py_deps` list of labels. Python deps used at build time.
  - Example: `build_py_deps = [":codegen"]`
- `link_deps` list of labels. Link deps.
  - Example: `link_deps = ["//third_party:openssl"]`
- `header_deps` list of labels. Header deps.
  - Example: `header_deps = ["//third_party:zlib"]`
- `link_closure` string. Link closure policy. Default is `direct`.
  - Example: `link_closure = "direct"`
- Allowed values:
  - `direct` uses only the direct `link_deps`.
  - `transitive` follows `link_deps` recursively.
- `link_closure_overrides` dict. Per dep closure overrides.
  - Example: `link_closure_overrides = {"//third_party:openssl": "transitive"}`
  - Allowed values for each override:
    - `direct` uses only the direct `link_deps` for that dep.
    - `transitive` follows that dep's `link_deps` recursively.

### `nix_python_wasm_app(name, lockfile_label = None, deps = [], labels = [], **kwargs)`

Use this for Python apps targeting wasm runtimes.

Public args:

- `name` string. Target name.
  - Example: `nix_python_wasm_app(name = "py_wasm_app")`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":py_lib"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:etl"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/etl/uv.lock#projects/apps/etl"`
- `nixpkg_deps` list of strings. System deps used by native extensions.
  - Example: `nixpkg_deps = ["openssl", "zlib"]`

### `nix_python_wasm_lib(name, lockfile_label = None, deps = [], labels = [], **kwargs)`

Use this for Python libraries targeting wasm runtimes.

Public args:

- `name` string. Target name.
  - Example: `nix_python_wasm_lib(name = "py_wasm_lib")`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":py_lib"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:etl"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
- `lockfile_label` string. Lockfile label in the form `lockfile:<path>#<package>`.
  - Example: `lockfile_label = "lockfile:projects/apps/etl/uv.lock#projects/apps/etl"`
- `nixpkg_deps` list of strings. System deps used by native extensions.
  - Example: `nixpkg_deps = ["openssl", "zlib"]`

## Rust macros

Load from `//build-tools/rust:defs.bzl`.

### `rust_library(name, **kwargs)`

Use this for Rust libraries.

Public args:

- `name` string. Target name.
  - Example: `rust_library(name = "rust_lib")`
- `srcs` list of file paths. Rust sources.
  - Example: `srcs = ["src/lib.rs"]`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`

### `rust_binary(name, **kwargs)`

Use this for Rust executables.

Public args:

- `name` string. Target name.
  - Example: `rust_binary(name = "rust_bin")`
- `srcs` list of file paths. Rust sources.
  - Example: `srcs = ["src/main.rs"]`
- `deps` list of labels. Direct deps.
  - Example: `deps = [":core"]`
- `labels` list of strings. Optional labels to add.
  - Example: `labels = ["team:core"]`
- `visibility` list of labels. Optional visibility.
  - Example: `visibility = ["//visibility:public"]`
