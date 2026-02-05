# Linking Plan - Phase 1 (C++ native linking core)

This document is a development plan to implement **Phase 1** from `build-tools/docs/linking-roadmap.md`.

I am keeping the plan as a list of PRs. Each PR includes its own tests and documentation updates. I am not planning any tests-only or docs-only PRs.

## Prerequisites (must already be true from Phase 0)

Phase 1 assumes the Phase 0 primitives are already available and verified:

- deterministic union at the macro layer (`deps := deps ∪ link_deps ∪ header_deps`) and override validation
- planner-level deterministic link closure resolver exists (even if Phase 1 only uses direct mode)
- exporter surface includes the intent attributes (`link_deps`, `header_deps`, `link_closure`, `link_closure_overrides`)

If any of these are missing, I should address the missing Phase 0 item first rather than trying to patch around it inside Phase 1.

---

## PR-1: Add `nix_cpp_headers` and a `T.cppHeaders` template for header-only deps

### Description

Phase 1 requires header-only deps as a first-class concept. I want a dedicated target type for include-only dependencies that does not pretend to be a library.

This PR adds:

- a Starlark macro surface (`nix_cpp_headers`)
- a planner-visible kind (`kind:headers`)
- a Nix template (`T.cppHeaders`) that produces a derivation with an include tree and no linkable library output

This PR is intentionally **producer-only**. It does not wire `header_deps` into C++ consumer macros or planner consumption yet. That intent surface is addressed in PR-2/PR-3 as part of the shared link-intent contract.

### Scope & Changes

- Add `nix_cpp_headers` to `build-tools/cpp/defs.bzl`:
  - stamps `lang:cpp` and `kind:headers`
  - uses the same package-local wiring conventions as other C++ macros
  - keeps behavior minimal and deterministic, consistent with existing macro design
- Extend Nix templates:
  - add `build-tools/tools/nix/templates/cpp-headers.nix` implementing `cppHeaders`
  - export it from `build-tools/tools/nix/templates/cpp.nix` as `T.cppHeaders`
- Extend the C++ planner:
  - update `build-tools/tools/nix/planner/cpp.nix` `kindOf` to recognize `kind:headers`
  - add a constructor (illustrative name): `mkHeaders = name: T.cppHeaders { ... }`
  - ensure the language plugin dispatch can produce a derivation for `kind:headers` targets
- Update language manifest:
  - add `"headers"` to the C++ kinds list in `build-tools/tools/nix/langs.json`
  - ensure the “required paths” list still covers all template files required for C++ planning

### Tests (in this PR)

Add zx tests under `build-tools/tools/tests/cpp/` (one test per file):

- `build-tools/tools/tests/cpp/cpp.headers.kind-and-template.builds.test.ts`
  - creates a temp repo containing a `nix_cpp_headers` target and a minimal include tree
  - generates `build-tools/tools/buck/graph.json`
  - runs the Nix graph generator build for the header target and asserts it succeeds
- `build-tools/tools/tests/cpp/cpp.headers.consumed-via-template-input.compiles.test.ts`
  - creates a temp repo with:
    - a header-only target exporting a header with an inline constant or inline function
    - a C++ binary that includes that header
  - builds the binary using the template contract directly (consumer receives `T.cppHeaders` output as an include input)
  - this proves the `T.cppHeaders` artifact shape is usable by consumers without requiring the `header_deps` intent wiring yet

### Docs (in this PR)

- Update `build-tools/docs/cpp-linking.md`:
  - document `nix_cpp_headers` as the canonical header-only macro surface
  - document the planner-visible kind (`kind:headers`) and the template (`T.cppHeaders`) artifact shape

### Acceptance Criteria

- `nix_cpp_headers` exists and produces a planner-visible node with `lang:cpp` and `kind:headers`.
- The planner can build a `kind:headers` target via `T.cppHeaders`.
- A C++ consumer can compile while using headers from a header-only target (via the `T.cppHeaders` template contract).
- The documentation describes the header-only target contract in one place (`build-tools/docs/cpp-linking.md`).

### Risks

Low. This is additive and should not change existing C++ build behavior.

### Consequence of Not Implementing

Header-only deps will keep being encoded as “fake libraries” or ad hoc patterns, which will drift and create accidental link edges.

### Downsides for Implementing

Adds a new kind and template, which needs basic maintenance, but it avoids repeated workarounds elsewhere.

### Recommendation

Implement.

---

## PR-2: Add C++ macro intent attrs (`link_deps`, `header_deps`, `link_closure`) with deterministic deps union

### Description

Phase 1 needs a stable, explicit call-site surface for “link intent” without changing default behavior. This PR adds the new attributes to the C++ macro surfaces and ensures the macro-layer contract holds:

- `deps := deps ∪ link_deps ∪ header_deps` as a deterministic union
- planner-visible nodes carry the intent attrs so planners can consume them

