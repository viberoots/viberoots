## Node → C++ Scaffolding Template — Detailed Design

This document proposes a scaffolding template that enables calling C++ from a Node package, aligned with our Buck2 + Nix architecture and project methodology.

For scaffolding commands, template identity uses `ts/*` (for example `scaf new ts cpp-addon ...`), while `node` terms in this document refer to runtime/toolchain behavior.

### Goals and scope

- Provide a reproducible, cross‑platform, hermetic way for Node code to call C++.
- Ship a scaffold that generates:
  - A minimal Node TypeScript library that exposes a function implemented in C++.
  - A C++ “native addon” built as a `.node` shared library via Nix.
  - Buck `TARGETS` wiring that keeps invalidation precise and integrates cleanly with existing provider/auto‑map flows.
- Keep the system minimal, deterministic, and easy to test locally and in CI.

This focuses on a Node library scaffold; a CLI variant can follow the same pattern later.

### Alignment with our build system

- Buck2 remains the orchestrator; Nix performs the actual builds for planner languages (C++), with dynamic derivations and patch‑aware invalidation. See build-tools/docs/build-system-design.md for the language split and planner responsibilities.
- Node is handled by macros with importer‑scoped providers; no changes are required to Node provider wiring for this feature.
- Patches are package‑local: `patches/cpp/` under the C++ package, included in `srcs`, so patch edits precisely invalidate reverse deps.
- Use `TARGETS` files rather than BUCK for new rules and wiring to match repo conventions [[memory:6971968]].
- Implement the scaffold using the existing Copier-based scaffolding system under `build-tools/tools/scaffolding/templates/...` [[memory:6263280]].

## Approaches for Node ↔ C++ integration

1. Node-API (N-API) C++ addon (recommended)

- Build a `.node` shared library with the Node-API ABI via Nix, then load it from Node.
- Pros: fastest in-process calls; stable ABI across Node versions; easy unit tests.
- Cons: requires a dedicated Nix build for the addon and per‑platform outputs.

2. IPC to a C++ binary

- Compile a C++ binary and communicate via stdio or sockets from Node.
- Pros: simpler toolchain coupling; easy to debug; no ABI pitfalls.
- Cons: higher latency; deployment complexity; lifecycle management for the child process.

3. WebAssembly (Emscripten/WASI)

- Compile C++ to Wasm and load via Node’s WASI runtime.
- Pros: portable and sandboxed; no native ABI issues.
- Cons: performance overhead; constrained system access; additional toolchain complexity.

4. FFI (ffi-napi calling a C ABI .so/.dylib)

- Build a shared library with a C ABI and call via ffi-napi.
- Pros: avoids Node-API glue on the C++ side.
- Cons: weaker type safety; maintenance status of ffi-napi; runtime/platform quirks.

### Recommendation

Adopt the Node-API C++ addon approach. It aligns best with our philosophy of deterministic, high‑performance builds and precise invalidation:

- C++ remains a planner language built by Nix (hermetic; cacheable).
- Node remains macro-only with importer‑scoped providers; no new provider shapes are needed.
- The interface is stable across Node versions (N-API), and tests remain straightforward and fast.

## Template shape and wiring

### Template name and location

- Location: `build-tools/tools/scaffolding/templates/ts/cpp-addon/`
- Purpose: scaffold a Node TS library that calls into a C++ Node-API addon.
- Default destination structure (two packages created together):
  - `projects/libs/{{ name }}/` — Node TS library
  - `projects/libs/{{ name }}-native/` — C++ addon (Node-API)

Rationale: separating Node and C++ into sibling packages preserves clear boundaries (SoC) while keeping local patch invalidation precise and isolated.

### Variables (copier.yaml)

- `name` (required): scaffold name (used for both `projects/libs/{{name}}` and `projects/libs/{{name}}-native`).
- `addon_name` (optional, default = `{{ name }}_addon`): shared library base name (`{{ addon_name }}.node`).
- `includeNodeTests` (boolean, default true): generate a single Node test file (one test per file to match project convention).

### Generated files (high level)

1. Node package: `projects/libs/{{ name }}/`

- `package.json` (TS lib configuration; includes `node-addon-api` as a dependency if we choose the C++ header‑only wrapper; otherwise pure N-API C is OK).
- `tsconfig.json`
- `src/index.ts` (loads the `.node` artifact, exports a function)
- `test/index.test.ts` (single test: e.g., `sum(2, 40) === 42`)
- `TARGETS`:
  - `nix_node_lib(name = "{{ name }}", ...)`
  - An additional `nix_node_gen` helper rule to copy the compiled addon into a predictable relative path for runtime consumption (see “Artifact flow” below).

