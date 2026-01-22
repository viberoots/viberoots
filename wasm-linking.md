# Wasm linking semantics in Buck2 + Nix planner

This document proposes a design to support explicit, deterministic Wasm dependency semantics for targets that produce Wasm artifacts in this repo.

I base this on the same conceptual model as `cpp-linking.md`:

- Buck is the source of truth for the dependency graph and impact analysis.
- Nix templates build the actual artifacts.
- The planner translates the Buck graph into Nix inputs deterministically.
- Call sites express intent explicitly, rather than relying on inference.

The Wasm case needs adaptations because:

- Wasm outputs are typically single-module artifacts (a `.wasm`, sometimes paired with a JS loader).
- Link compatibility depends on the Wasm variant and ABI (WASI vs unknown vs Emscripten).
- Some “targets” are planner-visible stubs rather than normal Buck-native artifacts.

## Problem statement

Today, Wasm linking behavior exists, but it is not expressed with a single, explicit semantic model:

- Go TinyGo Wasm targets can link direct in-repo C++ Wasm static libs (planner wiring exists).
- C++ has separate Wasm macro surfaces (static lib, Emscripten bundle) with different artifact shapes than native C++.

The design goal is to make Wasm “what links into what” explicit and consistent, while keeping variant constraints enforced and deterministic.

## Goals

The design must:

I want Wasm linking semantics that:

- Support Wasm-producing targets as both producers and consumers (a Wasm library can depend on another Wasm library).
- Make variant compatibility explicit (a target built for WASI cannot silently link an Emscripten library).
- Support direct and transitive link closure policies.
- Support header-only deps where they are meaningful (mostly for C/C++ code compiled to Wasm).
- Preserve Buck’s impact analysis and minimal invalidation surfaces.
- Keep the planner small and concentrated in language adapters.

## Non-goals

- Unifying all Wasm variants into one artifact shape. Emscripten output is a JS+Wasm bundle and does not fit the same rule shape as a single `.wasm`.
- Introducing implicit inference of “this dep should be linked” from filename scanning.

## Glossary

- **Wasm variant**: the ABI/toolchain target, such as `wasm32-wasi`, `wasm32-unknown-unknown`, or `emscripten`.
- **Wasm producer**: a target that produces a Wasm artifact (`.wasm` or Emscripten bundle).
- **Wasm consumer**: a target that links other Wasm-compatible libraries into its output.
- **Link deps**: dependencies that must contribute linkable artifacts to the Wasm link step.
- **Header deps**: dependencies that contribute headers/include paths for compilation but do not contribute link artifacts.

## Proposed model (shared concept with C++)

I use the same concept as `cpp-linking.md`: separate “graph dependency” from “link intent”.

At the call site:

- `deps` remains the general Buck graph edge list.
- `link_deps` expresses “link this dep into my Wasm output”.
- `header_deps` expresses “use headers from this dep while compiling” (when applicable).

For ergonomics and correctness, the macro computes:

- `deps := deps ∪ link_deps ∪ header_deps` (deterministic union)

For closure:

- `link_closure = "direct" | "transitive"` defines whether we link only direct `link_deps` or follow `link_deps` recursively.

This is intentionally parallel to the C++ design so we can reuse shared code.

## What changes for Wasm (adaptations)

### Variant constraints are first-class

For Wasm, link compatibility depends on variant. I treat variant as part of the semantic model.

I propose:

- Every Wasm producer target is stamped with:
  - `kind:wasm`
  - `wasm:<variant>` (for example `wasm:wasi`, `wasm:static`, `wasm:emscripten`)
  - optionally a concrete `wasm_target:<triple>` when needed (`wasm32-wasi` vs `wasm32-unknown-unknown`)

The planner must enforce:

- a consumer may only link deps that are compatible with its variant
- incompatibility fails deterministically with an actionable error

### “Shared library” is not a primary concept

Wasm linking usually produces one module that includes everything it needs. There is no direct analogue of “shared library runtime search path” for the typical Wasm use cases here.

So for Wasm:

