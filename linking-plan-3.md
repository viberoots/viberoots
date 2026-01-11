# Linking Plan - Phase 2 (Wasm linking semantics: TinyGo + C++ Wasm static libs)

This document is a development plan to implement **Phase 2** from `linking-roadmap.md`.

I am keeping the plan as a list of PRs. Each PR includes its own tests and documentation updates. I am not planning any tests-only or docs-only PRs. No functionality should land without tests in the same PR.

## Prerequisites (must already be true from Phase 0 and Phase 1)

Phase 2 assumes the shared and C++ primitives are already available and verified:

- deterministic union at the macro layer (`deps := deps ∪ link_deps ∪ header_deps`) and override validation
- planner-level deterministic link closure resolver exists (`link_closure = direct|transitive`, optional per-dep overrides)
- exporter surface includes the intent attributes (`link_deps`, `header_deps`, `link_closure`, `link_closure_overrides`)
- `nix_cpp_headers` exists and the planner can materialize `kind:headers` via `T.cppHeaders` (used for Wasm header deps)
- `T.cppWasmStaticLib` exists (template contract for C++ Wasm static libs)

If any of these are missing, I should address the missing Phase 0/1 item first rather than trying to patch around it inside Phase 2.

---

## PR-1: Add Wasm link intent attrs to `nix_cpp_wasm_static_lib` and wire `header_deps` into `T.cppWasmStaticLib`

### Description

Phase 2 treats `nix_cpp_wasm_static_lib` as the Wasm-producer analogue of `nix_cpp_library`.

That requires two things:

- the producer must carry explicit intent metadata (`link_deps`, `header_deps`) so downstream consumers can choose closure behavior
- the producer must be able to compile when it uses headers supplied by header-only targets (via `header_deps`)

This PR focuses only on the C++ Wasm static library producer side. It does not change TinyGo behavior yet.

### Scope & Changes

- Extend `cpp/defs.bzl` `nix_cpp_wasm_static_lib`:
  - accept `link_deps` and `header_deps` (default `[]`)
  - compute `deps := deps ∪ link_deps ∪ header_deps` via the shared helper (same macro contract as native C++)
  - preserve the intent attrs on the rule so they appear in the exported graph node
- Extend `tools/nix/planner/cpp.nix` Wasm-lib construction:
  - when planning a `wasm:static` C++ lib, resolve its `header_deps` to `T.cppHeaders` derivations
  - pass include roots to `T.cppWasmStaticLib` via its `includes` input
  - keep ordering deterministic:
    - preserve the macro-provided `header_deps` order
    - dedupe while preserving first-seen order
- Update label and target selection notes:
  - keep using existing variant stamping (`kind:wasm`, `wasm:static`) from `prepare_package_local_wasm_wiring`
  - keep `wasm:wasi` as an explicit label used to select `wasmTarget = wasm32-wasi` (this already exists in `tools/nix/planner/cpp.nix`)

### Tests (in this PR)

Add zx tests (one test per file):

- `tools/tests/cpp/cpp.wasm-static-lib.accepts.link-intent-attrs.exported-by-graph.test.ts`
  - temp repo defines `nix_cpp_wasm_static_lib` with `link_deps` and `header_deps`
  - runs `tools/buck/export-graph.ts`
  - asserts `tools/buck/graph.json` includes `link_deps` and `header_deps` on the node
- `tools/tests/cpp/cpp.wasm-static-lib.header-deps.compile-uses-cpp-headers.builds.test.ts`
  - temp repo defines:
    - a `nix_cpp_headers` target exporting a header with a constant or inline function
    - a `nix_cpp_wasm_static_lib` target that includes that header via `header_deps`
  - builds the Wasm static lib via the planner and asserts it succeeds

### Docs (in this PR)

- Update `wasm-linking.md`:
  - document `nix_cpp_wasm_static_lib` as the canonical Wasm static library producer
  - document `link_deps`/`header_deps` on the producer and what they mean (including that `link_deps` is consumed by downstream closure, not by the archive build itself)
  - document the compile-time include contract for `header_deps` (planner passes `T.cppHeaders` include roots into `T.cppWasmStaticLib`)

### Acceptance Criteria

- `nix_cpp_wasm_static_lib` accepts `link_deps` and `header_deps` and merges them into `deps` deterministically.
- `link_deps` and `header_deps` are present in `tools/buck/graph.json` for a target that sets them.
- A Wasm static library can compile while including headers from a header-only target referenced via `header_deps`.

### Risks

Medium. This touches a widely used macro surface. The tests must cover the exported-graph contract and a real compile that depends on `header_deps`.

### Consequence of Not Implementing

Downstream Wasm consumers cannot rely on a stable, explicit producer contract, and transitive closure would have to infer behavior from `deps`.