2. C++ addon: `projects/libs/{{ name }}-native/`

- `src/binding.cc` (minimal N-API binding that exposes a function, such as `sum(a, b)`).
- `include/{{ name }}.h` and `src/{{ name }}.cc` (simple implementation used by binding).
- `tests/{{ name }}_gtest.cpp` (optional tiny unit test for the C++ function).
- `patches/cpp/` (empty directory; included in `srcs` to drive precise invalidation).
- `TARGETS`:
  - `nix_cpp_node_addon(name = "napi_addon", addon_name = "{{ addon_name }}", srcs = [...])`
  - Optionally, `nix_cpp_test(...)` for the `gtest`.

### Artifact flow and Buck wiring

- C++ addon target outputs `{{ addon_name }}.node`.
- Node `TARGETS` includes a small `nix_node_gen` rule (e.g., `:copy_addon`) that uses `$(location //projects/libs/{{ name }}-native:napi_addon)` in its `cmd` to copy the `.node` artifact into `$OUT` (for example, to `native/{{ addon_name }}.node`).
- The Node library target (`nix_node_lib`) depends on `:copy_addon` so the addon is an input and placed in a deterministic relative location. The TypeScript wrapper loads the addon from that location using `createRequire(import.meta.url)` to resolve a relative file path.
- Labels:
  - Node target carries its importer‑scoped lockfile label (`lockfile:<path>#<importer>`) as usual; auto‑map stays unchanged.
  - C++ target(s) carry `lang:cpp` and `kind:lib` (addon) labels and any `nixpkg:` labels via shared helpers as needed. No new cross-language providers are introduced for this feature.

### C++ build details (Nix)

- Add a flake template for a C++ Node-API addon, e.g., `build-tools/tools/nix/templates/cpp-node-addon.nix`, with outputs producing a `{{ addon_name }}.node` shared library.
- Link against Node’s N-API headers/libraries provided via `pkgs.nodejs` (headers are part of Node). Optionally include the `node-addon-api` header-only wrapper for ergonomics; either path must remain reproducible via Nix.
- Platform specifics:
  - macOS: `.node` is a Mach-O dylib bundle; ensure correct `-undefined dynamic_lookup` or explicit Node symbols resolution per Node-API guidance.
  - Linux: `.node` is an ELF shared object; ensure `-fPIC` and correct soname flags.
- The Buck C++ macro should invoke an external builder (`cpp_nix_build`) with `kind = "addon"` to select the addon template. If we prefer not to add a new `kind`, a dedicated macro (see below) can delegate to a small wrapper that sets the right Nix attributes.

### New macro: `nix_cpp_node_addon`

Add a small macro in `@viberoots//build-tools/cpp:defs.bzl`:

- Signature sketch: `nix_cpp_node_addon(name, srcs = [], headers = [], addon_name = None, local_patch_dirs = ["patches/cpp"], nixpkg_deps = [], labels = [], ...)`
- Behavior:
  - Stamps labels as `lang:cpp` with kind `addon`.
  - Appends `local_patch_dirs` to `srcs` so patch changes invalidate precisely.
  - Forwards to `cpp_nix_build` (or a thin wrapper) selecting the Node-API addon Nix template.
  - Output file: `{{ addon_name or name }}.node`.

This keeps C++ a planner language and avoids introducing Node‑specific logic into Node macros.

### Naming and load path

- Macro contract: `nix_cpp_node_addon` accepts an optional `addon_name`. The macro records this as a label (`addon_name:<name>`) for planner/tooling visibility; it does not change macro semantics at build time.
- Build artifact: the Nix build produces a single `.node` shared library. Do not rely on buck‑out paths for runtime loading.
- Stable runtime path: the Node package should copy the built addon into a deterministic location such as `native/{{ addon_name }}.node` using a small copy rule (e.g., `nix_node_gen`). The TS wrapper loads from that path via `createRequire(import.meta.url)`.
- Recommendation: set `addon_name` in scaffolds to keep the runtime filename stable and self‑documenting. Changing `addon_name` affects only the copied runtime filename and the planner hint label.

### Node wrapper code (loading addon)

- Use `createRequire(import.meta.url)` (or CommonJS `require`) to load the `.node` artifact from a predictable relative path (copied by the `:copy_addon` rule).
- Example runtime logic:
  - Try `./native/{{ addon_name }}.node` relative to the compiled JS.
  - Optionally respect `process.env.ADDON_PATH` as an override for dev/test diagnostics.

### Testing

- Node: one test file (`test/index.test.ts`) using `nix_node_test` that imports the package and asserts the bound function result (e.g., `sum(2, 40) === 42`). Ensure a single test per file to align with project parallelization conventions.
- C++: optional `nix_cpp_test` with a minimal gtest verifying the pure C++ function. This is not strictly necessary for the Node-only UX but is useful to demonstrate the split in responsibilities and enable TDD on the native side.

