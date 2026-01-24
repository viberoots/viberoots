# C++ linking semantics in Buck2 + Nix planner

This document proposes a design to support explicit, deterministic C++ dependency semantics for:

- C++ binary linking in-repo C++ libraries
- C++ library depending on in-repo C++ libraries (compile-time and link-time intent)
- C++ Node-API addons linking in-repo C++ libraries
- Header-only dependencies (include-path only)
- Direct-only and transitive link closure policies
- Static and shared linking (with a clear default)

I wrote this to be consistent with our build design in `build-system-design.md` and our methodology in `METHODOLOGY.XML`. Buck remains the source of truth for the graph. Nix remains the builder. The planner stays small. Semantics are explicit at call sites.

## Problem statement

Today, a `nix_cpp_binary(..., deps=[...])` edge is useful for:

- invalidation (Buck graph edges and patch inputs)
- collecting transitive `nixpkg:*` labels so Nix can add include and link flags for nixpkgs-provided dependencies
- a special case: direct deps labeled `kind:carchive` (Go c-archives) are routed to Nix and linked into C++ binaries/addons

The C++ planner intentionally does not treat plain `deps` as link intent. A C++ binary does not automatically link an in-repo `nix_cpp_library` just because it is listed in `deps`.

Instead, call sites must opt in via explicit intent attributes (`link_deps`, `header_deps`). The planner then materializes in-repo C++ targets as Nix package inputs (`T.cppLib`, `T.cppHeaders`) for consumers.

This gap makes C++ feel inconsistent with:

- Go cgo depending on in-repo C++ libraries (supported)
- C++ depending on Go c-archives (supported)

## Cross-language linking (related, but not the main focus)

This document is primarily about **C++ target dependency semantics** (C++ lib/bin/addon/test).
In this repo we also have **cross-language linking** that touches C++ artifacts. I want this called out explicitly so the model is complete.

### Go app or library linking an in-repo C++ library (cgo)

This is supported today via Go macros using `repo_cgo_deps` (see `docs/handbook/language-interop.md` and `go/defs.bzl`).

This is a “Go consumer, C++ producer” case. It is not driven by `nix_cpp_binary` at all, but it does depend on C++ library artifact shape and headers.

Example call site:

```python
# libs/greeter/TARGETS
load("//cpp:defs.bzl", "nix_cpp_library")

nix_cpp_library(
    name = "greeter",
    srcs = ["src/greeter.cpp"],
    headers = ["include/greeter.h"],
    visibility = ["PUBLIC"],
)
```

```python
# apps/demo-cli/TARGETS
load("//go:defs.bzl", "nix_go_binary")

nix_go_binary(
    name = "demo",
    srcs = ["cmd/demo/main.go"],
    repo_cgo_deps = ["//libs/greeter:greeter"],
)
```

Design interaction with this document:

Go cgo consumers can now opt into following a C++ library’s `link_deps` transitively by setting `link_closure` (see `go-linking.md`). This uses the same shared link-closure resolver as C++ targets, so traversal order and failure modes are consistent across languages.

### C++ consumer linking a Go c-archive

This is supported today and is already in-scope of the planner-side discussion here:

- Go producer: `nix_go_carchive`
- C++ consumer: `nix_cpp_binary` / `nix_cpp_node_addon` depending on the c-archive target

### Python native extension modules (CPython C extensions)

⚠️ I do not see an existing first-class macro surface in this repo for building and consuming in-repo Python C-extension modules (for example, a `.so`/`.dylib` built from C/C++ and imported from Python).

If we want this, it should be designed explicitly because it crosses three concerns:

- build of the native extension artifact (C/C++ build, likely via Nix templates)
- Python packaging/runtime discovery (where the `.so` lives and how it is imported)
- lockfile/importer scoping (uv-based Python targets and their dependency closure)

This document does not attempt to design Python extension modules. If we decide to support it, I would write a dedicated design doc that mirrors the same semantic model:

- explicit intent lists (what gets built, what gets included at runtime)
- deterministic closure resolution
- explicit ABI/variant constraints (CPython version, platform tags, and possibly manylinux/macos wheel semantics)

## Goals

The design must:

- Make the meaning of “dependency” explicit for C++ call sites.
- Support both direct and transitive link closure policies.
- Support header-only deps as first-class, without fake-linking.
- Support C++ libraries, binaries, C++ Node-API addons, and C++ tests consistently.
- Preserve deterministic builds (stable ordering, explicit inputs).
- Preserve Buck’s impact analysis (deps remain real graph edges; patch inputs remain explicit).
- Keep the planner small and keep logic in the language adapter (`tools/nix/planner/cpp.nix`) rather than scattering it.

## Non-goals

- Replacing Buck’s native C++ toolchain with the Buck C++ toolchain for actual linking. This design continues to build C++ artifacts via Nix templates.
- Automatically inferring complex link semantics from source scanning. If a behavior changes link closure size, it must be an explicit knob.
- Requiring generated provider glue for C++ (we rely on `nixpkg:*` labels and planner consumption, consistent with our current direction).

## Glossary (terms used in this doc)

- **Graph deps**: Buck `deps` edges used for invalidation and impact analysis.
- **Link deps**: deps that must produce linkable artifacts (e.g., `.a`, `.so`, `.dylib`) and be linked into a consumer.
- **Header deps**: deps that provide headers/include paths, but do not produce linkable artifacts.
- **Closure policy**: whether to link direct deps only or to include transitive deps automatically.
- **Nix package input**: a Nix derivation that provides `$out/include` and optionally `$out/lib`.

## Proposed model (high level)

I separate “graph dependency” from “link intent”.

1. Call sites keep using Buck `deps` to express the dependency graph.
2. Call sites optionally specify which of those deps are link deps vs header deps.
3. The C++ planner reads the graph and:
   - resolves header deps to Nix package inputs that provide include paths only, even when the dep is a C++ library
   - resolves link deps to Nix package inputs that provide libraries and include paths
   - applies an explicit closure policy (direct or transitive) when constructing link inputs
4. The existing C++ Nix templates continue to:
   - compile the consumer’s own sources
   - include headers from all provided Nix package inputs
   - link libraries from the provided Nix package inputs

This keeps the planner as the only place where “how do I translate Buck deps into Nix inputs” lives.

## User-facing API (Starlark macros)

### Default behavior

I want a minimal, backwards-compatible default:

- `deps` stays as-is and remains the authoritative graph edge list.
- Linking behavior remains unchanged unless the user opts in.

That means:

- Existing C++ targets keep building as they do now.
- Opt-in is required to start linking in-repo C++ libraries into C++ binaries/addons/tests.

### New attributes

I propose adding three small, orthogonal knobs to:

- `nix_cpp_library` (as a consumer and as a producer)
- `nix_cpp_binary`
- `nix_cpp_node_addon`
- `nix_cpp_test`

- `link_deps`: list of target labels that should be linked as libraries.
- `header_deps`: list of target labels that should be treated as header-only include deps.
- `link_closure`: `"direct"` (default) or `"transitive"`.

Notes:

- Status:
  - PR-2 in `linking-plan-2.md` implements the macro-level surface: these attributes are accepted on C++ macros and the deterministic `deps` union contract is enforced.
  - PR-3 implements planner behavior for Phase 1 consumers (direct-only):
    - `link_deps` materializes `T.cppLib` inputs for C++ bins, Node addons, and tests
    - `header_deps` materializes `T.cppHeaders` inputs for the same consumers
  - PR-6 (this doc’s Phase 2) extends the C++ planner to consume:
    - `link_closure="direct" | "transitive"` via `tools/nix/planner/link-closure.nix`
    - `link_closure_overrides` with deterministic normalization (reject duplicate keys after normalization)

- `deps` remains the graph edge list, but for ergonomics the macro will compute:
  - `deps := deps ∪ link_deps ∪ header_deps` (deterministic union)
  - This ensures any link or header dependency is also a real Buck graph edge, without requiring users to repeat labels.
- Overlap between `link_deps` and `header_deps` is allowed. The union is deterministic, and the planner tolerates the overlap without requiring separate validation.
- Link inputs come only from `link_deps`. Even if a dep appears in both lists, the `header_deps` path remains header-only.
- If `link_deps` and `header_deps` are both empty, C++ behaves exactly as today.
- `link_closure = "transitive"` applies only to `link_deps` (and optionally to `header_deps` if we decide it is useful; default is direct-only for header deps too).