### Downsides for Implementing

Slightly larger macro surface. The benefit is an explicit contract and less inference in later planner logic.

### Recommendation

Implement.

---

## PR-5: Scaffolding templates for Phase 2 Wasm linking (demo app)

### Description

Phase 2 adds new user-facing capabilities that should be easy to adopt correctly:

- Wasm linking semantics for TinyGo consumers + C++ Wasm static lib producers (`link_deps`, `header_deps`, `link_closure`).

This PR adds **scaffolding templates** that encode the “happy path” layouts and labels so users do not have to rediscover the conventions by reading tests.

This PR is intentionally about templates + `scaf` wiring + tests. It should not introduce any new planner or macro semantics beyond what was implemented in PR-1..PR-4.

### Scope & Changes

- Add a new `scaf` template: **`ts wasm-linking-app`** (name bikeshed OK) that generates a minimal repo layout demonstrating Phase 2:
  - A C++ Wasm static lib producer using `nix_cpp_wasm_static_lib` with `header_deps` and `link_deps`.
  - A TinyGo Wasm consumer using `nix_go_tiny_wasm_lib` with `link_deps` and `link_closure`.
  - A small TS/Node webapp that loads the built Wasm and asserts a simple function result (kept minimal; test should validate correctness).
  - The template must use importer-scoped `lockfile:` labels correctly for any Node app it creates.

Note: Python native extension scaffolding belongs to **Phase 3** and should be tracked in the Phase 3 plan alongside the implementation in `python-extension-design.md`.

### Tests (in this PR)

Add zx tests (one test per file):

- `tools/tests/scaffolding/scaf-new.ts.wasm-linking-app.scaffold-and-build.test.ts`
  - runs `scaf new ts wasm-linking-app <name>`
  - asserts key files exist and the target labels are correct
  - builds the resulting app (or a subset target) and asserts the Wasm module can be loaded and returns the expected value

### Docs (in this PR)

- Update `wasm-linking.md`:
  - add a short “Scaffolding” section that points users to the Phase 2 demo template and explains what it demonstrates.

### Acceptance Criteria

- A developer can scaffold a Phase 2 Wasm linking demo app using `scaf` and build/run it successfully without hand-editing.
- Templates are deterministic and tested.

### Risks

Low. Primary risk is template drift (templates not updated as macro surfaces evolve). Tests should be explicit about the contracts to keep drift visible.

### Recommendation

Implement.

---

## PR-2: Add Wasm link intent attrs to `nix_go_tiny_wasm_lib` and route builds through the planner-selected path (not the minimal selected-wasm fallback)

### Description

Today, TinyGo Wasm builds preferentially use `#graph-generator-selected-wasm`, which intentionally bypasses the exported graph and cannot incorporate repo link inputs (`wasmStaticLibs` is always empty).

Phase 2 needs the opposite:

- `nix_go_tiny_wasm_lib` must express link intent explicitly (`link_deps`, `link_closure`, optional overrides)
- the build path must use the exported graph so the planner can translate those intents into Nix inputs deterministically

This PR introduces the macro and rule surface needed for planners to observe TinyGo link intent and for Buck actions to build via the graph-aware selection path.

### Scope & Changes

- Extend `go/defs.bzl` `nix_go_tiny_wasm_lib`:
  - accept `link_deps` (default `[]`)
  - accept `link_closure` (default `"direct"`)
  - accept `link_closure_overrides` (default `{}` or `None`, consistent with Phase 0 conventions)
  - compute `deps := deps ∪ link_deps` deterministically (TinyGo does not meaningfully consume `header_deps` today; any header needs come from the C++ Wasm libs it links)
  - preserve the intent attrs on the rule so they appear in the exported graph
- Extend `go/private/nix_build_wasm.bzl` rule `go_nix_build_wasm`:
  - add attrs to carry intent into the graph:
    - `link_deps`, `link_closure`, `link_closure_overrides`
  - switch the default build to graph-aware selection:
    - prefer `tools/dev/build-selected.ts` (builds `#graph-generator-selected` which routes to `LANGS.go.mkTinyWasm`)
    - keep the minimal `#graph-generator-selected-wasm` as an explicit fallback only when a consumer opts in (or behind a clear environment flag), because it cannot support Wasm linking semantics
  - preserve existing behavior for `WEB_WASM_BACKEND` by passing it through unchanged (Phase 2 will use this consistently in the planner)

### Tests (in this PR)

Add zx tests (one test per file):

- `tools/tests/go/go.tinygo-wasm.link-intent-attrs.exported-by-graph.test.ts`
  - temp repo defines a `nix_go_tiny_wasm_lib` with `link_deps`, `link_closure`, and `link_closure_overrides`
  - runs `tools/buck/export-graph.ts`
  - asserts `tools/buck/graph.json` includes these fields on the node