## Scaffolding specifics

### Template content (proposed)

- `meta.json` — describes the template: language `node`, template `cpp-addon`, usage, examples, and notes.
- `copier.yaml` — variables and defaults (see above).
- Node package files (TS lib): `package.json.jinja`, `tsconfig.json.jinja`, `src/index.ts.jinja`, `test/index.test.ts.jinja`, `TARGETS.jinja`.
- C++ addon files: `include/{{ name }}.h.jinja`, `src/{{ name }}.cc.jinja`, `src/binding.cc.jinja`, `tests/{{ name }}_gtest.cpp.jinja`, `patches/cpp/pkgs__placeholder@0.0.0.patch.jinja`, `TARGETS.jinja`.
- Nix template (shared, not per scaffold instance): `build-tools/tools/nix/templates/cpp-node-addon.nix` (added once in repo, referenced by the C++ addon macro).

### Post‑gen and local iteration

- After `scaf new ts cpp-addon <name>`:
  - If the workspace lacks a PNPM lock for the Node importer, run dependency setup (per existing Node templates). The Node project follows the same dev shell conventions.
  - Run:
    - `node build-tools/tools/buck/export-graph.ts`
    - `node build-tools/tools/buck/sync-providers.ts --lang node` (if lockfiles exist)
    - `node build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`
  - Build: `buck2 build //projects/libs/{{ name }}:{{ name }}`
  - Test: `buck2 test //projects/libs/{{ name }}:{{ name }}_test`

No new glue stages are required; prebuild guard continues to check for graph and auto_map freshness.

## Implementation plan (phased, with acceptance)

Phase 0 — Nix + macro substrate

- Add `build-tools/tools/nix/templates/cpp-node-addon.nix` that produces a `.node` shared library for macOS and Linux given a set of sources/headers and an `addon_name`.
- Extend `//build-tools/cpp/private:nix_build.bzl` and/or add `nix_cpp_node_addon` in `@viberoots//build-tools/cpp:defs.bzl` selecting the addon template.
- Acceptance:
  - A tiny hand-built sample addon compiles via `buck2 build` and produces `*.node` on Darwin/Linux (CI matrix).

Phase 1 — Scaffolding template

- Add `build-tools/tools/scaffolding/templates/ts/cpp-addon/` with the content outlined above.
- Ensure the Node `TARGETS` uses a `nix_node_gen` helper (e.g., `:copy_addon`) that copies `$(location //projects/libs/{{ name }}-native:napi_addon)` into a `native/{{ addon_name }}.node` path the wrapper loads.
- Acceptance:
  - `scaf new ts cpp-addon demo` creates both `projects/libs/demo` and `projects/libs/demo-native`.
  - `buck2 build //projects/libs/demo:demo` and `buck2 test //projects/libs/demo:demo_test` pass locally across supported platforms.

Phase 2 — Docs and examples

- Add a short README to the scaffolded Node package explaining how the binding works and where the native artifact lives.
- Provide a note on adding more exported functions (C++ and TS).
- Acceptance:
  - New devs can run `scaf new`, build, run tests, and understand the flow in five minutes.

Phase 3 — Hardening

- Validate cross‑platform flags and rpaths; ensure `prebuild-guard` remains effective.
- Optional: add a thin CLI variant reusing the same addon and loading path.
- Acceptance:
  - All CI lanes green; reproducible builds across the three primary architectures.

## Risks and mitigations

- Node version drift: use Node-API (N-API) level targeting to decouple from Node minor/patch versions; confirm dev shell pinning matches our Node baseline from the repo flake.
- Discovery/path churn: rely on Buck `$(location ...)` in the copy rule to avoid brittle buck‑out paths; keep the runtime load relative to the package’s compiled output.
- Over‑coupling of Node and C++: separation into `projects/libs/{{ name }}` and `projects/libs/{{ name }}-native` preserves SoC and small ownership surface.

## Future extensions

- Add `wasm-addon` variant using WASI for sand‑boxed portability when performance is less critical.
- Add IPC scaffold variant for service‑style composition across process boundaries.

## Summary (decision)

- Implement the `node/cpp-addon` scaffold using a Node-API C++ addon built by Nix, wired by new macro `nix_cpp_node_addon`, and consumed by a Node TS library via a small copy genrule and a stable relative load path.
- This is the most consistent with our design philosophy (Buck orchestrator, Nix planner for C++, macro‑only Node, package‑local patches, generated glue outside Nix) while providing the best developer and runtime experience.