- I do not introduce `link_kind="shared"` as a first-class concept.
- I keep the model centered on “link into the module”.

If we later need a componentized Wasm story (multiple modules, dynamic linking), that should be a separate design with explicit constraints.

## User-facing API (Starlark macros)

### Target types this doc covers

In this repo, the concrete Wasm-producing target surfaces include:

- Go TinyGo Wasm module: `nix_go_tiny_wasm_lib`
- C++ Wasm static lib: `nix_cpp_wasm_static_lib`
- C++ Emscripten bundle stub: `nix_cpp_wasm_emscripten_lib`
- Python WASI app/lib surfaces: `nix_python_wasm_app`, `nix_python_wasm_lib`
- TS webapp scaffold: `node_webapp` (application packaging/build target; may consume Wasm artifacts, but does not itself “link” them)

This document proposes linking semantics primarily for:

- Go TinyGo Wasm modules (consumers)
- C++ Wasm static libs (producers and potential consumers if we add a Wasm “module” target for C++)

And it includes “application target” examples for:

- Python WASI apps (`nix_python_wasm_app`)
- Node webapps (`node_webapp`)

## Scaffolding

To get a working Phase 2 demo layout quickly, use the `scaf` template:

```bash
scaf new ts wasm-linking-app <name>
```

This scaffold includes:

- a C++ Wasm static lib that declares `header_deps` and `link_deps`
- a TinyGo Wasm target that links the C++ lib via `link_deps` with `link_closure="transitive"`
- a minimal Node/Vite webapp stub (it expects a `top.wasm` at runtime)

### New attributes

I propose to add the following attributes where they are meaningful:

- For `nix_go_tiny_wasm_lib`:
  - `link_deps` (Wasm link deps, typically C++ Wasm static libs)
  - `link_closure` (direct/transitive)
  - `link_closure_overrides` (optional extension, same as `cpp-linking.md`)

### Build path: graph-aware selected vs selected-wasm

For TinyGo Wasm, there are two build paths in this repo:

- **Graph-aware selected (default for Buck builds)**:
  - Buck builds of `nix_go_tiny_wasm_lib` route through the graph-aware selected path (`tools/dev/build-selected.ts`, which builds `#graph-generator-selected`).
  - This path can consume exported graph semantics and is required for Phase 2 linking behavior (`link_deps` / closure).

- **Minimal selected-wasm (explicit opt-in)**:
  - The flake attribute `#graph-generator-selected-wasm` intentionally bypasses the exported graph and cannot incorporate repo Wasm link inputs (for example, `wasmStaticLibs` is empty).
  - This path is intended only for small smoke scaffolds that do not link in-repo C/C++.
  - If a call site must use this minimal path via Buck, it must opt in explicitly (for example, `use_selected_wasm = True` on `nix_go_tiny_wasm_lib`).

- For `nix_cpp_wasm_static_lib`:
  - `header_deps` (for includes while compiling)
  - `link_deps` (its own link requirements, used when a downstream consumer chooses transitive closure)

For Python WASI app/lib targets:

- These are Wasm _application packaging_ surfaces, not native “link steps” in the C/C++ sense.
- I do not propose `link_deps` for Python WASI in this document. Python uses `deps` to assemble its Python closure and the planner emits a Wasm runner/bundle.

For `node_webapp`:

- This is an application bundling/build target. It may consume Wasm artifacts by copying them into the webapp output, but it does not link them.
- I do not propose `link_deps` for `node_webapp` in this document. Wasm consumption should be expressed as explicit artifact deps (for example, `nix_node_gen` copy steps) rather than “link closure”.

For `nix_cpp_wasm_emscripten_lib`:

- It is a planner-visible stub for a JS+Wasm bundle. Linking semantics should be expressed in terms of its `deps` and stamped variant, but it is not a general “library” in the same sense. I treat it as a producer, not a reusable “linkable lib” dependency, unless we define a separate, explicit contract.

## Planner changes (Nix)

Wasm semantics should be implemented in the relevant language planners:

