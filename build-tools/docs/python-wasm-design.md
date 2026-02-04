## Python → WASM: Backends Plan (WASI + Pyodide)

This document defines a minimal, deterministic plan to add Python/WASM support that fits our build‑system philosophy: architectural minimalism, hermetic Nix builds, importer‑scoped invalidation (providers + auto_map), and a single, uniform patch workflow.

### Goals (what “done” looks like)

- Build and run selected Python targets as WASM artifacts without network access.
- Support two execution environments under one interface:
  - WASI (server/CLI, deterministic CI execution),
  - Pyodide (browser execution in a headless test harness).
- Support both WASM apps (runnable artifacts) and WASM libraries (reusable site/FS bundles consumed by apps).
- Keep the existing patch workflow intact: `patches/python/*.patch` filtered per importer (`uv.lock`), applied deterministically at build time.
- Preserve provider/auto_map behavior and importer‑scoped invalidation; WASM is a new realization path, not a new dependency model.

### Non‑goals (initial phase)

- Third‑party native C‑extensions inside WASM (in‑repo `kind:pyext_wasm` modules are supported separately).
- Immediate full parity between WASI and Emscripten on day one. We will stage delivery.

---

## Constraints and Invariants

- Determinism: no network during builds; inputs fixed by `uv.lock` and patch files.
- Hermetic Nix: toolchains pinned; outputs content‑addressed.
- Importer‑scoped providers: WASM does not add new labels or providers.
- Patching: `patch-pkg start/apply/reset/session` remains authoritative; dev overrides warn locally, fail in CI.
- WASI extension modules are not supported at runtime today (the pinned WASI CPython build lacks dynamic module loading). The planner fails fast when a WASI target depends on `kind:pyext_wasm` producers.

## WASM extension modules (graph contract only)

I add a Buck macro for WASM-targeted extension modules so the planner can route them by backend without mixing native `kind:pyext` and WASM contracts.

- Macro: `nix_python_wasm_extension_module`
- Required attrs: `module`, `srcs`
- Optional attrs: `headers`, `cflags`, `ldflags`, `build_py_deps`, `link_deps`, `header_deps`, `link_closure`, `link_closure_overrides`
- Labels: `lang:python`, `kind:pyext_wasm`, plus one backend label (`backend:wasi` or `backend:pyodide`)

The link model is intentionally narrow and enforced in the planner:

- `link_deps` must be `lang:cpp`, `kind:wasm`, `wasm:static`
- `header_deps` must be `lang:cpp`, `kind:headers`
- `backend:wasi` requires linked deps to be stamped `wasm:wasi`
- `backend:pyodide` rejects `wasm:wasi` deps to avoid ABI mismatches

---

## Backend 1 — WASI (CPython wasm32‑wasi)

Description

- Use a pinned CPython wasm32‑wasi runtime to execute Python bytecode under Node’s WASI runner.
- Template behavior:
  - Materialize site‑packages from `uv.lock` (pure‑Python deps only).
  - Apply `patches/python/*.patch` keyed by `<name>@<version>` at build time.
- Create a WASI entry that runs `bin/__main__.py` and imports extension overlays at runtime.
  - Build `kind:pyext_wasm` modules with `T.pyExtWasi` (for Pyodide only today) and merge overlays into app/lib outputs.
  - Fail fast when a WASI app or lib depends on any `kind:pyext_wasm` targets (runtime lacks dynamic module loading).

The WASI toolchain is pinned in `build-tools/tools/nix/toolchains/python-wasi.nix`. `T.pyExtWasi` reads `EXT_SUFFIX` and headers from that toolchain, and the runtime uses the same pinned WASI Python artifacts for execution.

Pros

- Closest to CPython semantics for pure‑Python stacks.
- Reuses importer‑scoped providers and today’s patch flow unchanged.
- Simple to test in CI with a WASI runner.

Cons / Risks

- Larger artifacts (CPython+stdlib); longer cold‑start.
- WASI I/O constraints; no native C‑extensions.
- Runtime differences across WASI hosts.

