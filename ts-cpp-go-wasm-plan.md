## TS + C++ + Go — Node Addon and WebAssembly Plan (Multi‑Target Deliverable)

This plan lays out a sequence of small, reversible PRs to fully implement the architecture described in `ts-cpp-go-web-brainstorming.md`: one TypeScript package with two entrypoints (`node` via N‑API, `browser` via WASM), reusing a single logic core (C++) and a Go layer. All items are designed to be low‑risk, independently verifiable, and behavior‑preserving to the rest of the repo unless explicitly noted.

## PR‑1: C++ Core + C Wrapper (native + wasm‑static lib)

### Description

Introduce the C++ core library with a tiny, stable C ABI surface (wrapper) and build it both as a native static library and as a wasm‑targeted static library. This establishes the single computation source of truth.

### Scope & Changes

- Add `libs/math-core`:
  - `include/core/math.h`, `include/addon.h` (extern "C")
  - `src/core/math.cc`, `src/cwrapper/addon.c`
  - `TARGETS` with:
    - native: `nix_cpp_lib`
    - wasm: `nix_cpp_wasm_static_lib` (new macro in a later PR; stub now)
- Nix templates (scaffold only for now):
  - Placeholder for `cppWasmStaticLib` in `tools/nix/templates/cpp.nix` (no behavior change; wiring lands in PR‑4).
- Docs:
  - Short README in `libs/math-core` documenting the C ABI contract (`addon.h`) and portability constraints (no exceptions/RTTI across boundary).
- Tests:
  - Optional gtest sanity (one test file) covering a pure compute function in the native `.a`.

### Acceptance Criteria

- Native `libcore.a` builds via existing C++ template.
- Header `addon.h` is the only public surface (no exceptions/RTTI across ABI).
- Docs present in `libs/math-core/README.md`; test executes successfully.
- No changes to other targets; CI unaffected.

### Risks

Low. New, isolated library with minimal code.

### Consequence of Not Implementing

No single C++ source of truth; later layers would drift.

### Downsides for Implementing

None significant.

### Recommendation

Implement.

---

## PR‑2: Go Layer (go‑core via cgo, go‑api facade) + gomod2nix

### Description

Add a Go layer that calls the C ABI (`addon.h`) and a thin Go API facade that will be exported to Node/WASM later.

### Scope & Changes

- Add `libs/math-go-core` (cgo wrapper over `addon.h`) and `libs/math-api` (public Go API calling into go‑core).
- `TARGETS` for both using existing `nix_go_library` macros.
- Add/lock `gomod2nix.toml` for each Go module; ensure `tools/dev/install-deps.ts` flow updates lockfiles.
- Docs:
  - READMEs in `libs/math-go-core` and `libs/math-api` describing the layering, cgo boundary, and how `gomod2nix.toml` is regenerated.
- Tests:
  - `go test` covering one exported API path; ensure pure deterministic compute.

### Acceptance Criteria

- `buck2 build //libs/math-api:lib` succeeds on all supported systems.
- `go test` basic unit covers one exported function (pure compute path).
- Docs present and accurate (cgo boundary and lockfile regeneration steps).

### Risks

Low. Straightforward cgo + facade.

### Consequence of Not Implementing

Cannot export Go to Node or compile to WASM consistently.

### Downsides for Implementing

Additional modules and lockfiles to maintain.

### Recommendation

Implement.

---

## PR‑3: Node Path — N‑API Addon (C++) + Go c‑archive

### Description

Build a Node addon that links the Go API as a `c-archive` and the native C++ core, with a tiny C++ N‑API shim. Provide a TS node entry that re‑exports typed functions.

### Scope & Changes

- Add `libs/math-native`:
  - `src/binding.cc` (N‑API shim calling Go `extern "C"` symbols)
  - `TARGETS` uses `nix_cpp_node_addon` with `nixCxxPkgs=[ //libs/math-api:carchive, //libs/math-core:lib ]`.
- Add `libs/math-ts/src/node/index.ts` that `require("./native/math_native.node")` and exports functions.
- Add a small TS test (`tools/tests/...`) asserting `add(2,3)=5` via the node entrypoint.
- Docs:
  - `libs/math-native/README.md` documenting symbol exposure, platform notes, and how the TS node entry consumes the addon.

### Acceptance Criteria

- `buck2 build //libs/math-native:napi_addon` produces a `.node` artifact.
- TS node entry loads and passes the unit test.
- Docs present in `libs/math-native/README.md`.

### Risks

Moderate: linking details (symbol names), but contained.

### Consequence of Not Implementing

Node entrypoint would be missing.

### Downsides for Implementing