### What it means for a library target

For a library target `L`:

- `header_deps` are compile-time include deps for building `L` itself.
- `link_deps` are `L`’s link requirements. If a consumer wants “automatic” closure, it uses `link_closure="transitive"` and the planner follows `link_deps` edges recursively.

This avoids guessing. Libraries declare their own link requirements. Consumers decide whether to pull the full link closure automatically.

When `link_mode="shared"`, the library itself links its own `link_deps`. The planner applies the library’s `link_closure` when resolving those link inputs, so shared libs can be self-contained without requiring consumers to restate the same link requirements.

Planner note: `header_deps` are applied to library compilation by passing `T.cppHeaders` inputs into `cppLib` and `cppSharedLib`.

### Static vs shared

I propose a separate, opt-in knob:

- `link_mode`: `"static"` (default) or `"shared"`.

Rationale:

- Static is the simplest and matches our current in-repo C++ template shape (`cppLib` produces `.a`).
- Shared requires additional runtime-path semantics and testing, and I do not want to silently switch behavior.

Notes:

- For library targets, `link_mode` controls the artifact (`cppLib` vs `cppSharedLib`).
- For consumers (bin/test/addon), `link_mode="shared"` requires `link_deps` to resolve to shared-capable producers and fails fast otherwise.

### Example call sites

These examples assume the deterministic union rule above:

- The macro computes `deps := deps ∪ link_deps ∪ header_deps`.
- `link_closure` only affects how a consumer materializes link inputs.
- Libraries declare their own `link_deps`.

#### 1) C++ binary links an in-repo C++ static library (direct)

```python
# libs/math/TARGETS
load("//cpp:defs.bzl", "nix_cpp_library")

nix_cpp_library(
    name = "math_core",
    srcs = glob(["src/**/*.cpp"]),
    headers = glob(["include/**/*.h"]),
    visibility = ["PUBLIC"],
)
```

```python
# apps/calc/TARGETS
load("//cpp:defs.bzl", "nix_cpp_binary")

nix_cpp_binary(
    name = "calc",
    srcs = ["src/main.cpp"],
    link_deps = ["//libs/math:math_core"],
    link_closure = "direct",
)
```

#### 2) C++ library depends on another in-repo C++ library (compile + link intent)

```python
# libs/support/TARGETS
load("//cpp:defs.bzl", "nix_cpp_library")

nix_cpp_library(
    name = "support",
    srcs = glob(["src/**/*.cpp"]),
    headers = glob(["include/**/*.h"]),
    visibility = ["PUBLIC"],
)
```

```python
# libs/math/TARGETS
load("//cpp:defs.bzl", "nix_cpp_library")

nix_cpp_library(
    name = "math_core",
    srcs = glob(["src/**/*.cpp"]),
    headers = glob(["include/**/*.h"]),
    link_deps = ["//libs/support:support"],
    visibility = ["PUBLIC"],
)
```

#### 3) C++ binary links transitive library requirements (transitive closure)

`math_core` declares `link_deps = ["//libs/support:support"]`. The binary only mentions `math_core`.

```python
# apps/calc/TARGETS
load("//cpp:defs.bzl", "nix_cpp_binary")

nix_cpp_binary(
    name = "calc",
    srcs = ["src/main.cpp"],
    link_deps = ["//libs/math:math_core"],
    link_closure = "transitive",
)
```

#### 4) Header-only dependency (include paths only)

```python
# libs/api-headers/TARGETS
load("//cpp:defs.bzl", "nix_cpp_headers")

nix_cpp_headers(
    name = "api_headers",
    headers = glob(["include/**/*.h"]),
    visibility = ["PUBLIC"],
)
```

```python
# apps/uses-headers/TARGETS
load("//cpp:defs.bzl", "nix_cpp_binary")

nix_cpp_binary(
    name = "uses_headers",
    srcs = ["src/main.cpp"],
    header_deps = ["//libs/api-headers:api_headers"],
)
```

#### 5) Link-only dependency (no headers consumed)

Example shape: declare function prototypes yourself (C ABI) or only use opaque handles.

```python
# apps/link-only/TARGETS
load("//cpp:defs.bzl", "nix_cpp_binary")

nix_cpp_binary(
    name = "link_only",
    srcs = ["src/main.cpp"],
    link_deps = ["//libs/math:math_core"],
)
```