- Go planner (`tools/nix/planner/go.nix`) for TinyGo Wasm consumers
- C++ planner (`tools/nix/planner/cpp.nix`) for C++ Wasm producers

### Go TinyGo Wasm consumer algorithm

For a Go TinyGo Wasm target `T`:

1. Read `link_deps` (possibly empty) and closure settings.
2. Resolve each `link_dep` to a node and ensure it is a compatible Wasm producer:
   - expected labels: `lang:cpp`, `kind:wasm`, `wasm:static`
   - variant compatibility is enforced via the optional `wasm:wasi` label:
     - if TinyGo is built as `target="wasi"`, each linked dep must be stamped `wasm:wasi`
     - if TinyGo is built as `target="wasm"`, linked deps must not be stamped `wasm:wasi`
3. Apply closure:
   - direct: include only direct `link_deps`
   - transitive: walk the link graph via each dep’s `link_deps`
4. Instantiate Nix derivations for each resolved dep:
   - `T.cppWasmStaticLib { name = dep; subdir = pkgPathOf dep; wasmTarget = ... }`
   - `wasmTarget` is selected consistently with TinyGo:
     - `target="wasi"` → `wasmTarget="wasm32-wasi"`
     - `target="wasm"` → `wasmTarget="wasm32-unknown-unknown"`
5. Pass the list into the TinyGo Wasm template as `wasmStaticLibs`.

This is structurally the same as the C++ native linking design, except the producer template is `cppWasmStaticLib` and the consumer template is TinyGo.

### C++ Wasm static lib producer algorithm

For `nix_cpp_wasm_static_lib`:

- It compiles to a `.a` built for a specific Wasm target.
- If it declares `header_deps`, those are include-only inputs used during compilation.
  - The C++ planner resolves each `header_dep` to a `T.cppHeaders` derivation and passes its include root (`${drv}/include`) into `T.cppWasmStaticLib` via `includes`.
- If it declares `link_deps`, those are its link requirements and are used only when a downstream consumer selects transitive closure.
  - `link_deps` is not consumed by the archive build itself. It exists so downstream consumers can compute closure deterministically.

## Ordering and determinism

I want the same ordering rules as `cpp-linking.md`:

- In direct-only mode, preserve the `link_deps` order.
- In transitive mode, walk `link_deps` deterministically and include each node once.

Wasm adds one additional constraint:

- Ordering and traversal are performed within a single variant. If a mismatch is detected, fail rather than trying to coerce.

In addition to the algorithm-level rules above, I also want a concrete, testable artifact-level signal so we can lock ordering down over time. For TinyGo Wasm builds, the Go template writes the resolved link order into `$out/build.log` as `wasmStaticLibLabels=...`. It also logs per-dep overrides for TinyGo Wasm builds as `linkClosureOverrides=...` so tests can lock the override behavior.

## Invalidation contract (Phase 2)

For Phase 2, I want patch edits on Wasm producers to rebuild consumers when there is an explicit `link_deps` edge.

In practice this means:

- If a `nix_go_tiny_wasm_lib` links a `nix_cpp_wasm_static_lib` via `link_deps`, and the C++ producer’s declared patch inputs change (package-local `patches/cpp/*.patch` included in the producer target’s `srcs`), the TinyGo Wasm consumer must rebuild.
- This is implemented by threading the producer’s patch inputs (derived from the exported graph node `srcs`) into the planned `cppWasmStaticLib` derivations, so Nix sees the patch edits as real inputs.

## Common failures (Phase 2)

When a build fails, I want the failure mode to be deterministic and actionable:

- **Unsupported `link_deps` entry**: if a TinyGo Wasm target links something that is not a C++ Wasm static lib, the planner fails fast and names the consumer, the offending dep, and the expected labels (`lang:cpp`, `kind:wasm`, `wasm:static`).
- **Variant mismatch**: if `WEB_WASM_BACKEND=wasi_single`, the planner requires linked deps to be stamped `wasm:wasi`. If a dep is missing that stamp (or has it when the consumer is bare wasm), the planner fails fast and explains the mismatch.

