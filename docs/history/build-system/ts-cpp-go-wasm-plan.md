## TS + C++ + Go — Node Addon and WebAssembly Plan (Multi‑Target Deliverable)

This plan lays out a sequence of small, reversible PRs to fully implement the architecture described in `docs/history/build-system/ts-cpp-go-web-brainstorming.md`: one TypeScript package with two entrypoints (`node` via N‑API, `browser` via WASM), reusing a single logic core (C++) and a Go layer. All items are designed to be low‑risk, independently verifiable, and behavior‑preserving to the rest of the repo unless explicitly noted.

## PR‑1: C++ Core + C Wrapper (native + wasm‑static lib)

### Description

Introduce the C++ core library with a tiny, stable C ABI surface (wrapper) and build it both as a native static library and as a wasm‑targeted static library. This establishes the single computation source of truth.

### Scope & Changes

- Scaffold `libs/math-core` in a runInTemp zx test (no live repo changes):
  - `include/core/math.h`, `include/addon.h` (extern "C")
  - `src/core/math.cc`, `src/cwrapper/addon.c`
  - `TARGETS` in the temp repo with:
    - native: `nix_cpp_lib`
    - wasm: `nix_cpp_wasm_static_lib` (new macro in a later PR; stub now)
- Nix templates (scaffold only for now):
  - Placeholder for `cppWasmStaticLib` in `build-tools/tools/nix/templates/cpp.nix` (no behavior change; wiring lands in PR‑4).
- Docs:
  - Short README in `libs/math-core` documenting the C ABI contract (`addon.h`) and portability constraints (no exceptions/RTTI across boundary).
- Tests:
  - Optional gtest sanity (one test file) covering a pure compute function in the native `.a`.

### Acceptance Criteria

- In a runInTemp temp repo, native `libcore.a` builds via the existing C++ template.
- Header `addon.h` is the only public surface (no exceptions/RTTI across ABI).
- Docs may live in the temp scaffold or plan notes; test executes successfully.
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

- Scaffold `libs/math-go-core` (cgo wrapper over `addon.h`) and `libs/math-api` (public Go API calling into go‑core) inside a runInTemp zx test (no live repo changes).
- Use `nix_go_library` macros in the temp repo’s `TARGETS`.
- Generate `gomod2nix.toml` for each temp Go module within the runInTemp workspace using the existing install-deps flow.
- Docs:
  - READMEs in `libs/math-go-core` and `libs/math-api` describing the layering, cgo boundary, and how `gomod2nix.toml` is regenerated.
- Tests:
  - `go test` covering one exported API path; ensure pure deterministic compute.

### Acceptance Criteria

- In a runInTemp temp repo, `buck2 build //projects/libs/math-api:lib` succeeds on all supported systems.
- In that temp repo, `go test` basic unit covers one exported function (pure compute path).
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

- Scaffold `libs/math-native` in a runInTemp zx test (no live repo changes):
  - `src/binding.cc` (N‑API shim calling Go `extern "C"` symbols)
  - `TARGETS` uses `nix_cpp_node_addon` with `nixCxxPkgs=[ //projects/libs/math-api:carchive, //projects/libs/math-core:lib ]`.
- Exercise a temp `libs/math-ts/src/node/index.ts` that `require("./native/math_native.node")` and exports functions (live packaging lands in PR‑7).
- Add a small TS test (`build-tools/tools/tests/...`) asserting `add(2,3)=5` via the node entrypoint.
- Docs:
  - `libs/math-native/README.md` documenting symbol exposure, platform notes, and how the TS node entry consumes the addon.

### Acceptance Criteria

- In a runInTemp temp repo, `buck2 build //projects/libs/math-native:napi_addon` produces a `.node` artifact.
- The temp TS node entry loads and passes the unit test.
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
  - `cppWasmStaticLib` in `build-tools/tools/nix/templates/cpp.nix` (clang `--target=wasm32-{unknown-unknown|wasi}` → `libcore_wasm.a`)
- Buck macros:
  - `nix_cpp_wasm_static_lib`
- Tests (runInTemp):
  - Build produces `libcore_wasm.a` and headers; add a tiny compile/link smoke target in the temp repo to verify archive usability (no TS yet).
- Docs:
  - Notes in `libs/math-core/README.md` documenting wasm build flags and constraints (no syscalls).

### Acceptance Criteria

- In a runInTemp temp repo, `libcore_wasm.a` builds deterministically for supported systems.
- A minimal smoke link target succeeds.
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

- In a runInTemp temp repo, `top.wasm` builds; browser test passes (Node’s `WebAssembly` acceptable for test or headless harness).
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

## PR‑6b: Backend Toggle — WASI (opt‑in, single‑artifact)

### Description

Add a third, optional web backend that compiles the C++ core to `wasm32-wasi` and builds the TinyGo top module with `-target wasi`, linking the WASI‑built C static library. This produces a single `top.wasm` that depends on a WASI runtime (e.g., Node’s `node:wasi`, wasmtime/wasmer). It is opt‑in and does not alter the default TinyGo‑bare flow.

### Rationale and fit