#### 6) C++ Node-API addon links an in-repo C++ library

```python
# libs/addon-native/TARGETS
load("//cpp:defs.bzl", "nix_cpp_node_addon")

nix_cpp_node_addon(
    name = "napi_addon",
    srcs = [
        "src/addon.cc",
        "src/binding.cc",
    ],
    headers = glob(["include/**/*.h"]),
    link_deps = ["//libs/math:math_core"],
    addon_name = "calc_native",
    visibility = ["PUBLIC"],
)
```

#### 7) C++ test links an in-repo C++ library

```python
# libs/math/TARGETS
load("//cpp:defs.bzl", "nix_cpp_test")

nix_cpp_test(
    name = "math_gtest",
    srcs = ["tests/math_gtest.cpp"],
    link_deps = ["//libs/math:math_core"],
    deps = [
        # Example of nixpkgs dep via provider target
        "//third_party/providers:nix_pkgs_googletest",
    ],
)
```

#### 8) C++ shared library (opt-in) and a binary consuming it

⚠️ This example assumes we add a dedicated macro for shared libs (or an explicit producer-side knob)
and that runtime loading is handled (rpath or packaging) as described later in this document.

```python
# libs/runtime/TARGETS
load("//cpp:defs.bzl", "nix_cpp_shared_library")

nix_cpp_shared_library(
    name = "runtime",
    srcs = glob(["src/**/*.cpp"]),
    headers = glob(["include/**/*.h"]),
    visibility = ["PUBLIC"],
)
```

```python
# apps/uses-shared/TARGETS
load("//cpp:defs.bzl", "nix_cpp_binary")

nix_cpp_binary(
    name = "uses_shared",
    srcs = ["src/main.cpp"],
    link_deps = ["//libs/runtime:runtime"],
    link_closure = "transitive",
)
```

#### 9) C++ Node-API addon links a shared C++ library

The addon template emits rpath entries for each linked Nix package so the runtime loader
can resolve shared libs without `DYLD_LIBRARY_PATH`/`LD_LIBRARY_PATH`.

```python
# libs/runtime/TARGETS
load("//cpp:defs.bzl", "nix_cpp_library")

nix_cpp_library(
    name = "runtime",
    srcs = glob(["src/**/*.cpp"]),
    headers = glob(["include/**/*.h"]),
    link_mode = "shared",
    visibility = ["PUBLIC"],
)
```

```python
# libs/addon-native/TARGETS
load("//cpp:defs.bzl", "nix_cpp_node_addon")

nix_cpp_node_addon(
    name = "napi_addon",
    srcs = glob(["src/**/*.cc"]),
    link_deps = ["//libs/runtime:runtime"],
    addon_name = "runtime_addon",
    visibility = ["PUBLIC"],
)
```

## Planner changes (Nix)

All translation from Buck graph deps to Nix link inputs lives in `tools/nix/planner/cpp.nix`.

### Required graph data

The exporter already emits:

- `deps` edges
- `labels` (including `nixpkg:*`, `lang:cpp`, `kind:*`)
- `srcs`
- `includes`, `defines`, `cflags`, `ldflags` (as needed by templates)

To implement explicit C++ linking, the planner must also be able to read:

- `link_deps`
- `header_deps`
- `link_closure`
- `link_mode`

The exporter includes these intent attributes in the configured graph output:

- `tools/buck/exporter/cquery/attrs.ts` (Node exporter)
- `tools/buck/export-inline.ts` (inline fallback)

### Core algorithm

For a C++ consumer target `T` of kind `lib`, `bin`, `addon`, or `test`:

1. Read its `deps` list (graph deps).
2. Read `link_deps` and `header_deps` (possibly empty).
3. Validate:
   - invalid values fail evaluation with an actionable error.
4. Resolve each dep label to a node in the graph and classify:
   - in-repo C++ library target
   - in-repo header-only target
   - Go c-archive target
   - nixpkgs dependency (via `nixpkg:*` labels) remains separate
5. Apply closure policy:
   - direct: keep only direct `link_deps`
   - transitive: walk the _link graph_ by following `link_deps` recursively, starting from each direct `link_dep`
