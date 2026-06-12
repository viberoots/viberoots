# Nix gaps migration plan

This plan migrates every artifact-producing macro that currently builds via Buck rules to a Nix-backed build path. Buck remains the orchestrator. Nix builds all production artifacts. The plan follows the project documentation methodology and defines scope, dependencies, phases, tasks, and acceptance checks.

## Scope

In scope:

- Replace all “Buck build” macro paths with Nix-backed builds.
- Replace all stub paths that are expected to produce build artifacts with Nix-backed builds.
- Ensure hermetic toolchains for Go, Python, and Node (non-bundled paths).
- Ensure all public Starlark macros produce their artifacts via Nix or via Nix-backed rules.
- Maintain an explicit exception list for intentional probe/test-only macros that do not produce production artifacts.

Out of scope:

- Changing public macro names.
- Changing the Buck graph exporter or planner interfaces except where required to route builds.
- Non-build tooling and scaffolding (unless needed to route Nix builds).

## Completion criteria

The migration is complete when:

- Every artifact-producing public macro in `docs/handbook/starlark-api.md` is Nix-backed.
- `docs/handbook/nix-gaps.md` lists no non-hermetic artifact build paths.
- Any remaining non-build macros are intentional probes and are explicitly documented as exceptions.
- Builds are hermetic outside the devshell (no reliance on system tool variants).
- CI builds and tests pass using Nix-backed build steps.
- The Buck graph remains the orchestrator of dependency edges and test impact.

## Current status

- Phases 0 through 6 are implemented in-repo, including parity and hermeticity checks.
- Exception policy is machine-checked for probe-only non-build macros.
- Artifact-route enforcement is machine-checked; `artifactRouteAllowlist` is currently empty.
- No mixed Node artifact route remains for public macros.
- Detailed follow-on implementation design for robust Node wasm staging/inline source resolution is
  documented in `build-tools/docs/lang/node-wasm-staging-contract-design.md`.

## Components and dependencies

Primary components:

- Starlark macros under `build-tools/*/defs*.bzl`.
- Nix planner and templates under `build-tools/tools/nix/`.
- Buck toolchains under `toolchains/`.
- Node/Python/Go adapter paths in `build-tools/tools/buck/` and Nix flake outputs.

Critical dependencies:

- Nix toolchain availability for Go, Python, Node, C++.
- Planner templates for all target kinds that are currently Buck-built.
- Exported Buck graph attributes needed by the planner for each target kind.

## Phase 0 — Baseline and inventory

Goal: Freeze the current state and define exact targets to migrate.

Tasks:

1. Inventory all macros and map to build paths.
   - Output: `docs/handbook/nix-gaps.md` is complete and accurate.
   - Success criteria: No public macro is missing from the map.

2. Collect baseline build and test signals.
   - Output: `docs/history/build-system/nix-gaps-baseline.md` with:
     - Example build commands
     - Build outputs and timing (best effort)
   - Success criteria: A baseline exists for comparison.

## Phase 1 — Nix toolchain hardening

Goal: Ensure Nix provides the toolchains used for all languages.

Tasks:

1. Define Nix toolchain packages for Go and Python (if not already defined).
   - Output: Nix flake outputs for toolchains (e.g., `.#toolchains.go`, `.#toolchains.python`).
   - Success criteria: Nix can build the toolchain derivations on all supported platforms.

2. Ensure Buck uses Nix toolchain artifacts for remaining non-Nix paths during migration.
   - Output: Temporary bridging that uses Nix-provided binaries until full migration completes.
   - Success criteria: Buck builds do not depend on host toolchains.

## Phase 2 — Go migration (Buck go\_\* → Nix builds)

Goal: Replace all Go Buck builds with Nix-backed builds.

Tasks:

1. Add Nix planner templates for Go library and binary targets (if missing).
   - Output: Nix templates that produce Go libraries and binaries from Buck graph.
   - Success criteria: Nix can build Go libs and bins for representative targets.

2. Replace `nix_go_library`, `nix_go_binary`, `nix_go_test` with Nix-backed rule shapes.
   - Output: Starlark macros that route to Nix-backed rules or Nix-calling actions.
   - Success criteria: No `go_*` Buck rules are used by these macros.

3. Replace `nix_go_carchive` stub with a Nix-backed build.
   - Output: Nix builds for Go C archives.
   - Success criteria: C/C++ consumers can link against the Nix-built archive.

## Phase 3 — Python migration (Buck python\_\* → Nix builds)

Goal: Replace all Python Buck builds with Nix-backed builds.

Tasks:

1. Add Nix planner templates for Python library, binary, and test targets.
   - Output: Nix templates for Python target kinds.
   - Success criteria: Nix can build and run Python tests for representative targets.

2. Replace `nix_python_library`, `nix_python_binary`, `nix_python_test` with Nix-backed builds.
   - Output: Starlark macros that route to Nix builds.
   - Success criteria: No `python_*` Buck rules are used by these macros.