This PR is macro-only. It does not attempt to make the planner actually link in-repo C++ libraries yet.

### Scope & Changes

- Extend public macros in `build-tools/cpp/defs.bzl`:
  - `nix_cpp_library`
  - `nix_cpp_binary`
  - `nix_cpp_node_addon`
  - `nix_cpp_test` (both the planner-visible stub and the executed runner wiring)
  - `nix_cpp_headers` (added in PR-1)
- Add and forward new attrs:
  - `link_deps` (default `[]`)
  - `header_deps` (default `[]`)
  - `link_closure` (default `"direct"`)
  - keep `link_kind` out of Phase 1 behavior. If the attribute exists, it should be accepted but remain effectively static-only.
- Use the shared Starlark helper surface from Phase 0:
  - use the shared deterministic union helper rather than duplicating list merge logic
  - keep the “single deps merge point” convention already used in `_cpp_common`
- Ensure exported graph nodes preserve the intent attrs:
  - no new exporter work is expected in Phase 1 if Phase 0 is complete
  - the PR must include a test that proves the attrs are present in the graph output for C++ targets

### Tests (in this PR)

Add zx tests under `build-tools/tools/tests/cpp/` (one test per file):

- `build-tools/tools/tests/cpp/cpp.macros.link-intent.deps-union.deterministic.cquery.test.ts`
  - creates a temp repo with a C++ target where `deps`, `link_deps`, and `header_deps` overlap
  - asserts cquery sees `deps` as the deterministic union
- `build-tools/tools/tests/cpp/cpp.macros.link-intent.attrs.exported-by-graph.test.ts`
  - creates a temp repo with representative targets (bin, lib, test, addon, headers)
  - sets `link_deps`, `header_deps`, and `link_closure`
  - runs `node build-tools/tools/buck/export-graph.ts`
  - asserts `build-tools/tools/buck/graph.json` includes the new fields on those nodes
- `build-tools/tools/tests/cpp/cpp.macros.link-intent.defaults.no-behavior-change.builds.test.ts`
  - asserts an existing minimal C++ scaffold still builds when no intent attrs are provided

### Docs (in this PR)

- Update `build-tools/docs/cpp-linking.md`:
  - document the macro attributes and their defaults
  - document the deterministic union rule as an explicit macro contract for C++
  - document that Phase 1 only implements `link_closure="direct"`

### Acceptance Criteria

- All C++ macro surfaces accept the new attrs and produce deterministic `deps` edges.
- The new attrs are present in the exported graph for targets that set them.
- Existing C++ targets that do not use the attrs build with unchanged behavior.
- Documentation reflects the macro contract and Phase 1 limitations.

### Risks

Medium. This touches macro call sites used widely. The tests must cover multiple target kinds to prevent drift.

### Consequence of Not Implementing

Planner work will require ad hoc target attributes, and we will not have stable conventions across C++ bin/lib/addon/test.

### Downsides for Implementing

Slightly larger macro surfaces, but it centralizes policy in one place and avoids repeated label lists at call sites.

### Recommendation

Implement.

---

## PR-3: Extend the C++ planner to materialize in-repo `T.cppLib` and `T.cppHeaders` inputs for direct linking

### Description

This PR makes Phase 1 actually work for consumers:

- C++ bin links an in-repo C++ library via `link_deps`
- Node addon links an in-repo C++ library via `link_deps`
- Consumers can compile with header-only deps via `header_deps`

The behavior is direct-only, static-only, and deterministic.

### Scope & Changes

- Extend `build-tools/tools/nix/planner/cpp.nix` to consume the intent attrs for C++ consumer nodes:
  - read `link_deps` and `header_deps` from the exported graph node
  - for each in-repo C++ library in `link_deps`, build a `T.cppLib { ... }` derivation
  - for each header-only target in `header_deps`, build a `T.cppHeaders { ... }` derivation
  - keep resolution conservative:
    - Phase 1: use direct deps only, no transitive expansion
    - only follow the link graph (do not treat general `deps` as link intent)
- Wire the resolved derivations into the consumer templates:
  - update `mkApp`, `mkAddon`, and `mkTest` to pass repo C++ inputs through the template inputs (`nixCxxPkgs` today)
  - ensure the templates treat those derivations as include and link inputs in a stable order
- Keep ordering deterministic:
  - normalize labels before lookup
  - preserve a stable order based on the macro-provided list order, unless there is a stronger existing ordering convention in the planner library

### Tests (in this PR)

Add zx tests under `build-tools/tools/tests/cpp/` (one test per file):

- `build-tools/tools/tests/cpp/cpp.bin.links-repo-lib.via-link-deps.build-and-run.test.ts`
  - temp repo with:
    - `//projects/libs/greeter:greeter` as `nix_cpp_library`
    - `//projects/apps/demo:demo` as `nix_cpp_binary(link_deps=[...])`
  - builds the binary and runs it to prove the link is real