None significant beyond initial shim work.

### Recommendation

Implement.

---

## PR‑4: Web Path — C++ to WASM Static Lib (template + macro)

### Description

Add Nix template/macro to compile the C++ core into a wasm static library (`libcore_wasm.a`) with a minimal C wrapper surface. This isolates C++→wasm work into a single, testable step.

### Scope & Changes

- Nix templates:
  - `cppWasmStaticLib` in `tools/nix/templates/cpp.nix` (clang `--target=wasm32-{unknown-unknown|wasi}` → `libcore_wasm.a`)
- Buck macros:
  - `nix_cpp_wasm_static_lib`
- Tests:
  - Build produces `libcore_wasm.a` and headers; add a tiny compile/link smoke target to verify archive usability (no TS yet).
- Docs:
  - Notes in `libs/math-core/README.md` documenting wasm build flags and constraints (no syscalls).

### Acceptance Criteria

- `libcore_wasm.a` builds deterministically for supported systems.
- Minimal smoke link target succeeds.
- No provider shape changes; Node path unaffected.
- Docs updated in `libs/math-core/README.md`.

---

## PR‑5: Web Path — TinyGo top.wasm + TS Browser Loader

### Description

Link the TinyGo‑compiled Go API with `libcore_wasm.a` to produce `top.wasm` and add the ESM browser loader that re‑exports the TS API.

### Scope & Changes

- Nix templates:
  - `goTinyWasmLib` template to produce `top.wasm` linking `libcore_wasm.a` (TinyGo toolchain)
- Buck macros:
  - `nix_go_tiny_wasm_lib`
- `libs/math-ts/src/browser/index.ts` ESM loader (`instantiateStreaming`) re‑exporting the same API.
- Tests:
  - TS browser test imports loader and asserts `add(2,3)=5`.
- Docs:
  - `libs/math-ts/README.md` (browser section) documenting loader behavior, relative asset paths, and WASM constraints (no syscalls).

### Acceptance Criteria

- `top.wasm` builds; browser test passes (Node’s `WebAssembly` acceptable for test or headless harness).
- No change to Node path; both entries co‑exist in the same TS package.
- Dev‑override guardrails honored in templates (warn local, fail CI).
- Docs present in `libs/math-ts/README.md` (browser section).

---

## PR‑6: Backend Toggle — TinyGo (default) vs Emscripten (opt‑in)

### Description

Allow developers to choose the web backend per build: a single‑artifact TinyGo module (default) or a dual‑artifact Emscripten C++ runtime + TinyGo Go API.

### Scope & Changes

- Add `nix_cpp_wasm_emscripten_lib` to build `core_cpp_emscripten.{js,wasm}` (Asyncify/ports flags off by default; configurable).
- TS browser loader reads a generated manifest and, for `emscripten_dual`, loads both artifacts and routes calls.
- Nix arg: `webWasmBackend = "tinygo_single" | "emscripten_dual"` defaulting to tinygo.
- Docs:
  - Backend comparison note (size/perf/features), COOP/COEP/threads guidance, and how to flip the Nix/Buck arg. Add to `libs/math-ts/README.md`.
- Tests:
  - Run the browser test in both backends; optional extra check when Asyncify is enabled.

### Acceptance Criteria

- Two build modes: `tinygo_single` (one `top.wasm`) and `emscripten_dual` (TinyGo `top.wasm` + Emscripten C++ runtime).
- Browser unit test passes in both modes.
- Docs updated with backend selection guidance.

### Risks

Moderate: loader coordination, artifact staging, COOP/COEP docs if threads enabled.

### Consequence of Not Implementing

Teams can’t opt into richer Emscripten features when needed.

### Downsides for Implementing

Slightly larger generator/loader logic; optional path.

### Recommendation

Implement.

---

## PR‑7: TypeScript Package Packaging — Conditional Exports + Artifacts Staging

### Description

Finalize `libs/math-ts` packaging with conditional exports, type declarations, and artifact staging for both Node and Browser entries.

### Scope & Changes

- `package.json` exports:
  - `"browser": "./dist/browser/index.js"`
  - `"node": "./dist/node/index.cjs"`
  - `"types": "./dist/types/index.d.ts"`
- Staging rules in Buck/Nix to copy `.node`, `top.wasm`, and (optionally) `core_cpp_emscripten.{js,wasm}` to stable paths under `dist/`.
- Emit `.d.ts` for the shared API surface.
- Docs:
  - TS package README section showing import examples for Node and Browser, and artifact paths.
- Tests:
  - Simple import tests for both entrypoints to ensure conditional exports resolve correctly.

### Acceptance Criteria