- `tools/tests/go/go.tinygo-wasm.builds-via-graph-selected-path.smoke.test.ts`
  - temp repo defines a minimal `nix_go_tiny_wasm_lib`
  - runs a Buck build of the target
  - asserts the build path goes through `tools/dev/build-selected.ts` (for example by asserting a stable log prefix emitted by build-selected)

### Docs (in this PR)

- Update `wasm-linking.md`:
  - document the TinyGo macro intent attributes and defaults
  - document that Phase 2 requires TinyGo builds to be graph-aware (planner-selected), and clarify what the minimal selected-wasm path is for (tests and smoke scaffolds that do not link repo C/C++)

### Acceptance Criteria

- `nix_go_tiny_wasm_lib` can express `link_deps` and closure intent, and those attrs appear in the exported graph.
- Buck builds of TinyGo wasm targets use the planner-selected path that can consume exported graph semantics.
- Documentation reflects the new contract and the difference between graph-aware builds and the minimal selected-wasm builder.

### Risks

Medium. This changes the default build path for TinyGo Wasm targets. The smoke test should be explicit about behavior so failures are actionable.

### Consequence of Not Implementing

Even if planners are taught how to link C++ Wasm libs, TinyGo targets will continue using a path that cannot supply those inputs.

### Downsides for Implementing

Slightly slower builds in some cases because graph export becomes part of the path. The benefit is correctness and a single semantic model for linking.

### Recommendation

Implement.

---

## PR-3: Implement TinyGo Wasm linking semantics in the Go planner (direct + transitive closure) and enforce variant compatibility

### Description

This PR makes Phase 2 “work” in the sense defined by `linking-roadmap.md`:

- A TinyGo Wasm module links a C++ Wasm static lib via `link_deps`.
- Transitive closure follows the Wasm link graph (follow `link_deps` recursively) and fails deterministically on variant mismatch.

The implementation should follow the model described in `wasm-linking.md`:

- do not infer linking from `deps`
- follow the link graph via `link_deps`
- keep ordering deterministic
- fail fast with an actionable error message on incompatible variant

### Scope & Changes

- Extend `tools/nix/planner/go.nix` `mkTinyWasm`:
  - read `link_deps`, `link_closure`, and `link_closure_overrides` from the exported node
  - compute a resolved ordered unique list using the shared closure resolver (`tools/nix/planner/link-closure.nix`)
    - roots are the consumer’s `link_deps`
    - traversal follows `link_deps` on Wasm producer nodes
  - validate each resolved dep is a supported Wasm producer:
    - expected producer: C++ Wasm static lib (`lang:cpp`, `kind:wasm`, `wasm:static`)
    - fail with a targeted error naming the consumer label, the offending dep, and the expected stamps
  - determine the Wasm backend consistently for the build:
    - map `WEB_WASM_BACKEND=wasi_single` to TinyGo template `target = "wasi"`
    - otherwise default to `target = "wasm"`
  - enforce variant compatibility deterministically:
    - if TinyGo target is `wasi`, require each linked dep to be stamped with `wasm:wasi`
    - if TinyGo target is bare `wasm`, require each linked dep not to have `wasm:wasi`
    - fail with a targeted error message when mismatch is detected
  - instantiate `T.cppWasmStaticLib` for each resolved dep with a consistent `wasmTarget` matching the chosen backend
  - pass the derivations into `T.goTinyWasmLib` as `wasmStaticLibs` and pass the computed TinyGo `target`

### Tests (in this PR)

Add zx integration tests (one test per file). These should validate real symbol resolution so we know the C++ archive is actually linked.

- `tools/tests/wasm/wasm.tinygo.links-cpp-wasm-static-lib.via-link-deps.build-and-load.test.ts`
  - temp repo defines:
    - `nix_cpp_wasm_static_lib` exporting `int add(int,int)` from a C unit, plus a header
    - `nix_go_tiny_wasm_lib` that:
      - sets `link_deps = ["//...:core_wasm"]`
      - uses TinyGo cgo (`import "C"`) and calls `C.add(2,3)`
      - exports a Wasm function that returns the result
  - builds the wasm target via the normal Buck rule path
  - loads it in Node (WebAssembly instantiate) and asserts the exported function returns 5
- `tools/tests/wasm/wasm.tinygo.transitive-closure.follows-link-deps.builds.test.ts`
  - temp repo defines a chain:
    - `//libs/support:support_wasm` exporting `int inc(int)`
    - `//libs/core:core_wasm` exporting `int add2(int)` and referencing `inc` and declaring `link_deps=["//libs/support:support_wasm"]`
    - `//libs/api:wasm` tinygo module with `link_deps=["//libs/core:core_wasm"]` and `link_closure="transitive"`, calling `C.add2(3)` and exporting the result
  - asserts the build succeeds and the result is correct