- `build-tools/tools/tests/cpp/cpp.addon.links-repo-lib.via-link-deps.build-and-load.test.ts`
  - temp repo with:
    - a small C++ library exporting one symbol
    - a Node-API addon that calls into that library
  - builds the addon and runs a minimal Node script that requires the addon and calls the function
- `build-tools/tools/tests/cpp/cpp.test.links-repo-lib.via-link-deps.buck2-test.test.ts`
  - temp repo with:
    - a `nix_cpp_test` whose compiled sources require symbols from an in-repo lib specified via `link_deps`
  - runs `buck2 test` and asserts it passes
- `build-tools/tools/tests/cpp/cpp.header-deps.uses-cpp-headers.compiles.test.ts`
  - temp repo with:
    - a `nix_cpp_headers` target providing a header
    - a consumer that includes it via `header_deps`
  - builds the consumer and asserts it compiles

### Docs (in this PR)

- Update `build-tools/docs/cpp-linking.md`:
  - document the planner behavior for Phase 1:
    - `link_deps` materialize `T.cppLib` inputs
    - `header_deps` materialize `T.cppHeaders` inputs
    - direct-only closure
  - document the template contract at a high level:
    - consumer templates receive repo-provided C++ package inputs and link them deterministically

### Acceptance Criteria

- A C++ binary links an in-repo C++ library via `link_deps` and can be executed.
- A Node addon links an in-repo C++ library via `link_deps` and can be loaded by Node.
- A consumer can compile with header-only deps via `header_deps`.
- The planner changes are deterministic and do not rely on inference outside intent attrs.

### Risks

Medium. This is the first time in-repo C++ libs become first-class link inputs for C++ consumers, so ordering and template wiring must be correct.

### Consequence of Not Implementing

The Phase 1 API exists but does not do anything for C++ consumers, which will create confusion and stall adoption.

### Downsides for Implementing

Adds some planner complexity. The benefit is that it centralizes cross-target linking behavior in one place (the planner), rather than distributing it across call sites.

### Recommendation

Implement.

---

## PR-4: Planner and template hardening for Phase 1 invariants (determinism, patch invalidation, and error messages)

### Description

After Phase 1 “works”, I want to lock down the invariants that keep the system stable over time:

- deterministic ordering of resolved repo link inputs
- patch invalidation remains accurate (no hidden dependencies)
- failures are targeted and actionable when intent attrs are misused

This PR should stay narrowly scoped to Phase 1 behavior. It should not introduce Phase 2 transitive closure.

### Scope & Changes

- Determinism hardening:
  - ensure the planner produces a stable, unique list of repo link inputs for consumers
  - ensure templates iterate libraries deterministically when producing linker flags (and do not rely on filesystem traversal order)
- Patch invalidation hardening:
  - verify that a patch change in a repo library used via `link_deps` causes the consumer to rebuild
  - if needed, adjust how patch inputs are represented so the graph edge surface is explicit and monotonic
- Targeted failure messages:
  - if a `link_deps` entry does not resolve to a supported C++ producer shape for Phase 1, fail with a targeted error that names the offending label and expected kinds

### Tests (in this PR)

Add zx tests under `build-tools/tools/tests/cpp/` (one test per file):

- `build-tools/tools/tests/cpp/cpp.link-deps.patch-invalidation.rebuilds-consumer.test.ts`
  - temp repo:
    - binary depends on repo lib via `link_deps`
    - edit a patch file under the repo lib’s patch surface
  - assert a rebuild occurs for the consumer (using existing test harness patterns for invalidation checks)
- `build-tools/tools/tests/cpp/cpp.link-input-ordering.deterministic.test.ts`
  - temp repo with multiple link deps and a fixed expected ordering
  - asserts the resolved list is stable across repeated builds (or across repeated graph generation + build steps)
- `build-tools/tools/tests/cpp/cpp.link-deps.unsupported-target.fails-fast.test.ts`
  - temp repo where a non-C++ target is placed in `link_deps`
  - asserts a targeted error message (not a generic Nix evaluation failure)

### Docs (in this PR)

- Update `build-tools/docs/cpp-linking.md`:
  - document Phase 1 determinism rules for link input ordering
  - document the patch invalidation contract at a high level (what is guaranteed)
  - document common failure modes and the intended errors

### Acceptance Criteria

- Link input ordering is deterministic and locked by tests.
- Patch invalidation is accurate for the Phase 1 `link_deps` path.
- Misuse fails fast with an actionable error message.
- Documentation matches the tested behavior.

### Risks

Low to medium. This is mostly hardening, but it can expose latent nondeterminism in templates or planner helper code.

### Consequence of Not Implementing

Phase 1 may work on a happy path but remain fragile. Small changes could introduce nondeterminism or hidden dependency edges without tests catching it.

### Downsides for Implementing

Adds more integration tests, but these tests become the safety rails that keep linking behavior stable as Phase 2 and Phase 3 are implemented.

### Recommendation

Implement.