- `import "@org/math"` works in Node and browser with identical types.
- Artifacts are placed consistently; loaders resolve relative paths.
- README and import tests present.

### Risks

Low. Packaging wiring.

### Consequence of Not Implementing

Consumers face import friction and path drift.

### Downsides for Implementing

None.

### Recommendation

Implement.

---

## PR‑8: Scaffolding — Library + WASM App Demo (uses both paths)

### Description

Add scaffolding templates to generate a minimal library and a demo app that exercises both entrypoints: Node (N‑API) and Browser (WASM) from a single TS API.

### Scope & Changes

- `tools/scaffolding/templates/ts-go-cpp-lib/`:
  - `libs/<name>-core` (C++ core + C wrapper), `libs/<name>-go-core` (cgo), `libs/<name>-api` (Go API), `libs/<name>-native` (N‑API), `libs/<name>-ts` (TS package with dual entries)
  - `TARGETS` stubs for each; optional gtest stub.
- `tools/scaffolding/templates/wasm-app/`:
  - Minimal browser app that imports `@org/<name>/browser` (and a Node script that imports `@org/<name>/node`)
  - TARGETS to bundle/copy assets; test that runs both codepaths (`add(2,3)=5`)
- CLI integration (scaf): new blueprint names, prompts, and README.
- Docs:
  - Template READMEs per generated package and a top‑level scaffold README that explains how to build/run Node and Browser paths.
- Tests:
  - Generated tests under the scaffolded repo structure (one test file per check).

### Acceptance Criteria

- `scaf new ts-go-cpp-lib <name>` generates a compilable library skeleton.
- `scaf new wasm-app <name>` generates a demo app that runs both entries and passes the single test per file convention.

### Risks

Low. Mostly templates and wiring.

### Consequence of Not Implementing

Harder onboarding and repeatable demos.

### Downsides for Implementing

Template maintenance.

### Recommendation

Implement.

---

## PR‑9: Packaging Polish — Size/Perf Budgets (Optional)

### Description

Track WASM size and cold‑start timing within soft budgets to prevent accidental bloat across PRs.

### Scope & Changes

- Simple ZX timing/size checks in tests (warn‑only locally; disabled in CI initially).

### Acceptance Criteria

- Budget checks run locally; do not fail CI in the initial rollout.

### Risks

Low. Instrumentation only.

### Consequence of Not Implementing

Potential gradual bloat.

### Downsides for Implementing

Slight local noise; opt‑out possible.

### Recommendation

Implement (optional).

---

## Rollout & Sequencing

1. PR‑1 (C++ core) — foundation; safest first.
2. PR‑2 (Go layer) — cgo + API facade; unlocks both paths.
3. PR‑3 (Node N‑API) — server entrypoint online.
4. PR‑4 (C++ wasm static lib) → PR‑5 (TinyGo top.wasm + browser loader).
5. PR‑6 (Backend toggle) — optional capability; land after stable TinyGo path.
6. PR‑7 (TS packaging) — conditional exports and staging finalized.
7. PR‑8 (Scaffolding) — make it easy to replicate the pattern.
8. PR‑9 (Budgets) — optional polish.

## Verification & Backout Strategy

- Each PR includes unit/E2E tests and README/docs scoped to the new capability; run `i && b && v` locally.
- Backout: revert only the PR’s new files and TARGETS entries; prior paths remain functional.
- No provider shape changes; prebuild guard and exporter remain unaffected.
- For backend toggle (PR‑6), default remains TinyGo; if issues arise, backout to default by removing the emscripten rule and loader branch.

## Compliance with build-system-design.md

- Buck as orchestrator; Nix performs hermetic builds via language templates/macros. No new provider shapes.
- Planner vs exporter homes respected: language templates under `tools/nix/templates/**`; glue is zx TypeScript; no `nix run` wrappers for generators.
- Package‑local patches (`patches/{cpp,go}/*.patch`) included in `srcs`; precise invalidation preserved.
- Dev override environment variables honored: warn locally; fail in CI per shared helpers; templates in PR‑5 include guardrails.
- Node importer‑scoped providers unchanged; TS packaging does not alter provider mapping or auto_map behavior.
- Cross‑platform parity: aarch64‑darwin, aarch64‑linux, x86_64‑linux targeted by default templates.

## Summary of Expected Impact

- A single TS package that “just works” in Node and the browser with identical API and types.
- Clean separation of concerns: C++ core, Go layer, TS loaders; low cyclomatic complexity.
- Deterministic builds and precise invalidation (Nix + Buck), compliant with project methodology.
- Scaffolding enables quick, repeatable adoption across new libraries/apps.
