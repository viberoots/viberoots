# C++ linking semantics examples (TARGETS)

This file contains example call sites for the semantics and patterns described in `build-tools/docs/cpp-linking.md`.

## Conventions used in examples

- I use `link_deps` and `header_deps` as intent lists.
- The macro computes `deps := deps ∪ link_deps ∪ header_deps` so examples do not repeat labels.
- `link_closure` only affects how a consumer materializes link inputs. Libraries declare their own `link_deps`.

## 1) C++ binary links an in-repo C++ static library (direct)

```python
# libs/math/TARGETS
load("//build-tools/cpp:defs.bzl", "nix_cpp_library")

nix_cpp_library(
    name = "math_core",
    srcs = glob(["src/**/*.cpp"]),
    headers = glob(["include/**/*.h"]),
    visibility = ["PUBLIC"],
)
```

```python
# apps/calc/TARGETS
load("//build-tools/cpp:defs.bzl", "nix_cpp_binary")

nix_cpp_binary(
    name = "calc",
    srcs = ["src/main.cpp"],
    link_deps = ["//projects/libs/math:math_core"],
    link_closure = "direct",
)
```

## 2) C++ library depends on another in-repo C++ library (compile + link intent)

```python
# libs/support/TARGETS
load("//build-tools/cpp:defs.bzl", "nix_cpp_library")

nix_cpp_library(
    name = "support",
    srcs = glob(["src/**/*.cpp"]),
    headers = glob(["include/**/*.h"]),
    visibility = ["PUBLIC"],
)
```

```python
# libs/math/TARGETS
load("//build-tools/cpp:defs.bzl", "nix_cpp_library")

nix_cpp_library(
    name = "math_core",
    srcs = glob(["src/**/*.cpp"]),
    headers = glob(["include/**/*.h"]),
    link_deps = ["//projects/libs/support:support"],
    visibility = ["PUBLIC"],
)
```

Consumers can choose whether to list support explicitly (direct) or rely on transitive link closure (next example).

## 3) C++ binary links transitive library requirements (transitive closure)

`math_core` has `link_deps = ["//projects/libs/support:support"]`. The binary only mentions `math_core`.

```python
# apps/calc/TARGETS
load("//build-tools/cpp:defs.bzl", "nix_cpp_binary")

nix_cpp_binary(
    name = "calc",
    srcs = ["src/main.cpp"],
    link_deps = ["//projects/libs/math:math_core"],
    link_closure = "transitive",
)
```

## 4) Header-only dependency (include paths only)

```python
# libs/api-headers/TARGETS
load("//build-tools/cpp:defs.bzl", "nix_cpp_headers")

nix_cpp_headers(
    name = "api_headers",
    headers = glob(["include/**/*.h"]),
    visibility = ["PUBLIC"],
)
```

```python
# apps/uses-headers/TARGETS
load("//build-tools/cpp:defs.bzl", "nix_cpp_binary")

nix_cpp_binary(
    name = "uses_headers",
    srcs = ["src/main.cpp"],
    header_deps = ["//projects/libs/api-headers:api_headers"],
)
```

## 5) Link-only dependency (no headers consumed)

Example shape: you declare function prototypes yourself (C ABI) or only use opaque handles.

```python
# apps/link-only/TARGETS
load("//build-tools/cpp:defs.bzl", "nix_cpp_binary")

nix_cpp_binary(
    name = "link_only",
    srcs = ["src/main.cpp"],
    link_deps = ["//projects/libs/math:math_core"],
)
```

## 6) C++ Node-API addon links an in-repo C++ library

```python
# libs/addon-native/TARGETS
load("//build-tools/cpp:defs.bzl", "nix_cpp_node_addon")

nix_cpp_node_addon(
    name = "napi_addon",
    srcs = [
        "src/addon.cc",
        "src/binding.cc",
    ],
    headers = glob(["include/**/*.h"]),
    link_deps = ["//projects/libs/math:math_core"],
    addon_name = "calc_native",
    visibility = ["PUBLIC"],
)
```

## 7) C++ test links an in-repo C++ library

```python
# libs/math/TARGETS
load("//build-tools/cpp:defs.bzl", "nix_cpp_test")

nix_cpp_test(
    name = "math_gtest",
    srcs = ["tests/math_gtest.cpp"],
    link_deps = ["//projects/libs/math:math_core"],
    deps = [
        # Example of nixpkgs dep via provider target
        "//third_party/providers:nix_pkgs_googletest",
    ],
)
```

## 8) C++ shared library (opt-in) and a binary consuming it

⚠️ This example assumes we add a dedicated macro for shared libs (or an explicit producer-side knob)
and that runtime loading is handled (rpath or packaging) as described in `cpp-linking.md`.

```python
# libs/runtime/TARGETS
load("//build-tools/cpp:defs.bzl", "nix_cpp_shared_library")

nix_cpp_shared_library(
    name = "runtime",
    srcs = glob(["src/**/*.cpp"]),
    headers = glob(["include/**/*.h"]),
    visibility = ["PUBLIC"],
)
```

```python
# apps/uses-shared/TARGETS
load("//build-tools/cpp:defs.bzl", "nix_cpp_binary")

nix_cpp_binary(
    name = "uses_shared",
    srcs = ["src/main.cpp"],
    link_deps = ["//projects/libs/runtime:runtime"],
    link_closure = "transitive",
)
```
