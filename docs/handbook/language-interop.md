## Go ↔ C/C++ Interoperability

This guide explains how to link C/C++ into Go (cgo) and how to call Go from C/C++ using a c-archive. It follows our build-system design and repository methodology: Buck2 orchestrates the graph, Nix provides hermetic toolchains, and macros keep TARGETS tidy.

### Prerequisites

- Use the dev shell via direnv so `buck2`, `nix`, `go`, and `pkg-config` are on PATH.
- Run the startup check if needed:

```bash
node build-tools/tools/dev/startup-check.ts
```

---

### Go → C/C++ (cgo) — Link C/C++ into Go

You can consume both in-repo C/C++ libraries and nixpkgs-provided native libraries from Go.

Before you get into cgo-specific wiring, it helps to know one macro convenience that keeps small CLIs tidy. When `nix_go_binary(name = "<bin>", ...)` detects `*_test.go` files under `cmd/<bin>/**`, it auto-creates two helper targets:

- **`<bin>_pkg`**: a Go library target used as the `library` for tests. It uses the same wiring contracts as `nix_go_library` (provider edges + package-local patch inputs + standard label stamping).
- **`<bin>_test`**: a Go test target that compiles and runs the `cmd/<bin>` tests without requiring you to edit `TARGETS` after adding new test files.

Implementation detail: the helper-target synthesis lives in `build-tools/go/private/auto_tests.bzl` and is called by `build-tools/go/defs.bzl`. Do not duplicate this logic in other macros.

1. Create or use a C/C++ library target (in-repo):

```python
# projects/libs/greeter/TARGETS
load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")

nix_cpp_library(
    name = "greeter",
    srcs = ["src/greeter.cpp"],
    headers = ["include/greeter.h"],
    labels = ["lang:cpp", "kind:lib"],
)
```

2. Consume it from a Go target via `repo_cgo_deps`; optionally add nixpkgs deps via `nixpkg_deps`:

```python
# projects/apps/demo-cli/TARGETS
load("@viberoots//build-tools/go:defs.bzl", "nix_go_binary")

nix_go_binary(
    name = "demo",
    srcs = ["cmd/demo/main.go"],
    repo_cgo_deps = ["//projects/libs/greeter:greeter"],          # in-repo C/C++
    nixpkg_deps = ["pkgs.openssl"],                       # nixpkgs native deps (optional)
    # Note: nix_cgo_pkgconfig is currently unsupported (fails fast if provided).
)
```

3. In your Go code, include headers and (optionally) LDFLAGS in the cgo preamble. Example:

```go
// #cgo LDFLAGS: -lstdc++
// #include "greeter.h"
import "C"

func main() {
  s := C.greet() // call into C/C++
  _ = s
}
```

Implementation notes

- Transparent CGO: our Go macros automatically enable CGO when either of these is true:
  - The target lists any C-family source files in `srcs` (e.g., `.c`, `.cpp`, `.m`, `.mm`, `.s`).
  - The target declares `nixpkg_deps` or `repo_cgo_deps`.
    No TARGETS edits are required when adding/removing C sources.
- Implementation detail: the CGO decision and toolchain defaults are centralized in `build-tools/go/private/cgo_wiring.bzl`, shared by `nix_go_library`, `nix_go_binary`, and `nix_go_test`.
- Implementation detail: shared behavior for `nix_cpp_library`, `nix_cpp_binary`, and `nix_cpp_node_addon` is centralized in `_cpp_common` in `build-tools/cpp/defs.bzl`. Public macro surfaces are unchanged; wasm macros stay separate.
- Macro wiring note: macro implementations should route through the shared wiring surface (`prepare_language_wiring(...)`) and load provider mappings via `@workspace_providers//:auto_map.bzl` rather than `//.viberoots/workspace/providers/auto_map.bzl`.
- The Go Nix templates set `CGO_ENABLED=1` only for those targets and ensure CC/CXX/AR come from Nix.
- If `pkg-config` metadata is missing, templates synthesize `CGO_CFLAGS`/`CGO_LDFLAGS` from provided packages.
- Planner wiring passes nixpkgs attributes and in-repo C/C++ libs so builds are hermetic and deterministic.

---

### C/C++ → Go (c-archive) — Call Go from C/C++

To call Go from C/C++, build your Go package as a c-archive and link it into a C++ binary.

1. Declare a Go c-archive target:

```python
# projects/libs/greetgo/TARGETS
load("@viberoots//build-tools/go:defs.bzl", "nix_go_carchive")

nix_go_carchive(
    name = "greetgo",
    srcs = ["export.go"],
    labels = ["lang:go", "kind:carchive"],
    visibility = ["PUBLIC"],
)
```

2. Export C-callable symbols from Go:

```go
// projects/libs/greetgo/export.go
package greetgo

// #include <stdint.h>
import "C"

//export GoGreet
func GoGreet() *C.char { return C.CString("hello from go") }
```

3. Link the Go c-archive into a C++ binary and call the exported symbol:

```python
# projects/apps/caller/TARGETS
load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_binary")

nix_cpp_binary(
    name = "caller",
    srcs = ["src/main.cpp"],
    deps = ["//projects/libs/greetgo:greetgo"],
    labels = ["lang:cpp", "kind:bin"],
)
```

```cpp
// projects/apps/caller/src/main.cpp
#include <iostream>
extern "C" char* GoGreet();

int main() {
  char* s = GoGreet();
  if (s) std::cout << s << "\n";
  return 0;
}
```

Implementation notes

- The `nix_go_carchive` macro stamps labels used by the planner to produce a derivation that the C++ templates can link.
- The C++ Nix templates automatically add `-L` for package lib directories and discover `lib*.a` to link with `-l<name>`.
- Headers generated by the c-archive build are installed under `$out/include/` and are discoverable at link time.

---

### Build and Test

- Build only (fast):

```bash
./build-tools/tools/bin/b
```

- Full test suite with coverage:

```bash
./build-tools/tools/bin/v
```

---

### Troubleshooting

- Missing `pkg-config` files: the Go templates will synthesize flags, but prefer proper pkg-config when available.
- Sparse checkouts: language enablement is presence-based; missing language files should be skipped gracefully.
- Determinism: both templates use sorted file lists and stable flags; unexpected rebuilds typically indicate changed inputs (TARGETS, .bzl, sources, or lockfiles).