## Example call sites

These examples assume the same union rule:

- `deps := deps ∪ link_deps ∪ header_deps`

### 1) C++ Wasm static lib (producer)

```python
# libs/cpp-core/TARGETS
load("//cpp:defs.bzl", "nix_cpp_wasm_static_lib")

nix_cpp_wasm_static_lib(
    name = "cpp_core_wasm",
    srcs = glob(["src/**/*.cpp"]),
    headers = glob(["include/**/*.h"]),
    visibility = ["PUBLIC"],
)
```

### 2) C++ Wasm static lib depends on another C++ Wasm static lib

```python
# libs/cpp-support/TARGETS
load("//cpp:defs.bzl", "nix_cpp_wasm_static_lib")

nix_cpp_wasm_static_lib(
    name = "cpp_support_wasm",
    srcs = glob(["src/**/*.cpp"]),
    headers = glob(["include/**/*.h"]),
    visibility = ["PUBLIC"],
)
```

```python
# libs/cpp-core/TARGETS
load("//cpp:defs.bzl", "nix_cpp_wasm_static_lib")

nix_cpp_wasm_static_lib(
    name = "cpp_core_wasm",
    srcs = glob(["src/**/*.cpp"]),
    headers = glob(["include/**/*.h"]),
    link_deps = ["//libs/cpp-support:cpp_support_wasm"],
    visibility = ["PUBLIC"],
)
```

### 3) Go TinyGo Wasm module links a C++ Wasm static lib (direct)

```python
# libs/wasm-module/TARGETS
load("//go:defs.bzl", "nix_go_tiny_wasm_lib")

nix_go_tiny_wasm_lib(
    name = "wasm_module",
    srcs = glob(["pkg/**/*.go"]),
    link_deps = ["//libs/cpp-core:cpp_core_wasm"],
    link_closure = "direct",
    visibility = ["PUBLIC"],
)
```

### 4) Go TinyGo Wasm module links transitive C++ Wasm libs (transitive closure)

If `//libs/cpp-core:cpp_core_wasm` declares `link_deps = ["//libs/cpp-support:cpp_support_wasm"]`:

```python
# libs/wasm-module/TARGETS
load("//go:defs.bzl", "nix_go_tiny_wasm_lib")

nix_go_tiny_wasm_lib(
    name = "wasm_module",
    srcs = glob(["pkg/**/*.go"]),
    link_deps = ["//libs/cpp-core:cpp_core_wasm"],
    link_closure = "transitive",
    visibility = ["PUBLIC"],
)
```

### 5) Per-dependency closure override (optional extension)

```python
load("//go:defs.bzl", "nix_go_tiny_wasm_lib")

nix_go_tiny_wasm_lib(
    name = "wasm_module",
    srcs = glob(["pkg/**/*.go"]),
    link_closure = "direct",
    link_deps = [
        "//libs/cpp-core:cpp_core_wasm",
        "//libs/cpp-bundle:cpp_bundle_wasm",
    ],
    link_closure_overrides = {
        "//libs/cpp-bundle:cpp_bundle_wasm": "transitive",
    },
)
```

### 6) Header-only dep for C++ Wasm static lib

```python
# libs/headers/TARGETS
load("//cpp:defs.bzl", "nix_cpp_headers")

nix_cpp_headers(
    name = "api_headers",
    headers = glob(["include/**/*.h"]),
    visibility = ["PUBLIC"],
)
```

```python
# libs/cpp-core/TARGETS
load("//cpp:defs.bzl", "nix_cpp_wasm_static_lib")

nix_cpp_wasm_static_lib(
    name = "cpp_core_wasm",
    srcs = glob(["src/**/*.cpp"]),
    headers = glob(["include/**/*.h"]),
    header_deps = ["//libs/headers:api_headers"],
    visibility = ["PUBLIC"],
)
```

### 7) C++ Emscripten bundle stub (producer)

This is a planner-visible stub for a JS+Wasm output pair. It is not a general-purpose “linkable library” dependency.