- Enables libc‑style APIs and limited syscalls via WASI without Emscripten’s JS glue.
- Aimed at server/CLI or WASI host environments; not intended for browsers (which currently require a WASI polyfill).
- Keeps defaults minimal: `tinygo_single` remains default; `emscripten_dual` remains the richer browser‑focused option.

### Scope & Changes

- Nix templates:
  - Extend `cppWasmStaticLib` to support `wasmTarget = "wasm32-wasi"` and wire a WASI sysroot (e.g., `wasi-libc`/`wasi-sdk`) via `--sysroot`.
  - Add TinyGo build option `-target wasi` for the WASI backend so the resulting Go object can link with the `wasm32-wasi` C static library.
- Buck macros:
  - Extend backend toggle to include WASI:
    - `webWasmBackend = "tinygo_single" | "wasi_single" | "emscripten_dual"` (default: `tinygo_single`).
  - When `wasi_single` is selected:
    - Build `libcore_wasm.a` with `wasm32-wasi` sysroot;
    - Build TinyGo top with `-target wasi`, link in the archive, emit single `top.wasm`.
- Tests (runInTemp):
  - C++ build smoke for `wasm32-wasi` archive (as in PR‑4).
  - Node WASI smoke: instantiate `top.wasm` using Node’s `node:wasi` module and call `add(2,3)`.
- Docs:
  - Update backend matrix to include WASI; document:
    - Appropriate environments (WASI runtimes).
    - Browser caveat: WASI polyfill required; not recommended for regular browsers.
    - How to set `webWasmBackend=wasi_single`; required Nix inputs (WASI sysroot).

### Acceptance Criteria

- `cppWasmStaticLib` deterministically builds `libcore_wasm.a` for `wasm32-wasi` (sysroot pinned).
- TinyGo top builds with `-target wasi`, linking `libcore_wasm.a`, producing one `top.wasm`.
- Node WASI smoke test passes in a temp repo (`node:wasi` runner).
- Default remains `tinygo_single`; no behavior change unless `wasi_single` is selected.

### Risks

- Browser compatibility: WASI is not natively supported in browsers; requires a polyfill.
- Larger artifacts than bare `wasm32-unknown-unknown` due to WASI libc and initialization.
- Additional toolchain inputs (WASI sysroot) and configuration; must be pinned for determinism.
- Cross‑target alignment: both C++ and TinyGo must target WASI to link successfully.

### Consequence of Not Implementing

Teams needing libc‑like behavior under WASI must use Emscripten or maintain bespoke shims.

### Downsides for Implementing

Adds another backend to maintain and a wider test matrix (at least a Node WASI smoke).

### Recommendation

Implement as opt‑in; keep defaults on `tinygo_single`. For browsers, prefer TinyGo bare or Emscripten depending on needs.

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

- `build-tools/tools/scaffolding/templates/ts-go-cpp-lib/`:
  - `libs/<name>-core` (C++ core + C wrapper), `libs/<name>-go-core` (cgo), `libs/<name>-api` (Go API), `libs/<name>-native` (N‑API), `libs/<name>-ts` (TS package with dual entries)
  - `TARGETS` stubs for each; optional gtest stub.
- `build-tools/tools/scaffolding/templates/wasm-app/`:
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
5. PR‑6 (Backend toggle: Emscripten) — optional capability; land after stable TinyGo path.
6. PR‑6b (Backend toggle: WASI) — optional capability; WASI single‑artifact path for WASI runtimes.
7. PR‑7 (TS packaging) — conditional exports and staging finalized.
8. PR‑8 (Scaffolding) — make it easy to replicate the pattern.
9. PR‑9 (Budgets) — optional polish.

## Verification & Backout Strategy

- Each PR includes unit/E2E tests and README/docs scoped to the new capability; run `i && b && v` locally.
- Backout: revert only the PR’s new files and TARGETS entries; prior paths remain functional.
- No provider shape changes; prebuild guard and exporter remain unaffected.
- For backend toggle (PR‑6), default remains TinyGo; if issues arise, backout to default by removing the emscripten rule and loader branch.

## Compliance with build-tools/docs/build-system-design.md

- Buck as orchestrator; Nix performs hermetic builds via language templates/macros. No new provider shapes.
- Planner vs exporter homes respected: language templates under `build-tools/tools/nix/templates/**`; glue is zx TypeScript; no `nix run` wrappers for generators.
- Package‑local patches (`patches/{cpp,go}/*.patch`) included in `srcs`; precise invalidation preserved.
- Dev override environment variables honored: warn locally; fail in CI per shared helpers; templates in PR‑5 include guardrails.
- Node importer‑scoped providers unchanged; TS packaging does not alter provider mapping or auto_map behavior.
- Cross‑platform parity: aarch64‑darwin, aarch64‑linux, x86_64‑linux targeted by default templates.

## Summary of Expected Impact

- A single TS package that “just works” in Node and the browser with identical API and types.
- Clean separation of concerns: C++ core, Go layer, TS loaders; low cyclomatic complexity.
- Deterministic builds and precise invalidation (Nix + Buck), compliant with project methodology.
- Scaffolding enables quick, repeatable adoption across new libraries/apps.
