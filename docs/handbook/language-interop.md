## Rust ↔ C/C++ Interoperability

Rust consumes C and C++ only through `rust_c_ffi_library` or `rust_cxx_bridge_library` with
explicit `link_deps`, `header_deps`, and a package-local reviewed binding configuration. Ordinary
Rust macros reject native link/header intent, so a handwritten `extern` block cannot bypass the
generated ABI contract; ordinary `deps` never implies native linking:

```python
load("@viberoots//build-tools/rust:defs.bzl", "rust_cxx_bridge_library")

rust_cxx_bridge_library(
    name = "core_ffi",
    binding_config = "bindings.json",
    crate = "core",
    artifact = "static",
    panic_strategy = "abort",
    exception_policy = "noexcept",
    visibility = ["PUBLIC"],
)
```

The binding schema admits stable C-layout scalar and pointer shapes. Model strings and owned
objects with explicit pointer/length and destructor functions, callbacks with context pointers,
and errors with explicit status values. Never allow Rust panics or C++ exceptions to unwind across
the boundary. Generated `.h`, `.hpp`, `.cc`, and manifest files live in the Nix output and are not
checked-in source authority. C++ consumers declare the bridge in both `link_deps` and
`header_deps`; the canonical planner carries direct/transitive closure, source profiles, pins, and
runtime libraries.

The planner's ordinary native closure machinery remains an internal implementation detail used by
reviewed bridge construction. It intentionally does not apply bridge standard/STL compatibility
checks to unrelated header-only graph edges, but it is not exposed as a second public FFI route.

The JSON schema rejects unknown keys, ambient or parent-relative headers, duplicate names, and
untyped fallback snippets. A Rust-owned pointer requires both an `ownership: "rust"` producer and
an `ownership: "destructor"` function. With contained C++ callbacks, the exported callback
function also requires a numeric `callback_error_value`.

For Rust calling C, declare an import with `direction: "import"`, `native_name`, and a reviewed
`.h` header. For Rust calling C++, use `cpp_name` and a reviewed C++ header. Bridge construction
compiles the generated `.c` or `.cc` C-ABI shim with pinned Clang (`c11` or `c++17`/libc++) and
supplies the crate-named shim to Cargo and the downstream runtime closure.
`exception_policy = "contained"` requires an explicit error value and converts a thrown C++
exception to that value.

```json
{
  "schema": "viberoots.rust-interop.v1",
  "headers": ["native.hpp"],
  "functions": [
    { "name": "rust_make", "return": "mut_void_ptr", "ownership": "rust", "params": [] },
    {
      "name": "rust_destroy",
      "return": "void",
      "ownership": "destructor",
      "params": [{ "name": "value", "type": "mut_void_ptr" }]
    },
    {
      "name": "vbr_native",
      "direction": "import",
      "cpp_name": "native_value",
      "header": "native.hpp",
      "return": "i32",
      "error_value": -1,
      "params": []
    }
  ]
}
```

Only `panic_strategy = "abort"` and `thread_safety = "send-sync"` are implemented. The macros
reject claimed containment or single-thread enforcement because metadata alone cannot provide
those guarantees.

### Complete Rust/C route

Declare a C11 provider and reviewed header:

```python
nix_cpp_headers(
    name = "native_headers",
    language_standard = "c11",
    stl = "none",
    srcs = ["include/native.h"],
)
nix_cpp_library(
    name = "native",
    language_standard = "c11",
    stl = "none",
    srcs = ["src/native.c"],
    header_deps = [":native_headers"],
)
```

The binding file imports the C symbol and exports the Rust symbol:

```json
{
  "schema": "viberoots.rust-interop.v1",
  "headers": ["native.h"],
  "functions": [
    {
      "name": "vbr_native_value",
      "native_name": "native_value",
      "direction": "import",
      "header": "native.h",
      "return": "i32",
      "params": []
    },
    { "name": "rust_answer", "return": "i32", "params": [] }
  ]
}
```

Rust calls the generated declaration—there is no handwritten `extern` block:

```rust
#[no_mangle]
pub extern "C" fn rust_answer() -> i32 {
    unsafe { __viberoots_abi::vbr_native_value() + 2 }
}
```

```python
rust_c_ffi_library(
    name = "bridge",
    binding_config = "bindings.json",
    srcs = ["src/lib.rs"],
    link_deps = ["//projects/libs/native:native"],
    header_deps = ["//projects/libs/native:native_headers"],
)
nix_cpp_binary(
    name = "consumer",
    language_standard = "c11",
    stl = "none",
    srcs = ["src/main.c"],
    link_deps = [":bridge"],
    header_deps = [":bridge"],
)
```

The C consumer includes the generated `<crate>.h` and calls `rust_answer()`.

### Complete Rust/C++ route

Use a C++17/libc++ provider and headers, then declare `cpp_name`, a contained typed fallback, and
the same generated Rust import:

```json
{
  "schema": "viberoots.rust-interop.v1",
  "namespace": "core_bridge",
  "headers": ["native.hpp"],
  "functions": [
    {
      "name": "vbr_native_value",
      "cpp_name": "native::value",
      "direction": "import",
      "header": "native.hpp",
      "return": "i32",
      "error_value": -1,
      "params": []
    },
    { "name": "rust_answer", "return": "i32", "params": [] }
  ]
}
```

```python
rust_cxx_bridge_library(
    name = "bridge",
    binding_config = "bindings.json",
    exception_policy = "contained",
    srcs = ["src/lib.rs"],
    link_deps = ["//projects/libs/native:native_cpp"],
    header_deps = ["//projects/libs/native:native_cpp_headers"],
)
nix_cpp_binary(
    name = "consumer",
    srcs = ["src/main.cpp"],
    link_deps = [":bridge"],
    header_deps = [":bridge"],
)
```

The C++ consumer includes `<crate>.hpp` and calls `core_bridge::rust_answer()`. Callbacks are
supported only by contained C++ exports and must be exactly `(callback_i32, mut_void_ptr)` with a
numeric `callback_error_value`; noexcept callbacks are rejected.

### Rust interop troubleshooting

- A `mismatched ...` planner error means the bridge and native target disagree on source profile,
  exact pins, LLVM identity, target triple, C/C++ standard, STL, or module surface. Correct the
  target declarations; do not bypass the comparison. Native macros stamp the canonical selected
  target triple into the graph, and the planner derives compiler identity from each target's
  selected source-plan Nix LLVM package.
- A Rust function-pointer type error points to drift between `bindings.json` and the actual
  exported Rust function. Update one source of truth so return and parameter types match exactly.
- `import ... must name one declared header` means the header is absent from the root `headers`
  array or is not package-relative.
- Loader errors should be diagnosed from the built artifact (`otool -L` on Darwin or
  `readelf -d` on Linux). Bridge runtime packages and output-relative loader paths must remain in
  the selected graph; host `LD_LIBRARY_PATH`/`DYLD_LIBRARY_PATH` is not authority.

## Go ↔ C/C++ Interoperability

This guide explains how to link C/C++ into Go (cgo) and how to call Go from C/C++ using a c-archive. It follows our build-system design and repository methodology: Buck2 orchestrates the graph, Nix provides hermetic toolchains, and macros keep TARGETS tidy.

### Prerequisites

- Use the dev shell via direnv so `buck2`, `nix`, `go`, and `pkg-config` are on PATH.
- Run the startup check if needed:

```bash
node viberoots/build-tools/tools/dev/startup-check.ts
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
b
```

- Full test suite with coverage:

```bash
v
```

---

### Troubleshooting

- Missing `pkg-config` files: the Go templates will synthesize flags, but prefer proper pkg-config when available.
- Sparse checkouts: language enablement is presence-based; missing language files should be skipped gracefully.
- Determinism: both templates use sorted file lists and stable flags; unexpected rebuilds typically indicate changed inputs (TARGETS, .bzl, sources, or lockfiles).
