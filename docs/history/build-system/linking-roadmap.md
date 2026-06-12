# Linking roadmap (native C++, Wasm, Python extensions)

This document proposes an implementation sequence for:

- C++ native linking semantics (`build-tools/docs/cpp-linking.md`)
- Wasm linking semantics (`build-tools/docs/wasm-linking.md`)
- Python extension module support (`docs/history/designs/legacy/python-extension-design.md`)

The goal is to implement shared primitives once, then apply them across target types without reinventing the wheel.

## Design constraints that drive sequencing

1. Buck remains the source of truth for the graph.
2. Nix templates do the actual compilation/linking.
3. The planner is responsible for translating Buck graph semantics into Nix inputs deterministically.
4. Call sites must stay explicit. Defaults should be conservative and opt-in for behavior changes.

## Shared primitives (implement once)

These are shared across all three efforts:

- **Macro-level deterministic union**:
  - `deps := deps ∪ link_deps ∪ header_deps`
  - optional validation of `link_closure_overrides`
- **Planner-level deterministic link closure resolution**:
  - `link_closure = "direct" | "transitive"`
  - optional `link_closure_overrides` (per-dep)
  - deterministic traversal over the link graph (follow `link_deps`)
  - canonical implementation: `build-tools/tools/nix/planner/link-closure.nix` (`resolveLinkClosure`)
- **Exporter attribute surface**:
  - ensure `link_deps`, `header_deps`, `link_closure`, and `link_closure_overrides` are exported where needed

Recommended shared implementation points:

- **Starlark**: `//build-tools/lang:defs_common.bzl` (or `//build-tools/lang:importer_wiring.bzl` where importer-scoped) for deterministic union and validation.
- **Nix**: `build-tools/tools/nix/planner/link-closure.nix` for deterministic closure resolution.

## Proposed sequence (phased)

### Phase 0: Shared primitives and graph export

Scope:

- Implement the shared Starlark helper(s) for:
  - deterministic union of deps/link_deps/header_deps
  - optional validation of `link_closure_overrides`
- Implement `build-tools/tools/nix/planner/link-closure.nix` used by:
  - C++ planner (`build-tools/tools/nix/planner/cpp.nix`)
  - Go planner (`build-tools/tools/nix/planner/go.nix`) for Wasm linking
  - Python planner (`build-tools/tools/nix/planner/python.nix`) for extension modules (when added)
- Ensure exporter JSON includes the intent attributes for targets that use them.

Acceptance:

- A minimal probe/cquery-based test can show the attributes and labels are present in the exported graph for a representative target.

### Phase 1: C++ native linking (core)

Scope (from `build-tools/docs/cpp-linking.md`):

- Implement `link_deps`/`header_deps` for C++ targets (`nix_cpp_library`, `nix_cpp_binary`, `nix_cpp_node_addon`, `nix_cpp_test`) with deterministic union into `deps`.
- Extend the C++ planner so C++ consumers can link in-repo C++ libs by materializing `T.cppLib` inputs.
- Add `nix_cpp_headers` + `T.cppHeaders` for header-only deps.

Why first:

- C++ native linking establishes the “in-repo native library” producer shape (`T.cppLib`) and the planner pattern of translating link deps to Nix package inputs.
- This becomes a building block for Python extensions and (optionally) for Go cgo closure improvements.

Acceptance:

- A C++ binary links an in-repo C++ library via `link_deps`.
- A C++ library can declare `link_deps` and consumers can opt into `link_closure="transitive"`.

### Phase 2: Wasm linking semantics (TinyGo + C++ Wasm static libs)

Scope (from `build-tools/docs/wasm-linking.md`):

- Extend `nix_go_tiny_wasm_lib` to accept `link_deps`/closure semantics and enforce variant compatibility.
- Treat `nix_cpp_wasm_static_lib` as the Wasm-producer analogue of `nix_cpp_library`.

Why second:

- This reuses the shared link-closure resolver, but the producer templates are different (`T.cppWasmStaticLib` vs `T.cppLib`).
- It benefits from the same “explicit intent lists” semantics proven in Phase 1, but adds variant enforcement.

Acceptance:

- A TinyGo Wasm module links a C++ Wasm static lib via `link_deps`.
- Transitive closure follows `link_deps` on Wasm libs and fails deterministically on variant mismatch.

### Phase 3: Python extension modules (in-repo)

Scope (from `build-tools/docs/python-extension-design.md`):

- Add `nix_python_extension_module` macro (importer-scoped).
- Add `kind:pyext` and `T.pyExt` template that builds an extension and emits `$out/site/<module path>${EXT_SUFFIX}`.
- Extend Python planner/templates to overlay extension module outputs into `pyApp`/`pyLib` outputs.
- Optional: reuse C++ linking implementation to allow `link_deps` to in-repo C++ libs for extensions.

Why third:

- Python extensions are a consumer of in-repo native libraries and benefit from:
  - the shared closure resolver
  - a known-good C++ library producer shape (`T.cppLib`)
- Python also has its own runtime composition problem (merging `$out/site` trees) that is independent and can be implemented once the extension artifact shape exists.

Acceptance:

- A Python app built via the planner imports an in-repo extension module successfully.
- An extension module can link an in-repo C++ library via `link_deps` (if included in this phase).

### Phase 4: Optional improvements and parity

Possible follow-ups:

- Apply the shared closure resolver to Go cgo consumers (optional), so Go can optionally follow C++ library `link_deps` when linking.
- Add shared-lib support for C++ native linking (opt-in) if needed. **Implemented (PR-2, link_mode="shared").**

## Notes for doc readers

- `build-tools/docs/cpp-linking.md`, `build-tools/docs/wasm-linking.md`, and `docs/history/designs/legacy/python-extension-design.md` should be read as:
  - a conceptual model
  - a concrete target surface
  - a phased rollout
- This roadmap defines the recommended order so shared utilities are implemented once and reused.