---

## Backend 2 — Pyodide (browser runtime)

Description

- Package a pinned Pyodide runtime for browser/WASM and assemble dependencies entirely offline using Nix. Execution is via a headless Node harness that runs `bin/__main__.py`.
- Template behavior:
  - Assemble a browser bundle: `{ .wasm, loader JS, FS image }` from pinned Pyodide + importer deps.
  - Apply `patches/python/*.patch` at build time before bundling.

For Pyodide extension modules, I build Emscripten side modules with `T.pyExtWasm` and keep the output under `$out/site/<module path>${EXT_SUFFIX}` so overlays remain deterministic.

### Pyodide extension overlays (planner + templates)

For Pyodide apps and libs, I merge extension overlays directly into the Pyodide filesystem so imports resolve from a single, deterministic site tree. This keeps the WASM extension contract aligned with the native overlay flow.

- The planner collects `kind:pyext_wasm` deps only when the consumer is `backend:pyodide` (WASI targets fail fast).
- `pyWasmApp` merges overlays in a fixed order: app site → lib overlays → extension overlays.
- `pyWasmLib` merges its own site, then its extension overlays.
- If a Pyodide target depends on a `backend:wasi` extension, the planner fails fast with a targeted error.

Pros

- Enables true in‑browser execution and tests.
- Mature ecosystem for pure‑Python packages.

Cons / Risks

- Packaging complexity: mapping `uv.lock` → Pyodide inputs deterministically.
- Large payloads; careful pinning and caching required.
- Patch flow requires rebundling (handled deterministically in Nix).

---

## Comparative Summary

- WASI (CPython wasm32‑wasi): Best for CLI/CI; minimal integration cost; pure‑Python only.
- Pyodide: Required for browser; higher integration cost; must be tightly pinned and assembled offline to preserve determinism.

---

## Recommendation

Expose a pair of Python/WASM templates (app + lib) with a backend parameter, mirroring Go/C++:

- `pyWasmApp { name, lockfile, subdir, groups, backend ? "wasi" }`
- `pyWasmLib { name, lockfile, subdir, groups, backend ? "wasi" }`
  - Phase 1: backend="wasi" (establish a deterministic baseline for CI/CLI).
  - Phase 2: backend="pyodide" (enable browser execution with pinned Pyodide).

This mirrors our multi‑backend approach in other languages and preserves our importer‑scoped provider model and patch workflow.

---

## Implementation Outline (phased)

Phase 1 — Template and Planner (WASI)

- Add `build-tools/tools/nix/templates/python/wasm.nix` exposing `pyWasmApp` and `pyWasmLib` with a `backend` parameter (default `"wasi"`).
- For `backend="wasi"`:
  - App: lay out site‑packages from `uv.lock` (pure‑Python only); apply patches; wire `bin/__main__.py`; produce a WASI‑runnable artifact (Node WASI or `wasmtime`).
  - Lib: produce a reusable site/overlay (no entrypoint) to be composed by apps via PYTHONPATH/FS.
- Planner: add `mkWasmApp` and `mkWasmLib` in `build-tools/tools/nix/planner/python.nix`, or map a `kind:wasm` selector to pick app vs lib; labels/providers unchanged.
- Providers/labels unchanged (importer‑scoped lockfile labels remain the invalidation key).

Phase 2 — Template (Pyodide) and Browser Harness

- For `backend="pyodide"`:
  - App: pin Pyodide and inputs in Nix; build an offline bundle `{ .wasm, loader JS, FS }`; apply patches before bundling.
  - Lib: emit a Pyodide FS overlay (or preindexed wheel set) that the app bundle mounts before execution; apply patches before overlay creation.
- Provide a tiny headless harness (Node + Pyodide) reused across tests.

Phase 3 — Buck Macros and Scaffolding

- Add in `build-tools/python/defs.bzl`:
  - `nix_python_wasm_app(name, lockfile_label, backend = "wasi")` stamping `lang:python`, `kind:wasm`, wiring providers from `auto_map.bzl`.
  - `nix_python_wasm_lib(name, lockfile_label, backend = "wasi")` stamping `lang:python`, `kind:wasm`, wiring providers from `auto_map.bzl`; emits a reusable bundle with no entrypoint.