```python
# libs/emscripten/TARGETS
load("//cpp:defs.bzl", "nix_cpp_wasm_emscripten_lib")

nix_cpp_wasm_emscripten_lib(
    name = "cpp_emscripten_bundle",
    srcs = glob(["src/**/*.cpp"]),
    headers = glob(["include/**/*.h"]),
    visibility = ["PUBLIC"],
)
```

### 8) Python WASI application target (app)

Python has a Wasm “app” macro today: `nix_python_wasm_app`. This is the closest thing to a first-class “Wasm application target” in the repo.

```python
# apps/pywasm/TARGETS
load("//python:defs.bzl", "nix_python_wasm_app")

nix_python_wasm_app(
    name = "pyapp",
    srcs = glob(["**/*.py"]),
    lockfile_label = "lockfile:apps/pywasm/uv.lock#apps/pywasm",
    visibility = ["PUBLIC"],
)
```

### 9) Python WASI library target (lib)

```python
# libs/pywasm-lib/TARGETS
load("//python:defs.bzl", "nix_python_wasm_lib")

nix_python_wasm_lib(
    name = "pylib",
    srcs = glob(["**/*.py"]),
    lockfile_label = "lockfile:libs/pywasm-lib/uv.lock#libs/pywasm-lib",
    visibility = ["PUBLIC"],
)
```

### 10) TS webapp “wasm app” scaffold target (app packaging)

The TS wasm-app scaffold in this repo uses `node_webapp`. This is an application target that produces a `dist` output.

```python
# apps/my-wasm-webapp/TARGETS
load("//node:defs.bzl", "node_webapp")

node_webapp(
    name = "webapp",
    lockfile_label = "lockfile:apps/my-wasm-webapp/pnpm-lock.yaml#apps/my-wasm-webapp",
    out = "dist",
)
```

⚠️ If the webapp needs to include a `.wasm` produced by another target (TinyGo or Emscripten), the recommended pattern is to add an explicit copy step (for example via `nix_node_gen` using `$(location ...)`) rather than trying to treat the webapp as a linker.

## Shared code opportunities (avoid reinvention)

If we implement either C++ native linking (`cpp-linking.md`) or Wasm linking first, I want shared helper code to be used by both.

I propose the shared code boundaries below. I also reference these in `cpp-linking.md` so either implementation can depend on the shared helpers.

### Shared semantics helper for deterministic traversal

Both designs need:

- deterministic union of deps lists at the macro level
- deterministic traversal over a “link graph” with:
  - `direct` vs `transitive`
  - optional per-dep overrides

Candidates:

- **Nix side**: a small helper module under `tools/nix/planner/` such as `link-closure.nix` that implements:
  - `resolveLinkClosure { byName, linkDepsOf, roots, defaultClosure, overrides } -> [ordered unique deps]`
- **Starlark side**: a helper in `//lang:defs_common.bzl` that:
  - merges `deps/link_deps/header_deps` deterministically
  - validates `link_closure_overrides` keys are in `link_deps`

### Shared attribute export surface

Both designs require the exporter to include the new attributes in the exported JSON node:

- `link_deps`, `header_deps`, `link_closure`, `link_closure_overrides`, and any Wasm variant stamps if they are represented as attrs rather than labels.

If we add these attributes for C++ first, we should reuse them for Wasm, rather than inventing Wasm-only names.

Python extension modules (`python-extension-design.md`) are another consumer of the same shared “link closure” primitives, so I want the same attribute names and the same Nix/Starlark helpers reused there as well.

## Implementation sequence

See `linking-roadmap.md` for a proposed order that implements shared primitives once and then applies them across native C++, Wasm, and Python extension modules.

## Notes to update in `cpp-linking.md`

I will keep `cpp-linking.md` and `wasm-linking.md` aligned on:

- the union rule (`deps := deps ∪ link_deps ∪ header_deps`)
- closure semantics and optional per-dep overrides
- the shared helper extraction points (macro helper and Nix planner helper)