3. Replace `nix_python_extension_module` and `nix_python_wasm_extension_module` stubs.
   - Output: Nix-built extension modules and wasm extension modules.
   - Success criteria: Python import and runtime loads work for representative modules.

4. Replace `nix_python_wasm_app` and `nix_python_wasm_lib` with Nix builds.
   - Output: Nix builds for wasm app and lib targets.
   - Success criteria: Generated wasm artifacts are used by downstream targets.

## Phase 4 — Node migration (artifact-producing non-Nix paths)

Goal: Replace remaining artifact-producing Node genrule builds with Nix-backed builds.

Tasks:

1. Classify Node macros by outcome: artifact-producing, orchestration wrapper, or probe-only.
   - Output: Classification table added to `docs/handbook/nix-gaps.md`.
   - Success criteria: Every Node public macro has one category with rationale.

2. Extend the Node planner templates to cover artifact-producing `nix_node_gen`, `nix_node_lib`, `nix_node_bin` paths.
   - Output: Nix-backed Node template paths for gen and lib/bin cases.
   - Success criteria: Existing targets build and produce the same outputs.

3. Replace `node_asset_stage` with a Nix-backed staging step when it produces consumed build artifacts.
   - Output: Nix-built staging output for assets.
   - Success criteria: Asset outputs match current structure and names.

4. Replace `node_wasm_inline_module` with a Nix-backed build.
   - Output: Nix-backed wasm inline module artifact.
   - Success criteria: Generated JS module is identical to current output.

## Phase 5 — C++ and Rust residual migration plus exception policy

Goal: Migrate remaining artifact-producing C++/Rust gaps and formalize intentional exceptions.

Tasks:

1. Replace `nix_cpp_headers` and `nix_cpp_wasm_emscripten_lib` stubs with Nix-backed builds.
   - Output: Nix-built header package and Emscripten outputs.
   - Success criteria: Consumers can build against those outputs.

2. Replace Rust stub genrules with Nix builds when the macro contract is artifact-producing.
   - Output: Nix-built Rust library and binary targets.
   - Success criteria: Rust targets build and produce expected artifacts.

3. Define and enforce an exception policy for probe/test-only macros (for example `cpp_sanitize_probe`).
   - Output: Documented exception list in `docs/handbook/nix-gaps.md` plus machine-checked source of truth in `docs/handbook/nix-gaps-exceptions.json` with rationale per macro.
   - Success criteria: Every non-build macro is intentional, documented, and reviewed.

## Phase 6 — Validation and parity

Goal: Ensure behavior parity and hermeticity.

Tasks:

1. Cross-validate outputs for representative targets per language.
   - Output: Build parity checks for Node/C++/Rust (file hash for Node output, runtime stdout contracts for C++/Rust).
   - Success criteria: Nix-built outputs match expected outputs.

2. Ensure builds are hermetic outside devshell.
   - Output: CI checks selected builds in a minimal environment with host toolchain variables poisoned.
   - Success criteria: Representative Node/C++/Rust selected builds succeed without host toolchain leakage.

3. Update docs to reflect Nix-backed artifact builds with explicit probe exceptions.
   - Output: `docs/history/build-system/nix-gaps-baseline.md`, `build-tools/docs/build-system-design.md`, and `docs/handbook/starlark-api.md` are aligned with parity signals and expected deltas.
   - Success criteria: Documentation distinguishes artifact builds from probe/test-only exceptions.

## Phase 7 — Cleanup and enforcement

Goal: Remove old artifact build paths and enforce Nix-backed artifact production.

Tasks:

1. Remove or guard legacy Buck build paths.
   - Output: Starlark macros with no fallback to Buck build rules.
   - Success criteria: Code search shows no direct `go_*` or `python_*` usage in macros.

2. Add enforcement checks.
   - Output: CI checks that fail when public artifact-producing macros use non-hermetic Buck build paths.
   - Success criteria: Any regression is caught before merge.

## Systematic checkpoints

At the end of each remaining phase:

- Validate that artifact-producing macros in `docs/handbook/nix-gaps.md` moved to “Nix build”.
- Validate that any non-build macros are explicitly listed as intentional exceptions.
- Run representative builds for Go, Python, Node, C++, Rust.
- Confirm no host toolchain leakage by building in a minimal environment.

## Risks and mitigations

- Risk: Nix templates lack enough metadata to build certain targets.
  - Mitigation: Extend export-graph attributes per target kind before migration.
- Risk: Output parity differences.
  - Mitigation: Establish explicit parity tests and allow explicit, documented differences where justified.
- Risk: Migration breaks developer workflows.
  - Mitigation: Provide clear fallback steps during the migration and update onboarding docs.

## Definition of done

This plan is done when:

- `docs/handbook/nix-gaps.md` has no non-hermetic artifact build paths for public macros.
- All production build outputs are produced via Nix.
- Any remaining non-build public macros are intentional probes with documented rationale.
- CI is green with Nix-backed artifact builds and exception-policy enforcement.