6. Build Nix package inputs:
   - for each C++ lib: `T.cppLib { name = dep; subdir = pkgPathOf dep; ... }`
   - for each header dep: `T.cppHeaders { ... }` (header-only, even if the dep is a C++ library)
   - for each Go c-archive dep: existing `T.goCArchive { ... }` path remains
7. Pass the resulting Nix package input list to the C++ template as `nixCxxPkgs`.
8. Continue to pass `nixCxxAttrs` (from `nixpkg:*`) as today.

This design is intentionally parallel to what `tools/nix/planner/go.nix` already does for Go cgo, but scoped to C++.

Note: PR-1 in `linking-plan-2.md` implements the header-only _producer_ (`nix_cpp_headers` + `kind:headers` + `T.cppHeaders`) first. The consumer wiring for `header_deps` is now implemented and exercised by tests.

### Classification rules

I propose a conservative classification:

- A dep is an in-repo C++ lib iff:
  - it has `lang:cpp` and `kind:lib`, or its rule kind resolves to `"lib"` via existing `kindOf`.
- A dep is a Go c-archive iff:
  - it has label `kind:carchive` (existing pattern).
- A dep is a header-only target iff:
  - it has `lang:cpp` and `kind:headers` (new stamp) or a dedicated rule type.

This avoids guessing based on filenames.

### Ordering rules (determinism and correctness)

I need stable ordering for reproducibility and for link behavior.

I propose:

- For direct-only:
  - preserve the order in `link_deps` as the primary order.
- For transitive:
  - perform a deterministic traversal over `link_deps` edges:
    - include a node only once
    - walk `link_deps` in the order listed in each node’s `link_deps` attribute
    - break ties deterministically (e.g., lexicographic) only when necessary

This yields:

- deterministic evaluation and stable link input ordering
- a simple “if link breaks, you can either reorder link_deps or switch to direct mode and list what you need”

Phase 1 hardening notes:

- The planner deduplicates `link_deps` (and `header_deps`) while preserving the first-occurrence order from the call site.
- The C++ templates sort the discovered `lib*.a` files inside each package before producing `-l...` flags.

This prevents a common source of nondeterminism where link inputs are stable at the planner level but `find` returns `lib*.a` in filesystem order.

### Patch invalidation contract (Phase 1)

In Phase 1, patch invalidation is intentionally explicit and monotonic:

- Patch files live under the producer package (for example, `libs/foo/patches/cpp/*.patch`).
- Patch files must be included in the producer target’s `srcs` so Buck invalidation is precise and predictable.
- If a C++ library is used via `link_deps`, changing one of its patch files must rebuild:
  - the library derivation, and
  - any consumer derivation that links it via `link_deps`.

### Failure modes (Phase 1)

Phase 1 does not attempt to infer “what you meant” when `link_deps` is misused.

- `link_deps` entries must resolve to in-repo C++ library producers (`lang:cpp` + `kind:lib`).
- If an entry does not resolve to a supported producer shape, the planner fails fast with an error that names:
  - the consumer label,
  - the offending dep label, and
  - the expected shape (C++ lib for Phase 1).

### Per-dependency link closure overrides

Sometimes a target wants “mostly direct” linking but needs one dependency to pull in its full transitive link requirements. That can happen with registration-style libraries or a “bundle” library that intentionally aggregates functionality.

The planner supports an explicit override map:

- `link_closure`: `"direct"` or `"transitive"` (global default)
- `link_closure_overrides`: dict mapping dep label to `"direct"` or `"transitive"`

Constraints:

- Overrides apply only to entries in `link_deps`.
- Every key in `link_closure_overrides` must also be present in `link_deps`.
- Override keys are normalized before use; duplicate keys after normalization are rejected.
- Traversal must remain deterministic:
  - Start from `link_deps` in order.
  - For each dep `d`, determine `closure(d)` from `link_closure_overrides.get(d, link_closure)`.
  - If `closure(d) == "direct"`, include `d` only.
  - If `closure(d) == "transitive"`, include `d` and recursively include its `link_deps`.
- C++ macros (`nix_cpp_binary`, `nix_cpp_library`, `nix_cpp_node_addon`, `nix_cpp_test`) validate overrides at the call site and forward them to the planner.

Example call site:

```python
load("//cpp:defs.bzl", "nix_cpp_binary")

nix_cpp_binary(
    name = "app",
    srcs = ["src/main.cpp"],
    # Default: direct-only.
    link_closure = "direct",
    link_deps = [
        "//libs/normal:normal",
        "//libs/bundle:bundle",
    ],
    # Only this dep pulls its transitive link requirements.
    link_closure_overrides = {
        "//libs/bundle:bundle": "transitive",
    },
)
```

## Nix templates (C++)

### Reuse existing templates for linkable libs

We already have `cppLib` which builds a static library and installs headers.

That is sufficient as the standard in-repo “linkable lib” artifact.

### Add a header-only template

We need a Nix template that produces:

- `$out/include/**` (copied from the target’s `headers` / header sources)
- no `$out/lib` requirement

Call it:

- `tools/nix/templates/cpp-headers.nix` exporting `cppHeaders`
- wired through `tools/nix/templates/cpp.nix` so `T.cppHeaders` exists

This supports header-only deps without any link artifacts.

### Shared libraries

Shared libs require two things:

1. A template that produces `.so`/`.dylib` with a stable layout.
2. A runtime strategy for consumers (binaries and Node addons):
   - rpath settings (preferred), or
   - wrapper scripts, or
   - copying shared libs next to the binary/addon

I propose to implement shared libs as a separate, explicit step:

- `cppSharedLib` template producing `$out/lib/lib<name>.so|dylib` and `$out/include`
- `link_mode="shared"` causes the planner to instantiate `cppSharedLib` for link deps

For runtime:

- for binaries: set rpath to include each dep’s `$out/lib` via linker flags in the template
- for Node addons: similarly set rpath, or copy libs into a well-defined `native/` directory at packaging time

Node addon shared-library runtime is handled via rpath in the addon template. This matches the binary path strategy and avoids relying on `DYLD_LIBRARY_PATH`/`LD_LIBRARY_PATH`.

## Buck macro changes (C++)

The macro layer should remain small and deterministic, consistent with our conventions:

- single merge point for `deps`
- delegate wiring (patch inputs, labels, etc.) to shared helpers

Implementation details (proposed):

- Extend `cpp/defs.bzl` public macros:
  - `nix_cpp_library`, `nix_cpp_binary`, `nix_cpp_node_addon`, `nix_cpp_test`
  - accept and forward the new attrs:
    - `link_deps`, `header_deps`, `link_closure`, `link_mode`
- Implement deterministic deps merging:
  - `base_deps := (caller deps) ∪ link_deps ∪ header_deps ∪ extra_module_providers`
  - pass `base_deps` through the existing wiring helper so patch inputs and other policy remain centralized
- Ensure the wiring helper preserves these attrs in the exported graph node.
  - If our exporter only exports a fixed attribute set, these fields must be included in that set.

### A header-only macro surface

To make header-only targets explicit and easy to use, I propose adding:

- `nix_cpp_headers(name=..., srcs=[...], ...)`

This macro would:

- stamp `lang:cpp` and `kind:headers`
- be planner-visible so the C++ planner can produce `T.cppHeaders` for it

## Migration plan (phased, with checkpoints)

This matches the methodology requirement to structure work by dependency chains and measurable checkpoints.

### Phase 0: Define contracts and guardrails

Scope:

- land the doc (this file)
- define target labels/stamps for `kind:headers`
- define exporter fields required for the planner (`link_deps`, `header_deps`, `link_closure`, `link_mode`)

Acceptance:

- documentation reviewed and agreed on by owners
- a minimal validation test exists that proves the exporter includes the new fields (no build required)

### Phase 1: Direct-only static linking for C++ bin/addon/test

Scope:

- implement `link_deps` and `header_deps`
- implement `link_closure="direct"` (default)
- implement `nix_cpp_headers` + `cppHeaders` template
- extend the C++ planner to build `cppLib` and `cppHeaders` inputs and pass them as `nixCxxPkgs`

Acceptance:

- a C++ binary links an in-repo C++ library via `link_deps`
- a Node addon links an in-repo C++ library via `link_deps`
- a consumer can include headers from a header-only target via `header_deps`
- impacted tests remain accurate when patch inputs change (no hidden deps)

### Phase 2: Transitive link closure

Scope:

- implement `link_closure="transitive"`
- define and document ordering rules