- `tools/tests/wasm/wasm.variant-mismatch.wasi-vs-bare.fails-fast.test.ts`
  - temp repo defines a mismatch case, for example:
    - TinyGo build is selected as WASI (`WEB_WASM_BACKEND=wasi_single`)
    - a linked C++ Wasm static lib lacks `wasm:wasi` (or the opposite mismatch)
  - asserts the build fails with a targeted error message that names the mismatched dep and the required variant

### Docs (in this PR)

- Update `wasm-linking.md`:
  - document the TinyGo consumer algorithm as implemented (direct and transitive)
  - document the variant compatibility rule and the error shape
  - document that Phase 2 follows `link_deps` for closure, not general `deps`

### Acceptance Criteria

- A TinyGo Wasm module can link an in-repo C++ Wasm static lib via `link_deps`, and the resulting module proves the archive was linked by calling into it.
- `link_closure="transitive"` follows `link_deps` recursively and succeeds on a transitive link requirement.
- Variant mismatch fails deterministically with an actionable error message.

### Risks

Medium. TinyGo + cgo + wasm linking has multiple moving parts. The tests must validate real symbol resolution so failures are not silent.

### Consequence of Not Implementing

Wasm linking semantics remain implicit and inconsistent. Users cannot rely on explicit `link_deps` and cannot use transitive closure safely.

### Downsides for Implementing

Planner logic becomes more complex, but it stays concentrated in `tools/nix/planner/go.nix` and the shared closure helper.

### Recommendation

Implement.

---

## PR-4: Hardening for Phase 2 invariants (determinism, invalidation, and targeted errors)

### Description

After Phase 2 “works”, I want to lock down the invariants that keep the system stable:

- deterministic ordering of linked Wasm inputs
- accurate invalidation when repo C++ Wasm libs change (including patch changes)
- targeted error messages for unsupported `link_deps` entries and closure misuse

This PR should stay narrowly scoped to Phase 2 behavior.

### Scope & Changes

- Determinism hardening:
  - ensure the resolved closure list is stable and unique
  - ensure the list of `wasmStaticLibs` passed into TinyGo is stable and in the same order as the resolved closure
- Invalidation hardening:
  - ensure changes to a C++ Wasm producer’s patches invalidate a TinyGo Wasm consumer that links it
  - ensure the invalidation edge is visible in the graph surface used by the planner (avoid hidden dependencies)
- Targeted failure messages:
  - when `link_deps` includes a non-Wasm producer, fail with a message that includes:
    - consumer label
    - offending dep label
    - expected labels (for example `lang:cpp`, `kind:wasm`, `wasm:static`)
  - when an override key is invalid, ensure the macro-level validation remains the first failure (no planner-only error)

### Tests (in this PR)

Add zx tests (one test per file):

- `tools/tests/wasm/wasm.link-input-ordering.deterministic.test.ts`
  - temp repo with multiple `link_deps` and a fixed expected resolved order
  - runs multiple builds and asserts the resolved list is stable (for example by reading a build log field emitted by templates)
- `tools/tests/wasm/wasm.link-deps.patch-invalidation.rebuilds-consumer.test.ts`
  - temp repo:
    - TinyGo wasm links a C++ Wasm static lib
    - modify a `.patch` file under the producer’s patch surface
  - asserts the consumer rebuilds (using existing invalidation harness patterns)
- `tools/tests/wasm/wasm.link-deps.unsupported-target.fails-fast.test.ts`
  - temp repo places a non-C++ Wasm target in `link_deps`
  - asserts the error message is targeted and names expected stamps

### Docs (in this PR)

- Update `wasm-linking.md`:
  - document determinism rules for Phase 2 ordering
  - document the invalidation contract at a high level (what changes are guaranteed to rebuild consumers)
  - add a short “common failures” section covering:
    - unsupported dep in `link_deps`
    - variant mismatch

### Acceptance Criteria

- Link input ordering is deterministic and locked by tests.
- Patch invalidation is accurate for Phase 2 (`link_deps` path).
- Misuse fails fast with actionable error messages.
- Documentation matches the tested behavior.

### Risks

Low to medium. This is mostly hardening, but it can expose hidden nondeterminism or missing invalidation edges.

### Consequence of Not Implementing

Phase 2 may work on a happy path but remain fragile. Small changes could introduce nondeterminism or hidden dependency edges without tests catching it.

### Downsides for Implementing

Adds more integration tests. The benefit is stable semantics as Phase 3 (Python extension modules) is implemented.

### Recommendation

Implement.