- Optional scaffolding switch to demonstrate WASI and browser variants (pure‑Python only).

Phase 4 — Tests (single‑test‑per‑file; external timeouts)

- WASI:
  - `python.wasm.wasi.build-and-run.test.ts` — build with `backend="wasi"`, run via Node WASI; assert output.
  - `python.wasm.wasi.patch-affects-execution.test.ts` — patch a dependency; rebuild; assert changed output.
  - `python.wasm.wasi.lib-consumed-by-app.test.ts` — build a lib bundle; build an app that consumes it; run and assert output.
- Pyodide:
  - `python.wasm.pyodide.browser-run.test.ts` — build with `backend="pyodide"`, run in headless browser; assert output.
  - `python.wasm.pyodide.patch-affects-execution.test.ts` — patch a dependency; rebuild/bundle; assert changed browser output.
  - `python.wasm.pyodide.lib-consumed-by-app.test.ts` — build a lib overlay; mount it in an app bundle; assert output.

Acceptance Criteria

- `nix_python_wasm_app` and `nix_python_wasm_lib` build deterministically for both backends.
- A patch to a dependency changes program behavior under each backend.
- Re‑runs with unchanged inputs are no‑ops (idempotent) for both backends.

---

## Risks and Mitigations

- Native extensions (C/C++/Fortran)
  - Risk: import fails in WASM environments.
  - Mitigation: document pure‑Python only; defer native stacks; consider stubs where feasible.

- Artifact size and startup time
  - Risk: slow CI and large caches (both backends).
  - Mitigation: keep examples minimal; strip where safe; cache bundles per importer.

- WASI runtime variance
  - Risk: behavior differences across hosts.
  - Mitigation: standardize on one runner in CI; add feature probe in tests.

- Pyodide packaging and determinism
  - Risk: mapping `uv.lock` to Pyodide and keeping builds offline.
  - Mitigation: pin Pyodide versions/artifacts in Nix; pre‑index wheels/sdists where needed; explicit translation step (pure‑Python only); cache the assembled FS image.

- CPython/Pyodide evolution
  - Risk: upstream changes.
  - Mitigation: pin versions; add smoke tests to detect breakage early.

---

## Future Work

- Bundle slimming (symbol stripping, FS pruning), reproducible cache hints per importer.
- Unify shared headless browser harness across languages.
- Optional dev ergonomics: helpers to preview the browser bundle locally.

---

## Conclusion

Provide a pair of Python/WASM templates with `backend={wasi|pyodide}`:

- Deliver WASI first to establish a deterministic baseline that reuses our lockfile, provider, and patching model.
- Add Pyodide to unlock browser execution, keeping labels/providers/patches unchanged while pinning artifacts to preserve determinism.

---

## Development Plan — PR Sequence

### PR‑1: WASI baseline (templates + planner + macros + tests + docs)

#### Description

Deliver a fully usable WASI path for Python/WASM: templates, planner wiring, macros, tests, and minimal docs in one change.

#### Scope & Changes

- `build-tools/tools/nix/templates/python/wasm.nix`:
  - `pyWasmApp { name, lockfile, subdir, groups, backend ? "wasi" }`
  - `pyWasmLib { name, lockfile, subdir, groups, backend ? "wasi" }`
  - Build app wrapper and lib site/overlay from `uv.lock`; apply `patches/python/*.patch` deterministically.
- `build-tools/tools/nix/planner/python.nix`:
  - Add `mkWasmApp` and `mkWasmLib` routing to WASI templates when selected.
- `build-tools/python/defs.bzl`:
  - `nix_python_wasm_app(name, lockfile_label, backend="wasi")`
  - `nix_python_wasm_lib(name, lockfile_label, backend="wasi")`