Acceptance:

- a C++ binary can list only top-level `link_deps` and still link required transitive libs
- ordering remains deterministic across builds

### Phase 3: Shared libraries (opt-in)

Scope:

- implement `cppSharedLib` template
- implement `link_mode="shared"`
- implement runtime strategy (rpath or packaging)

Acceptance:

- a consumer binary runs without manual environment variables (no ad-hoc `DYLD_LIBRARY_PATH` or `LD_LIBRARY_PATH`)
- a Node addon loads successfully in a minimal runtime environment

## Test strategy

This repo expects real tests for behavior changes.

I propose adding zx-based integration tests under `tools/tests/cpp/` that:

- scaffold a small temp repo with:
  - `libs/a` as a C++ lib
  - `apps/b` as a C++ bin depending on it
- build and run the binary to prove the link succeeds

For transitive linking:

- create `libs/a` depending on `libs/b`
- ensure `apps/c` only lists `link_deps=["//libs/a:a"]` and still links and runs with `link_closure="transitive"`
- add addon and test cases that follow the same nested `link_deps` chain

For header-only:

- create a `nix_cpp_headers` target exporting a header with an inline function or constant
- compile a binary that includes it

For shared:

- add a single test per platform family behavior and keep it minimal

## Completion criteria

This project is “finished” when:

- All patterns described in this doc are supported and tested:
  - C++ bin → in-repo C++ lib (direct and transitive)
  - C++ addon → in-repo C++ lib (direct and transitive)
  - C++ test → in-repo C++ lib (direct and transitive)
  - header-only deps
  - static and shared link kinds (shared is opt-in)
- The planner remains the single place where Buck deps are translated into Nix link inputs for C++.
- The semantics are explicit at call sites and do not rely on inference.

## Open questions and uncertainties

⚠️ Exporter attribute surface:

- If the exporter only emits a fixed set of attributes, we must extend it to export `link_deps`, `header_deps`, `link_closure`, and `link_mode`.

⚠️ Deterministic `-l` ordering in templates:

- If `find` order is not stable, we should sort the discovered libraries in `cpp-app.nix` and `cpp-node-addon.nix`.

⚠️ Shared library runtime semantics:

- I need a decided contract for where dependent shared libs live at runtime for binaries and for Node addons.
  - If we choose rpath, we must verify cross-platform behavior (Darwin vs Linux).
  - If we choose packaging, we must define a canonical directory layout and copy strategy.

## Shared code opportunities (avoid reinvention with Wasm linking)

This document and `wasm-linking.md` share the same core semantic model:

- explicit `link_deps` and `header_deps` intent lists
- `deps := deps ∪ link_deps ∪ header_deps` as a deterministic union at the macro layer
- `link_closure` with an optional per-dep override map
- deterministic traversal over a “link graph” (follow `link_deps` recursively)

If I implement either C++ native linking or Wasm linking first, I want to avoid duplicating these mechanics.

This same shared model is also intended to be reused by `python-extension-design.md` (Python extension modules), which is another “native link consumer” that benefits from the same deterministic closure resolution.

### Shared semantics helper for deterministic traversal

Both designs need a tiny, deterministic “link closure” resolver:

- inputs: `roots`, `link_deps` per node, default closure, optional overrides
- output: ordered unique list of deps to materialize as Nix package inputs

Candidate placements:

- **Nix side**: `tools/nix/planner/link-closure.nix` that both `tools/nix/planner/cpp.nix` and `tools/nix/planner/go.nix` can import.
- **Starlark side**: `//lang:defs_common.bzl` helper that:
  - merges `deps/link_deps/header_deps` deterministically
  - validates `link_closure_overrides` keys are present in `link_deps`

### Shared attribute export surface

Both designs rely on the exported Buck graph containing the intent attributes:

- `link_deps`, `header_deps`, `link_closure`, `link_closure_overrides`

If the exporter needs to be extended to emit these fields, I should do it once and reuse it for both native C++ and Wasm.

Python extension modules (`python-extension-design.md`) should reuse the same attribute names for the same semantics, rather than inventing a parallel surface.

## Implementation sequence

See `linking-roadmap.md` for a proposed order that implements shared primitives once and then applies them across native C++, Wasm, and Python extension modules.