- Tests (zx):
  - `python.wasm.wasi.build-and-run.test.ts`
  - `python.wasm.wasi.patch-affects-execution.test.ts`
  - `python.wasm.wasi.lib-consumed-by-app.test.ts`
- Docs:
  - Add a short WASI usage note (pure‑Python constraint, runner invocation).

#### Acceptance Criteria

- Deterministic WASI builds (app/lib) for a simple pure‑Python importer.
- Tests pass locally and in CI; re‑runs are idempotent.
- Docs render with a minimal runnable example.

#### Risks

- WASI runner variance across platforms; standardize a single runner in CI.

#### Consequence of Not Implementing

- No usable WASI baseline; browser work would land without a server/CLI reference path.

#### Downsides for Implementing

- Slight increase in template surface; balanced by integrated tests/docs.

#### Recommendation

Implement.

### PR‑2: Pyodide baseline (pinning + templates + harness + tests + docs)

#### Description

Deliver a complete browser path via Pyodide in a single change: pinned artifacts, templates, headless harness, tests, and docs.

#### Scope & Changes

- Nix pinning for Pyodide runtime and base artifacts.
- `build-tools/tools/nix/templates/python/wasm.nix`:
  - Implement `backend="pyodide"` for `pyWasmApp` and `pyWasmLib`, assembling `{ .wasm, loader JS, FS }` and lib FS overlays; apply patches deterministically.
- Headless browser harness for CI.
- Tests (zx):
  - `python.wasm.pyodide.browser-run.test.ts`
  - `python.wasm.pyodide.patch-affects-execution.test.ts`
  - `python.wasm.pyodide.lib-consumed-by-app.test.ts`
- Docs:
  - Add browser usage guide (pinning, harness invocation, pure‑Python note).

#### Acceptance Criteria

- Deterministic Pyodide bundles; tests verify run + patch effects + lib consumption.
- Re‑runs are idempotent; docs provide a runnable example.

#### Risks

- Browser automation flakiness; mitigate with stable harness/timeouts.
- Mapping `uv.lock` → Pyodide FS; mitigate via index/translation step.

#### Consequence of Not Implementing

- No browser runtime for Python/WASM.

#### Downsides for Implementing

- Higher integration complexity in a single PR; offset by tighter review scope.

#### Recommendation

Implement.

### PR‑3: Scaffolding for Python WASM (app + lib) with verification and docs

#### Description

Add optional scaffolding flags for WASI/Pyodide and verify scaffolded projects build and run; include documentation changes.

#### Scope & Changes

- `build-tools/tools/scaffolding/templates/python/`:
  - WASM app/lib TARGETS using `nix_python_wasm_app/lib` with `lockfile_label`.
- Tests (zx):
  - Scaffold → build (WASI) → run; scaffold → build (Pyodide) → run (harness).
- Docs:
  - Scaffolding usage and example commands for both backends.

#### Acceptance Criteria

- `scaf` produces WASM‑ready Python apps/libs; tests verify build/run for both backends.
- Docs reflect scaffolding flags and flows.

#### Risks

- Low; templates and verification only.

#### Consequence of Not Implementing

- Harder onboarding for WASM Python.

#### Downsides for Implementing

- Additional template maintenance.

#### Recommendation

Implement.

### PR‑4: Bundle size and ergonomics improvements (with safeguards)

#### Description

Optimize bundle size and DX while preserving determinism; include tests that guard against regressions and docs on size tradeoffs.

#### Scope & Changes

- Size trimming (safe FS pruning, symbol/metadata trimming) gated by flags; cache overlays per importer deterministically.
- Tests (zx):
  - Assert key files remain; verify functional tests still pass after trimming.
- Docs:
  - Short section on optional size flags and their caveats.

#### Acceptance Criteria

- Smaller bundles with identical functional outcomes; no change to provider/labels.

#### Risks

- Over‑trimming; mitigated by tests and opt‑in flags.

#### Consequence of Not Implementing

- Larger CI artifacts and slower runtime.

#### Downsides for Implementing

- Additional maintenance for trimming rules.

#### Recommendation

Implement when beneficial.
