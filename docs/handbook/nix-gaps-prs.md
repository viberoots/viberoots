# Nix Gaps PR Plan

This plan implements `docs/handbook/nix-gaps-plan.md` using a list of PRs.
Each PR includes code, tests, and documentation updates together.

Non-goals: no standalone docs-only or tests-only PRs.

Status checkpoint:

- PR-1 through PR-26 are implemented in-repo.
- Remaining work is no longer migration routing; it is maintenance and hardening of policy/docs parity.
- PRs in this document remain aligned to `docs/handbook/nix-gaps-plan.md` framing:
  - Focus on artifact-producing non-Nix paths.
  - Keep intentional probe/test-only exceptions explicit and enforced.

Verification snapshot for PR-1 through PR-11 (repo evidence):

- PR-1: inventory checker exists at `build-tools/tools/dev/nix-gaps-inventory-check.ts` and test at
  `build-tools/tools/tests/dev/nix-gaps-inventory-check.test.ts` (`7239ad5`).
- PR-2: baseline generator exists at `build-tools/tools/dev/nix-gaps-baseline.ts`, baseline test at
  `build-tools/tools/tests/dev/nix-gaps-baseline.test.ts`, baseline artifact at
  `docs/handbook/nix-gaps-baseline.md` (`336f513`).
- PR-3/PR-4: toolchain outputs and host-path guard tests exist, including
  `build-tools/tools/tests/dev/toolchains.nix-build.go-python.test.ts` and
  `build-tools/tools/tests/dev/toolchains.host-path.fails-fast.test.ts` (`dd42aa1` plus follow-up
  toolchain path wiring commits).
- PR-5: Go planner template routing landed (`6f2b255`).
- PR-6: Go macro build/test routing via Nix landed (`e60d0b9`).
- PR-7: Go carchive Nix build and tests landed (`c75c000`).
- PR-8: Python planner test routing landed (`ce19920`).
- PR-9: Python macro build/test routing via Nix landed (`114470c`).
- PR-10: Python extension module Nix routing landed (`d8f161b`).
- PR-11: Python wasm app/lib Nix routing landed (`61d6963`).

⚠️ This verification is based on committed code, tests, and docs in the repository. It does not
re-run the entire historical CI matrix for each PR in this document.

Verification snapshot for PR-12 through PR-26 (repo evidence):

- PR-12: Node classification table and exception-policy framing are present in
  `docs/handbook/nix-gaps.md`; checker coverage exists in
  `build-tools/tools/dev/nix-gaps-inventory-check.ts` and
  `build-tools/tools/tests/dev/nix-gaps-inventory-check.test.ts`.
- PR-13/PR-14/PR-21: Node artifact-route implementation is present in `build-tools/node/defs_core.bzl`
  and `build-tools/node/defs_stage.bzl`, with route-shape tests in
  `build-tools/tools/tests/node/node.defs-core.nix-node-gen.nix-route.enforcement.test.ts` and
  `build-tools/tools/tests/node/node.nix-calling-macros.command-assembly.smoke.test.ts`.
- PR-15: C++ residual artifact stubs are Nix-backed via `nix_cpp_headers` and
  `nix_cpp_wasm_emscripten_lib` in `build-tools/cpp/defs.bzl` and `build-tools/cpp/wasm_defs.bzl`
  using `cpp_nix_build`.
- PR-16: Rust artifact-producing macros are Nix-backed in `build-tools/rust/defs.bzl` via
  `rust_nix_build`.
- PR-17/PR-19: Exception policy and artifact-route allowlist enforcement are implemented in
  `build-tools/tools/dev/nix-gaps-inventory-check.ts` with policy data in
  `docs/handbook/nix-gaps-exceptions.json` and tests in
  `build-tools/tools/tests/dev/nix-gaps-artifact-route-allowlist.test.ts`.
- PR-18: Parity and minimal-environment hermeticity checks exist in
  `build-tools/tools/tests/dev/nix-gaps.parity-and-hermeticity.test.ts`.
- PR-20: `nix_node_cli_bin` bundle/non-bundle routes are Nix-calling in
  `build-tools/node/defs_nix.bzl` with tests including
  `build-tools/tools/tests/node/node.cli.no-bundle.no-global-inputs-srcs.test.ts`.
- PR-22: Inventory/exception policy checker is wired into verify preflight and CI stage runner in
  `build-tools/tools/dev/verify/lint-preflight.ts` and `build-tools/tools/ci/run-stage.ts`, with
  enforcement tests under `build-tools/tools/tests/verify` and `build-tools/tools/tests/ci`.
- PR-23: Node implementation-route parity checks are implemented in
  `build-tools/tools/dev/nix-gaps-inventory-node-routes.ts` with tests in
  `build-tools/tools/tests/dev/nix-gaps-inventory-check.node-route-parity.test.ts`.
- PR-24: Go negative-route assertions (`go_*` absent for migrated macros) are enforced in
  `build-tools/tools/tests/go/go.macros.nix-build.rule-types.cquery.test.ts`.
- PR-25: Coverage-policy docs checker and tests exist in
  `build-tools/tools/dev/coverage-policy-doc-check.ts` and
  `build-tools/tools/tests/dev/coverage-policy-doc-check.test.ts`.
- PR-26: Node route doc-contract checker and tests exist in
  `build-tools/tools/dev/node-route-doc-contract-check.ts` and
  `build-tools/tools/tests/dev/node-route-doc-contract-check.test.ts`.

Implementation note for PR-25/PR-26:

- These two doc-contract checks are implemented and test-covered.
- The required verify/CI merge gate currently runs `nix-gaps-inventory-check.ts`; PR-25/PR-26 checks
  are not yet wired as mandatory verify/CI stage invocations.

Execution log note (fast-shell PR-2 lazy flake context hardening):

- I split per-system context usage into light and heavy routes in
  `build-tools/tools/nix/flake/outputs.nix` so `apps`/`devShells` no longer share the same context
  path as `packages`/`checks`.
- I made `nodeMods` construction explicit and opt-in through `includeNodeMods` and `mkNodeMods` in
  `build-tools/tools/nix/flake/per-system-context.nix`.
- I updated package/check callsites to resolve `nodeMods` from either an injected value or
  `mkNodeMods`, and added enforcement tests:
  - `build-tools/tools/tests/dev/flake.outputs.lazy-node-mods-context.enforcement.test.ts`
  - `build-tools/tools/tests/node/node.flake-context.node-mods-constructor.enforcement.test.ts`

## Test-time guardrails (evidence-based, required for PR-12+)

These controls are already implemented in-repo and have landed across test/runtime speedup commits
(`123fbb5`, `d1b1ee6`, `2134656`, `a33cd6e`, `0e24563`, `e900dd8`, `a1da123`).
PRs after PR-11 should use them consistently and avoid bypassing them.

1. Coverage remains opt-in.
   - Keep default runs without coverage: `i && b && v` (or `buck2 test //...`).
   - Enable coverage only when explicitly required by the PR/task/CI context:
     `v --coverage` or `buck2 test //... -- --env COVERAGE=1`.
   - Evidence: `TESTING.md` section `Coverage policy (canonical)` documents default coverage-off
     and explicit opt-in.

2. Iterate with scoped test runs before full-suite validation.
   - Use target/subset runs during implementation; run full safety suite at merge gate.
   - Evidence: `TESTING.md` includes single-target and multi-target test commands.

3. Reuse verify seed store for temp repos; do not rebuild seed per test.
   - Preserve `VBR_TEST_SEED_STORE_PATH` flow and fail-fast behavior in verify mode.
   - Evidence: `build-tools/tools/tests/lib/test-helpers/run-in-temp.ts` and
     `build-tools/tools/dev/verify/seed.ts`.

4. Scope temp repo copy roots in heavy zx tests.
   - Use `TEST_RSYNC_ROOTS` where a test only needs part of the repo.
   - Evidence: `build-tools/tools/tests/rsync/rsync.roots-only.tools.test.ts` and multiple
     scaffolding/node tests that set scoped roots.

5. Keep heavy toolchain prewarm gated.
   - Do not force heavy prewarm globally; heavy attrs are opt-in via `PREWARM_HEAVY=1`.
   - Evidence: `TESTING.md` and `build-tools/tools/dev/prewarm-toolchains.ts`.

6. Keep lint/test scope tight when editing docs/tooling.
   - Avoid widening checks to untouched areas in PR-local validation loops.
   - Evidence: scoped-lint speedup landed in `0e24563`.

7. Keep direnv shell activation on the cached nix-direnv path.
   - Require `nix-direnv` for repo entry so `.envrc` does not silently fall back to plain `use flake`.
   - Use `build-tools/tools/bin/shell-cache-check` to confirm contract and local cache state.
   - If cache is stale, recover with: `rm -rf .direnv && direnv allow && direnv reload`.

PR template requirement (apply to PR-12+):

- Include a short “Test runtime controls used” note listing which of the six controls were applied.
- If any control is not applied, state why with concrete constraints in that PR.

---

## PR-1: Inventory enforcement for public macros

### Description

I will make the inventory reproducible by adding a small checker that verifies every public macro
listed in `docs/handbook/starlark-api.md` is also listed in `docs/handbook/nix-gaps.md`. I will
update the inventory document to match the checker output.

### Scope & Changes

- Add a small checker under `build-tools/tools/dev/` that:
  - Parses `docs/handbook/starlark-api.md` for the public macro list.
  - Parses `docs/handbook/nix-gaps.md` for the inventory list.
  - Fails if any macro is missing.
- Update `docs/handbook/nix-gaps.md` to match the checker output.
- Wire the checker into an existing test harness or add a small test entrypoint that runs it.

### Tests (in this PR)

- Add a test that runs the checker and fails if any public macro is missing from the inventory.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps.md` to be checker-complete.

### Acceptance Criteria

- The checker passes on the current inventory.
- Removing a macro from the inventory causes the test to fail.
- `docs/handbook/nix-gaps.md` contains all public macros from `docs/handbook/starlark-api.md`.

### Risks

False positives if the parser misses macros due to format drift.

### Mitigation

Keep the parser simple and aligned with the current `starlark-api.md` structure.

### Consequence of Not Implementing

The inventory can drift and Phase 0 loses reproducibility.

### Downsides for Implementing

Small maintenance overhead if the doc format changes.

### Recommendation

Implement.

---

### Execution log note

- `build-tools/node/defs_stage.bzl` stage/inline commands now include selected-build out-path capture with `nix_build_out_path_cmd` before staging/inline artifact handling.
- `build-tools/tools/ci/run-stage.ts` file-size lint stage now uses strict args without `--allow-known`.
- Regression tests now fail if stage/inline Nix selected-build capture is removed or if file-size bypass flags are reintroduced in required stage wiring.

---

## PR-2: Baseline capture for Nix migration

### Description

I will add a reproducible baseline capture script and a baseline document so Phase 0 has a concrete
reference point for future parity checks. The baseline should be generated by code, not hand-edited.

### Scope & Changes

- Add a baseline capture script (e.g. `build-tools/tools/dev/nix-gaps-baseline.ts`) that writes:
  - Example build commands.
  - Best-effort build outputs and timings.
  - A timestamp and environment summary.
- Add `docs/handbook/nix-gaps-baseline.md` generated by the script.
- Add a test that runs the script in a dry-run or fixture mode and validates output shape.

### Tests (in this PR)

- A test that executes the baseline script in a controlled mode and asserts:
  - The file is created.
  - Required sections exist.

### Docs (in this PR)

- Commit the generated `docs/handbook/nix-gaps-baseline.md`.
- Add a short “how to refresh” note inside the baseline file header.

### Acceptance Criteria

- Baseline file exists and matches the script output.
- The script is reproducible and can be re-run without manual edits.
- The test fails if the baseline file is missing or malformed.
- The inventory is enforced by tests and a reproducible baseline exists.

### Risks

Baseline capture might be flaky on different machines.

### Mitigation

Use best-effort timing and allow non-fatal collection when tools are missing.

### Consequence of Not Implementing

There is no reliable reference point for migration impact and parity.

### Downsides for Implementing

Adds a small script and test to maintain.

### Recommendation

Implement.

## PR-3: Nix toolchain packages for Go and Python

### Description

I will ensure Nix provides the Go and Python toolchains used by the build. If the toolchains already
exist, I will align their outputs and visibility with the migration plan and add explicit tests that
build them.

### Scope & Changes

- Add or adjust flake outputs for `toolchains.go` and `toolchains.python`.
- Ensure derivations build on supported platforms with consistent output paths.
- Add minimal wiring for downstream consumers to reference these outputs.

### Tests (in this PR)

- Add a test that runs `nix build` for `.#toolchains.go` and `.#toolchains.python`.
- Add a test that fails if either output is missing or not executable as expected.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps.md` to mark Go and Python toolchains as Nix-provided.
- Add short usage notes for the toolchain outputs where build tooling expects them.

### Acceptance Criteria

- `nix build .#toolchains.go` and `nix build .#toolchains.python` succeed on supported platforms.
- The tests fail if a toolchain output disappears or becomes non-executable.
- Downstream consumers have stable paths for the Nix-provided toolchains.

### Risks

Platform-specific toolchain differences may break builds on less common hosts.

### Mitigation

Keep the toolchain outputs minimal and validate on all supported platforms in CI.

### Consequence of Not Implementing

Buck builds continue to rely on host toolchains, which blocks Phase 1 goals.

### Downsides for Implementing

Adds flake outputs and tests to maintain.

### Recommendation

Implement.

---

## PR-4: Buck uses Nix toolchains during migration

### Description

I will route remaining non-Nix build paths to use Nix-provided Go and Python toolchains so Buck does
not depend on host-installed binaries during the migration.

### Scope & Changes

- Update Buck toolchain configuration to reference Nix toolchain outputs.
- Adjust adapter paths in `build-tools/tools/buck/` to consume those outputs.
- Add a migration bridge that fails fast when the host toolchain is used.

### Tests (in this PR)

- Add a test that builds representative Go and Python targets using the Nix toolchains.
- Add a test that detects host toolchain usage and fails when it occurs.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps.md` to mark the temporary bridge for non-Nix paths.
- Add a short note describing how to verify Buck is using Nix toolchains.

### Acceptance Criteria

- Representative Buck builds use the Nix toolchains.
- Tests fail if a host toolchain is used.
- The bridge is in place for remaining non-Nix paths until later phases complete.

### Risks

Some targets may still assume host toolchain layouts.

### Mitigation

Add explicit path mappings and fail fast to surface mismatches early.

### Consequence of Not Implementing

Hermeticity is not achieved and Phase 1 cannot be considered complete.

### Downsides for Implementing

Temporary wiring that will be removed in later phases.

### Recommendation

Implement.

---

## PR-5: Nix planner templates for Go library and binary

### Description

I will add Nix planner templates for Go library and binary targets so the planner can generate
Nix-backed build steps for representative Go targets.

### Scope & Changes

- Add Nix planner templates for Go library and Go binary target kinds.
- Ensure the templates consume the Buck graph attributes needed for Go builds.
- Wire template selection into the planner where Go target kinds are resolved.

### Tests (in this PR)

- Add a planner test that renders Go library and Go binary templates for fixtures.
- Add a build test that runs `nix build` for a representative Go library and Go binary target.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps.md` to mark Go library and binary targets as Nix-backed.
- Add short notes on the planner template coverage for Go.

### Acceptance Criteria

- Planner output includes Nix build steps for Go library and Go binary targets.
- `nix build` succeeds for the representative Go targets.
- The tests fail if Go template generation is missing or malformed.

### Risks

Go target metadata in the Buck graph may be incomplete for some targets.

### Mitigation

Start with representative targets and extend attributes as gaps surface.

### Consequence of Not Implementing

Phase 2 cannot progress because the planner lacks Go build templates.

### Downsides for Implementing

Adds new template surface area to maintain.

### Recommendation

Implement.

---

## PR-6: Nix-backed Go macros for library, binary, and test

### Description

I will replace `nix_go_library`, `nix_go_binary`, and `nix_go_test` macro paths so they route to
Nix-backed rules or actions, with no `go_*` Buck rules used by these macros.

### Scope & Changes

- Update Go macros to select Nix-backed rule shapes.
- Remove direct `go_*` Buck rule usage from these macro implementations.
- Ensure macro outputs align with existing downstream expectations.

### Tests (in this PR)

- Add tests that build representative Go library, binary, and test targets through the macros.
- Add a test that fails if any `go_*` Buck rule is invoked by these macros.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps.md` to mark the Go macros as Nix-backed.
- Add short usage notes for the Nix-backed Go macro outputs.

### Acceptance Criteria

- Macro-driven Go builds produce outputs via Nix.
- Tests fail if the macros route to Buck `go_*` rules.
- Downstream consumers see the same output paths as before.

### Risks

Some targets may rely on implicit Buck rule behavior.

### Mitigation

Capture representative targets and compare outputs to the Phase 0 baseline.

### Consequence of Not Implementing

Go macros remain Buck-backed and Phase 2 cannot be considered complete.

### Downsides for Implementing

Transitional complexity while both Buck and Nix code paths exist.

### Recommendation

Implement.

---

## PR-7: Nix-backed Go C archive builds

### Description

I will replace the `nix_go_carchive` stub with a Nix-backed build that produces a Go C archive
usable by C/C++ consumers.

### Scope & Changes

- Add a Nix build path for Go C archive outputs.
- Update the macro or rule wrapper for `nix_go_carchive` to use the Nix build.
- Ensure the output is consumable by C/C++ link steps.

### Tests (in this PR)

- Add a test that builds a representative Go C archive via Nix.
- Add a test that links a minimal C/C++ consumer against the archive.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps.md` to mark `nix_go_carchive` as Nix-backed.
- Add a short note describing the expected archive output and consumption.

### Acceptance Criteria

- The Nix build produces a Go C archive artifact.
- A representative C/C++ consumer links against the archive successfully.
- Tests fail if the archive is missing or not linkable.

### Risks

Toolchain or linker flags may differ between platforms.

### Mitigation

Keep the archive build minimal and validate on supported platforms in CI.

### Consequence of Not Implementing

Go C archive consumers remain blocked by the stub.

### Downsides for Implementing

Adds one more build shape to maintain across platforms.

### Recommendation

Implement.

---

## PR-8: Nix planner templates for Python library, binary, and test

### Description

I will add Nix planner templates for Python library, Python binary, and Python test target kinds so
the planner can generate Nix-backed build steps for representative Python targets.

### Scope & Changes

- Add Nix planner templates for Python library, binary, and test target kinds.
- Ensure the templates consume Buck graph attributes needed for Python builds.
- Wire template selection into the planner where Python target kinds are resolved.

### Tests (in this PR)

- Add a planner test that renders Python library, binary, and test templates for fixtures.
- Add a build test that runs `nix build` for representative Python library and binary targets.
- Add a test that runs a representative Python test target via the Nix-backed path.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps.md` to mark Python library, binary, and test targets as Nix-backed.
- Add short notes on the planner template coverage for Python.

### Acceptance Criteria

- Planner output includes Nix build steps for Python library, binary, and test targets.
- `nix build` succeeds for representative Python library and binary targets.
- Representative Python tests run via the Nix-backed path.
- Tests fail if Python template generation is missing or malformed.

### Risks

Python target metadata in the Buck graph may be incomplete for some targets.

### Mitigation

Start with representative targets and extend attributes as gaps surface.

### Consequence of Not Implementing

Phase 3 cannot progress because the planner lacks Python build templates.

### Downsides for Implementing

Adds new template surface area to maintain.

### Recommendation

Implement.

---

## PR-9: Nix-backed Python macros for library, binary, and test

### Description

I will replace `nix_python_library`, `nix_python_binary`, and `nix_python_test` macro paths so they
route to Nix-backed rules or actions, with no `python_*` Buck rules used by these macros.

### Scope & Changes

- Update Python macros to select Nix-backed rule shapes.
- Remove direct `python_*` Buck rule usage from these macro implementations.
- Ensure macro outputs align with existing downstream expectations.

### Tests (in this PR)

- Add tests that build representative Python library and binary targets through the macros.
- Add a test that runs representative Python tests through the macros.
- Add a test that fails if any `python_*` Buck rule is invoked by these macros.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps.md` to mark the Python macros as Nix-backed.
- Add short usage notes for the Nix-backed Python macro outputs.

### Acceptance Criteria

- Macro-driven Python builds produce outputs via Nix.
- Tests fail if the macros route to Buck `python_*` rules.
- Downstream consumers see the same output paths as before.

### Risks

Some targets may rely on implicit Buck rule behavior.

### Mitigation

Capture representative targets and compare outputs to the Phase 0 baseline.

### Consequence of Not Implementing

Python macros remain Buck-backed and Phase 3 cannot be considered complete.

### Downsides for Implementing

Transitional complexity while both Buck and Nix code paths exist.

### Recommendation

Implement.

---

## PR-10: Nix-backed Python extension modules

### Description

I will replace the `nix_python_extension_module` and `nix_python_wasm_extension_module` stubs with
Nix-backed builds that produce extension modules and wasm extension modules used by Python runtime
loads.

### Scope & Changes

- Add Nix build paths for Python extension modules and wasm extension modules.
- Update the macro or rule wrappers for `nix_python_extension_module` and
  `nix_python_wasm_extension_module` to use the Nix builds.
- Ensure outputs are consumable by Python import and runtime load paths.

### Tests (in this PR)

- Add a test that builds a representative Python extension module via Nix.
- Add a test that builds a representative Python wasm extension module via Nix.
- Add runtime tests that import or load the produced extension modules.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps.md` to mark these macros as Nix-backed.
- Add short notes describing expected outputs and runtime loading.

### Acceptance Criteria

- Nix builds produce Python extension module artifacts.
- Runtime tests can import or load the produced extension modules.
- Tests fail if extension module outputs are missing or not loadable.

### Risks

Toolchain differences for extension builds may surface platform-specific issues.

### Mitigation

Keep the extension build minimal and validate on supported platforms in CI.

### Consequence of Not Implementing

Extension module consumers remain blocked by the stubs.

### Downsides for Implementing

Adds another build shape to maintain across platforms.

### Recommendation

Implement.

---

## PR-11: Nix-backed Python wasm app and lib builds

### Description

I will replace `nix_python_wasm_app` and `nix_python_wasm_lib` with Nix-backed builds that produce
wasm artifacts used by downstream targets.

### Scope & Changes

- Add Nix build paths for Python wasm app and lib targets.
- Update the macro or rule wrappers for `nix_python_wasm_app` and `nix_python_wasm_lib` to use the
  Nix builds.
- Ensure the wasm artifacts flow into downstream targets as before.

### Tests (in this PR)

- Add a test that builds a representative Python wasm app via Nix.
- Add a test that builds a representative Python wasm lib via Nix.
- Add a consumer test that validates the produced wasm artifacts are used by downstream targets.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps.md` to mark these macros as Nix-backed.
- Add short notes describing expected wasm outputs and consumption.

### Acceptance Criteria

- Nix builds produce wasm artifacts for app and lib targets.
- Downstream targets consume the wasm artifacts without manual wiring.
- Tests fail if wasm outputs are missing or not consumed.

### Risks

Wasm toolchain configuration may vary between host platforms.

### Mitigation

Pin wasm toolchain inputs in Nix and validate in CI.

### Consequence of Not Implementing

Wasm app and lib targets remain on non-Nix paths.

### Downsides for Implementing

Additional build shape to keep aligned with downstream expectations.

### Recommendation

Implement.

---

## PR-12: Node macro outcome classification and inventory framing

### Description

I will classify every Node public macro as artifact-producing, orchestration wrapper, or probe-only,
then update `docs/handbook/nix-gaps.md` to use the artifact-vs-exception framing consistently.

### Scope & Changes

- Add a Node classification table to `docs/handbook/nix-gaps.md` covering every Node public macro.
- Update legend terminology in `docs/handbook/nix-gaps.md` to distinguish:
  - Buck artifact gaps
  - Stub artifact gaps
  - Probe-only exceptions
- Add an explicit exception policy section and list any intentional non-build macros.

### Tests (in this PR)

- Add or update inventory checker expectations so classification/exception sections are validated.
- Add a test that fails if a Node public macro is missing from the classification table.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps.md` with classification and exception policy.

### Acceptance Criteria

- Every Node public macro has a classification with rationale.
- Inventory terminology matches the updated migration plan framing.
- Tests fail when classification coverage drifts.

### Risks

Classification can drift when macros change behavior.

### Mitigation

Keep checker logic tied to public macro inventory and fail fast on missing entries.

### Consequence of Not Implementing

Phase 4 scope remains ambiguous and migration can include unnecessary rework.

### Downsides for Implementing

Adds a small amount of metadata maintenance.

### Recommendation

Implement.

---

## PR-13: Node artifact-producing planner coverage (`nix_node_gen/lib/bin`)

### Description

I will extend Node planner/template routing for artifact-producing macro paths so `nix_node_gen`,
`nix_node_lib`, and `nix_node_bin` can be built via Nix-backed paths.

### Scope & Changes

- Add template/routing support for artifact-producing Node gen/lib/bin target paths.
- Ensure generated outputs preserve expected downstream names and structure.
- Keep orchestration-wrapper behavior intact where macros intentionally call `nix build`.

### Tests (in this PR)

- Add planner/template rendering tests for Node artifact-producing cases.
- Add representative build tests for gen/lib/bin outputs.
- Add regression checks for output path compatibility.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps.md` Node rows to reflect new build routing status.

### Acceptance Criteria

- Representative `nix_node_gen`, `nix_node_lib`, and `nix_node_bin` targets build through Nix-backed paths.
- Tests fail if routing falls back to non-hermetic artifact Buck paths.
- Downstream targets continue to consume outputs without manual rewiring.

### Risks

Node target metadata may be incomplete for some real-world targets.

### Mitigation

Start with representative targets and extend attributes as gaps are found.

### Consequence of Not Implementing

Core Node artifact-producing macros remain outside Phase 4 objectives.

### Downsides for Implementing

Adds Node planner and test surface area.

### Recommendation

Implement.

---

## PR-14: Node artifact steps (`node_asset_stage`, `node_wasm_inline_module`)

### Description

I will migrate remaining artifact-producing Node helper macros so staged assets and inline wasm
module outputs are produced through Nix-backed paths where consumed by downstream builds.

### Scope & Changes

- Add Nix-backed route for `node_asset_stage` when output is consumed as a build artifact.
- Add Nix-backed route for `node_wasm_inline_module`.
- Preserve output layout and file names expected by current consumers.

### Tests (in this PR)

- Add representative tests for staged asset outputs and inline wasm module outputs.
- Add consumer tests that validate downstream targets use migrated outputs.

### Docs (in this PR)

- Update Node macro status and notes in `docs/handbook/nix-gaps.md`.

### Acceptance Criteria

- Artifact outputs from `node_asset_stage` and `node_wasm_inline_module` are Nix-backed.
- Existing consumers continue to build without behavioral regressions.
- Tests fail if these macros route to non-hermetic artifact Buck paths.

### Risks

Output shape mismatches can break packaging or runtime loaders.

### Mitigation

Use explicit output parity checks for representative targets.

### Consequence of Not Implementing

Phase 4 remains incomplete for artifact-producing Node paths.

### Downsides for Implementing

More output-compatibility cases to maintain.

### Recommendation

Implement.

---

## PR-15: C++ residual artifact stubs (`nix_cpp_headers`, `nix_cpp_wasm_emscripten_lib`)

### Description

I will replace remaining C++ artifact-expected stubs with Nix-backed builds.

### Scope & Changes

- Implement Nix-backed output path for `nix_cpp_headers`.
- Implement Nix-backed output path for `nix_cpp_wasm_emscripten_lib`.
- Ensure outputs are consumable by current C++/wasm consumers.

### Tests (in this PR)

- Add representative build tests for headers package and Emscripten outputs.
- Add consumer tests to validate integration with downstream targets.

### Docs (in this PR)

- Update C++ macro status in `docs/handbook/nix-gaps.md`.

### Acceptance Criteria

- Both C++ stubs are replaced by Nix-backed artifact-producing paths.
- Consumer builds succeed with migrated outputs.
- Tests fail on fallback to stub behavior.

### Risks

Emscripten environment differences may surface platform-specific issues.

### Mitigation

Pin toolchain inputs and run coverage in CI on supported platforms.

### Consequence of Not Implementing

Phase 5 stays blocked by known C++ artifact gaps.

### Downsides for Implementing

Adds cross-toolchain compatibility work.

### Recommendation

Implement.

---

## PR-16: Rust artifact-producing macro migration

### Description

I will migrate Rust public macros to Nix-backed builds where their contract is artifact-producing.

### Scope & Changes

- Replace Rust stub/genrule paths with Nix-backed library and binary build paths.
- Preserve expected artifact names and downstream integration points.
- Keep any non-artifact behavior out of scope unless explicitly documented as an exception.

### Tests (in this PR)

- Add representative Rust library/binary build tests via Nix-backed routes.
- Add consumer tests for downstream usage of Rust outputs.

### Docs (in this PR)

- Update Rust macro status in `docs/handbook/nix-gaps.md`.

### Acceptance Criteria

- Artifact-producing Rust public macros build through Nix-backed paths.
- Downstream consumers build against migrated outputs.
- Tests fail on fallback to stub behavior.

### Risks

Rust target metadata or toolchain wiring may be incomplete.

### Mitigation

Start with representative targets and extend metadata where needed.

### Consequence of Not Implementing

Phase 5 remains incomplete for Rust artifact-producing macros.

### Downsides for Implementing

Additional language-specific build routing to maintain.

### Recommendation

Implement.

---

## PR-17: Exception policy enforcement for probe/test-only macros

### Description

I will formalize and enforce the exception policy so only intentional probe/test-only macros remain
non-build, with explicit rationale in inventory documentation.

### Scope & Changes

- Add machine-checked exception list (source of truth) for allowed non-build public macros.
- Fail checks when non-build macros are introduced without being listed and justified.
- Keep `cpp_sanitize_probe` documented as an intentional probe-only exception if still retained.

### Tests (in this PR)

- Add tests that enforce exception-list coverage and justification fields.
- Add a regression test that fails when an unlisted probe/stub macro appears.

### Docs (in this PR)

- Update exception policy section in `docs/handbook/nix-gaps.md`.
- Update plan references where needed for enforcement details.

### Acceptance Criteria

- Every non-build public macro is listed as an explicit, reviewed exception.
- CI fails when a new non-build macro is added without policy entry.
- Documentation and checks remain aligned.

### Risks

Policy checks can become brittle if tied to unstable formatting.

### Mitigation

Use stable data structure or strict section format validated by tests.

### Consequence of Not Implementing

Probe/stub drift can reintroduce undocumented non-hermetic behavior.

### Downsides for Implementing

Adds one policy artifact and checker maintenance.

### Recommendation

Implement.

---

## PR-18: Validation and parity for remaining phases

### Description

I will run and codify cross-language parity and hermeticity checks for post-PR-11 migrations.

### Scope & Changes

- Add representative parity checks for Node, C++, and Rust outputs.
- Add minimal-environment hermeticity checks to catch host toolchain leakage.
- Document explicit justified output differences where parity is not byte-for-byte.

### Tests (in this PR)

- Add parity tests for representative migrated targets.
- Add CI checks that run builds in a minimal environment.

### Docs (in this PR)

- Update parity and hermeticity notes in `docs/handbook/nix-gaps-baseline.md` and related docs.

### Acceptance Criteria

- Representative migrated targets pass parity checks or have documented expected deltas.
- Minimal-environment checks pass without host toolchain dependencies.
- CI catches regressions in parity or hermeticity.

### Risks

Parity checks may fail due to benign metadata differences.

### Mitigation

Define strict-but-practical parity signals and document approved exceptions.

### Consequence of Not Implementing

Migration may appear complete without evidence of behavioral parity.

### Downsides for Implementing

Longer CI runtime and additional fixtures.

### Recommendation

Implement.

---

## PR-19: Cleanup and enforcement gates for artifact-producing macros

### Description

I will remove legacy fallback paths and enforce that public artifact-producing macros cannot route to
non-hermetic Buck artifact builds.

### Scope & Changes

- Remove or guard legacy artifact-producing Buck fallback paths in macro code.
- Add CI enforcement checks for artifact-producing macro routing.
- Keep allowed probe/test-only exception policy integrated into enforcement logic.

### Tests (in this PR)

- Add checks that fail on disallowed Buck artifact routing in public macros.
- Add regression tests for exception-policy compliance.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps-plan.md` and `docs/handbook/nix-gaps.md` status sections.
- Update architecture docs to reflect final enforcement model.

### Acceptance Criteria

- Public artifact-producing macros cannot regress to non-hermetic Buck artifact paths.
- Exception policy remains explicit and machine-checked.
- CI is green with all enforcement gates enabled.

### Risks

Hard enforcement may temporarily block valid transitional work.

### Mitigation

Roll out gates with targeted allowlist and then tighten once migrations land.

### Consequence of Not Implementing

Completed migration work can regress without detection.

### Downsides for Implementing

Initial contributor friction while adapting to stricter gates.

### Recommendation

Implement.

---

## PR-20: `nix_node_cli_bin` non-bundled path migration

### Description

I will migrate the remaining non-Nix branch of `nix_node_cli_bin` (`bundle = False`) so this
artifact-producing macro no longer relies on Buck copy/genrule artifact output paths.

### Scope & Changes

- Add a Nix-backed route for `nix_node_cli_bin` when `bundle = False`.
- Preserve current output contract consumed by downstream CLI callers.
- Keep `bundle = True` behavior unchanged if already Nix-backed and correct.

### Tests (in this PR)

- Add representative tests for both `bundle = False` and `bundle = True`.
- Add regression checks ensuring `bundle = False` does not route through non-hermetic Buck artifact
  paths.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps.md` Node macro rows to remove the mixed-status note once migrated.
- Update phase tracking notes in `docs/handbook/nix-gaps-plan.md` if needed.

### Acceptance Criteria

- `nix_node_cli_bin` is Nix-backed for both bundle modes, or the non-bundled mode is explicitly
  reclassified as a documented non-artifact exception (expected to be unnecessary).
- No artifact-producing Node public macro remains on a non-hermetic Buck path.
- Tests fail on regression to Buck artifact routing for this macro.

### Risks

CLI launch semantics may differ between bundled and non-bundled outputs.

### Mitigation

Validate output paths and runtime invocation behavior for both modes in tests.

### Consequence of Not Implementing

`docs/handbook/nix-gaps.md` still contains a Node artifact-producing macro with a non-Nix path, so
inventory completion is not achieved.

### Downsides for Implementing

Adds one more Node migration path and compatibility surface.

### Recommendation

Implement.

---

## PR-21: Close Node gen/lib/bin/stage/inline gaps and enforce route parity (superseded in part by PR-23)

### Description

I will close the remaining Node artifact-route gaps by routing `nix_node_gen`, `nix_node_lib`,
`nix_node_bin`, `node_asset_stage`, and `node_wasm_inline_module` through a Nix-calling selected
planner path, and I will add implementation-aware checks so inventory status cannot drift from code
again.

Supersession note:

- PR-21 is superseded by PR-23 for the `node_asset_stage` and `node_wasm_inline_module` route
  contract.
- Final enforced route contract for those two macros is: `standalone nix-calling genrule route`.

### Scope & Changes

- Migrate `nix_node_gen` to a two-target pattern:
  - planner companion target keeps the original `cmd` for Node planner `mkGen`/`mkLib`/`mkBin`.
  - public macro target becomes a Nix-calling wrapper that builds `graph-generator-selected` for
    the companion and copies the expected output.
- Keep `nix_node_lib` / `nix_node_bin` as aliases of the migrated `nix_node_gen` route.
- Historical plan note: the original PR-21 draft described stage/inline routing through
  `nix_node_gen`, but this was superseded by PR-23.
- Final route contract for `node_asset_stage` / `node_wasm_inline_module` is
  `standalone nix-calling genrule route`.
- Extend inventory enforcement (`build-tools/tools/dev/nix-gaps-inventory-check.ts`) with
  implementation-route assertions for these Node macros when implementation files are present.

### Tests (in this PR)

- Expand Node command-assembly smoke coverage to include:
  - `nix_node_gen`
  - `node_asset_stage`
  - `node_wasm_inline_module`
    and assert standardized Nix-calling command invariants.
- Add a Node enforcement test that fails if `build-tools/node/defs_core.bzl` drops:
  - planner companion pattern (`name + "__planner"`)
  - public `nix_calling_genrule` wiring
  - `graph-generator-selected` wrapper route.
- Keep existing inventory-check fixture tests passing while adding implementation-route checks only
  when Node implementation files are present.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps.md` Node route notes to describe wrapper + planner-companion flow.
- Remove stale Go planner note that still claimed macro routing remained Buck pre-PR-6.
- Update `docs/handbook/starlark-api.md` Node macro docs so `nix_node_gen` describes planner-executed
  `cmd` and `nix_node_lib`/`nix_node_bin` alias behavior.
- Update `build-tools/docs/build-system-design.md` with the Node two-target wrapper pattern.

### Test runtime controls used

- Coverage remains opt-in.
- Scoped test execution for changed Node/dev checks.
- No full-suite rerun in PR loop; safety suite remains merge-gate responsibility.

### Acceptance Criteria

- `nix_node_gen`, `nix_node_lib`, `nix_node_bin`, `node_asset_stage`, and
  `node_wasm_inline_module` are Nix-calling in macro execution paths.
- Node planner still receives the original artifact command via the planner companion target.
- Inventory checks fail if docs claim Nix route but Node implementation route signals regress.
- Updated docs and tests reflect and validate the new routing contract.

### Risks

Two-target macro wiring can introduce output-contract regressions if planner and wrapper out paths
drift.

### Mitigation

Enforce command-assembly invariants plus static route-shape checks in tests, and keep output-copy
logic explicit in the wrapper command.

### Consequence of Not Implementing

`docs/handbook/nix-gaps.md` can report closure while Node artifact paths silently regress to Buck
genrule behavior.

### Downsides for Implementing

Slightly more macro complexity (planner companion + public wrapper) and additional enforcement
surface to maintain.

### Recommendation

Implement.

---

## PR-22: Wire inventory and exception checks into verify/CI gates

### Description

I will make the inventory and exception-policy checker a first-class repo gate so drift in
`docs/handbook/nix-gaps.md`, `docs/handbook/starlark-api.md`, and
`docs/handbook/nix-gaps-exceptions.json` fails local verify and CI before merge.

### Scope & Changes

- Add a stable invocation path for `build-tools/tools/dev/nix-gaps-inventory-check.ts` in:
  - verify preflight flow (or equivalent required local gate),
  - CI gate flow used before merge.
- Keep checker flags explicit so the gate always runs against canonical repo docs:
  - `--starlark-api docs/handbook/starlark-api.md`
  - `--nix-gaps docs/handbook/nix-gaps.md`
  - `--exceptions docs/handbook/nix-gaps-exceptions.json`
- Keep execution cost low and deterministic so this remains a fast policy gate.

### Tests (in this PR)

- Add/extend a test that verifies verify/CI gate wiring invokes the checker command.
- Add an integration-style test (or harness assertion) that fails when:
  - a public macro is removed from inventory docs,
  - an exception entry is malformed or missing required fields,
  - stale `artifactRouteAllowlist` entries remain.

### Docs (in this PR)

- Update `docs/handbook/getting-started-on-a-pr.md` and/or `TESTING.md` gate guidance to include
  this policy check as part of required pre-merge validation.
- Update `build-tools/docs/build-system-design.md` enforcement section to reflect that this checker
  is now executed as a merge gate and not only unit-tested.

### Test runtime controls used

- Coverage remains opt-in.
- Scoped test execution for verify/dev gate and checker behavior.
- No full-suite rerun in PR loop; safety suite remains merge-gate responsibility.

### Acceptance Criteria

- Running verify (or required local gate) executes inventory checking against real repo docs.
- CI fails when inventory, exception policy, or allowlist drift is introduced.
- Gate output is actionable and points to the exact failing policy condition.

### Risks

Gate wiring can be noisy if failure messages are generic.

### Mitigation

Keep errors specific and deterministic, including offending macro/policy keys.

### Consequence of Not Implementing

Inventory and policy drift can still merge undetected.

### Downsides for Implementing

Adds one more required gate command in verify/CI.

### Recommendation

Implement.

---

## PR-23: Strengthen Node implementation-route parity checks for stage/inline macros

### Description

I will tighten Node route enforcement so `docs/handbook/nix-gaps.md` claims are validated by actual
implementation shape and command invariants, not by weak textual signals.

### Scope & Changes

- Replace weak route-signal checks in `build-tools/tools/dev/nix-gaps-inventory-check.ts` for:
  - `node_asset_stage`
  - `node_wasm_inline_module`
    with implementation-aware assertions tied to real macro wiring/command assembly contracts.
- Keep route assertions aligned with intended architecture:
  - if routed via `nix_node_gen`, enforce wrapper/companion pattern;
  - if standalone Nix-calling genrule path is intentional, enforce standardized Nix-calling
    invariants and update docs language to match exact route.
- Ensure Node route checks fail when docs claim “Nix build” but implementation no longer satisfies
  the declared route contract.

### Tests (in this PR)

- Add/extend Node enforcement tests that fail when:
  - stage/inline route drops required Nix-calling command invariants,
  - docs route claims and implementation route shape diverge.
- Keep existing command-assembly smoke tests passing while adding stricter assertions for the
  stage/inline route contract.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps.md` Node route notes to exactly match the enforced implementation
  route for `node_asset_stage` and `node_wasm_inline_module`.
- Update `build-tools/docs/build-system-design.md` Node routing notes if route contract wording
  changes.

### Test runtime controls used

- Coverage remains opt-in.
- Scoped test execution for Node and dev-checker suites.
- No full-suite rerun in PR loop; safety suite remains merge-gate responsibility.

### Acceptance Criteria

- Node route checks for stage/inline macros are implementation-aware and deterministic.
- Checker fails on docs/implementation route mismatch for those macros.
- Node route documentation reflects enforced behavior without ambiguity.

### Risks

Route assertions can become brittle if tied to unstable formatting details.

### Mitigation

Assert stable structural signals and command invariants instead of raw comment/text matches.

### Consequence of Not Implementing

Node route regressions can pass while docs still report Nix-backed status.

### Downsides for Implementing

Adds stricter Node enforcement logic and test maintenance.

### Recommendation

Implement.

---

## PR-24: Enforce negative-route assertions for Go macro migration contract

### Description

I will close the remaining Go test coverage gap by asserting that migrated Go public macros do not
route through Buck `go_*` rules.

### Scope & Changes

- Extend `build-tools/tools/tests/go/go.macros.nix-build.rule-types.cquery.test.ts` (or companion
  test) to add negative assertions for:
  - `kind(go_library, <nix_go_library target>) == empty`
  - `kind(go_binary, <nix_go_binary target>) == empty`
  - `kind(go_test, <nix_go_test target>) == empty`
- Keep existing positive assertions for `go_nix_build` / `go_nix_test`.
- Align Go macro test pattern with existing Python negative-route test style.

### Tests (in this PR)

- Update Go macro rule-type cquery test with positive + negative route assertions.
- Add a regression control fixture with raw Buck `go_*` targets to prove the negative-route query
  detects Buck-routed Go targets deterministically.

### Docs (in this PR)

- Update relevant Go migration notes in `docs/handbook/nix-gaps-prs.md` and/or
  `docs/handbook/nix-gaps.md` to reflect explicit no-`go_*` enforcement evidence.

### Test runtime controls used

- Coverage remains opt-in.
- Scoped test execution for Go macro rule-type checks.
- No full-suite rerun in PR loop; safety suite remains merge-gate responsibility.

### Acceptance Criteria

- Go macro tests fail if any migrated macro route resolves to Buck `go_*` rules.
- Positive and negative route assertions are both present and passing.
- Go test evidence matches PR-6 acceptance wording.

### Risks

Cquery behavior differences across environments can cause flaky assertions.

### Mitigation

Use stable target fixtures and deterministic cquery expressions already used elsewhere in repo
tests.

### Consequence of Not Implementing

A route regression to Buck `go_*` rules can slip past current Go tests.

### Downsides for Implementing

Small increase in Go test assertions and maintenance.

### Recommendation

Implement.

---

## PR-25: Reconcile and enforce test/coverage policy documentation

### Description

I will reconcile conflicting test-coverage guidance so contributor docs, migration guardrails, and
actual verify defaults all describe the same required behavior.

### Scope & Changes

- Align coverage policy language across:
  - `docs/handbook/getting-started-on-a-pr.md`
  - `TESTING.md`
  - `docs/handbook/nix-gaps-prs.md` guardrails section
- Choose one explicit policy and apply it consistently:
  - default runs coverage-off with opt-in coverage, and
  - define exactly when coverage-on is required (if any mandatory context exists).
- Ensure command examples and required pre-merge checklist text match actual verify tooling flags.

### Tests (in this PR)

- Add a lightweight doc-policy consistency test/checker that validates required coverage policy
  phrases/commands are aligned across the above docs.
- Add regression checks that fail when policy text diverges.

### Docs (in this PR)

- Update all affected docs to one consistent coverage policy.
- Add a concise policy statement in a single canonical location and reference it from the others.

### Test runtime controls used

- Coverage remains opt-in.
- Scoped test execution for doc-policy checker.
- No full-suite rerun in PR loop; safety suite remains merge-gate responsibility.

### Acceptance Criteria

- Coverage policy text is consistent across contributor and migration docs.
- Required verification commands in docs match actual verify behavior.
- Drift in coverage policy wording is detected by tests/checks.

### Risks

Policy changes can create confusion if rollout messaging is incomplete.

### Mitigation

Use one canonical policy statement and link all secondary docs to it.

### Consequence of Not Implementing

Contributors receive conflicting instructions and run inconsistent validation workflows.

### Downsides for Implementing

Adds a small docs-consistency check to maintain.

### Recommendation

Implement.

---

## PR-26: Reconcile superseded Node route contract history (PR-21 superseded by PR-23)

### Description

I will close the remaining documentation sequencing gap by explicitly marking PR-21 as superseded by
PR-23 and reconciling Node stage/inline route language so the execution log and enforced route
contract do not conflict.

### Scope & Changes

- Mark PR-21 as superseded by PR-23 in this PR plan and explain the contract outcome.
- Align Node route wording across:
  - `docs/handbook/nix-gaps-prs.md`
  - `docs/handbook/nix-gaps.md`
  - `build-tools/docs/build-system-design.md`
- Keep the enforced stage/inline route contract explicit and unambiguous:
  - either wrapper-route wording via `nix_node_gen`, or
  - standalone Nix-calling genrule wording,
    and ensure all docs use the same wording.
- Add a small doc-contract parity check that fails if these route-contract statements diverge.

### Tests (in this PR)

- Add or extend a docs parity test/check that validates:
  - PR-21 is marked superseded by PR-23 in the PR plan,
  - Node stage/inline route wording matches the currently enforced contract text across docs.
- Add a regression check that fails when PR-plan route narrative conflicts with enforced route docs.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps-prs.md` to record supersession and final route contract outcome.
- Update `docs/handbook/nix-gaps.md` Node route notes if wording needs normalization.
- Update `build-tools/docs/build-system-design.md` Node route language to the same contract text.

### Test runtime controls used

- Coverage remains opt-in.
- Scoped test execution for docs parity checks.
- No full-suite rerun in PR loop; safety suite remains merge-gate responsibility.

### Acceptance Criteria

- PR-21 is explicitly marked as superseded by PR-23 in `docs/handbook/nix-gaps-prs.md`.
- Node stage/inline route wording is consistent across PR plan, inventory, and design docs.
- Tests fail if route-contract wording or supersession markers drift.

### Risks

Wording updates can accidentally weaken route-contract precision.

### Mitigation

Keep one canonical contract phrase set and validate exact required fragments in tests.

### Consequence of Not Implementing

The PR execution history remains internally inconsistent and can mislead future migration work.

### Downsides for Implementing

Adds a small documentation parity check and maintenance surface.

### Recommendation

Implement.

---

## PR-27: Close Node stage/inline Nix-route gap and enforce strict file-size gate compliance

### Description

I will close two remaining closure gaps together: the Node stage/inline route implementation gap and
the methodology file-size gate gap.

### Scope & Changes

- Update `build-tools/node/defs_stage.bzl` so both:
  - `node_asset_stage`
  - `node_wasm_inline_module`
    execute the canonical Nix selected-build command path (for example via
    `nix_build_out_path_cmd(... "path:$WORKSPACE_ROOT#graph-generator-selected" ...)`) before
    artifact extraction/wrapping.
- Keep the existing shared command assembly helpers/invariants:
  - `nix_calling_genrule_bootstrap(...)`
  - `nix_calling_env_export_buck_graph_json(...)`
  - `_prepare_node_nix_calling_genrule(...)`
- Update required gate wiring so file-size checks run without temporary `--allow-known` exceptions.
- Ensure known over-limit files are split or otherwise brought into compliant modular structure before
  strict gate enablement.

### Tests (in this PR)

- Add/extend Node route tests that assert stage/inline command assembly includes an actual Nix build
  out-path capture step, not only bootstrap/wiring helpers.
- Add regression checks proving route test failure when Nix invocation is removed from either macro.
- Add/extend CI stage/file-size enforcement tests to assert strict file-size gate arguments are used.
- Add regression tests that fail when `--allow-known` is reintroduced in required gate paths.

### Docs (in this PR)

- Update `docs/handbook/nix-gaps.md` Node route notes to match the enforced command-level route.
- Update `build-tools/docs/build-system-design.md` route and file-size gate notes to match enforced
  behavior.
- Update `docs/handbook/getting-started-on-a-pr.md` to reflect strict file-size gate behavior in
  required flows.
- Add a short note in `docs/handbook/nix-gaps-prs.md` execution log for this PR documenting closure
  evidence.

### Test runtime controls used

- Coverage remains opt-in.
- Scoped test execution for Node route, CI stage, and file-size gate suites.
- No full-suite rerun in PR loop; safety suite remains merge-gate responsibility.

### Acceptance Criteria

- `node_asset_stage` and `node_wasm_inline_module` command paths include canonical Nix selected-build
  invocation and out-path capture.
- Route tests fail if either macro loses Nix invocation while still claiming Nix-backed status.
- Required gate paths no longer pass `--allow-known` for file-size lint.
- Enforcement tests fail if file-size bypass flags are reintroduced.
- Documentation reflects the enforced Node route and strict methodology file-size gate behavior.

### Risks

Combining route and gate enforcement in one PR can increase change surface and review load.

### Mitigation

Keep assertions scoped, reuse existing helper contracts, and preserve deterministic tests for each
sub-area.

### Consequence of Not Implementing

Node route claims can drift from implementation, and methodology/file-size enforcement remains
inconsistent in required paths.

### Downsides for Implementing

Requires coordinated updates across Node command assembly, gate wiring, and docs/tests.

### Recommendation

Implement.

---

## PR-28: Generic runnable-target contract and DX commands (`p`/`d`)

### Description

I will generalize target run UX beyond native binaries by introducing a runnable-target contract
that covers interpreter-driven apps (Node/Python/etc.), webapps, and native binaries without
forcing non-binary artifacts into synthetic executables.

This PR defines and wires a single model for "what can be run" after build:

- `run.prod`: production-like run contract from built artifacts.
- `run.dev`: development-mode run contract (watchers/HMR/dev servers).

It also introduces short developer commands:

- `p` for runnable production-mode execution.
- `d` for runnable development-mode execution.

### Scope & Changes

- Extend planner/build manifest output schema to include runnable entries, not only executable
  `bin` entries.
- Add a generic runnable contract shape (language-agnostic) per target label, including:
  - runnable kind/category (for example `native-bin`, `script`, `webapp`, `service`),
  - `run.prod` contract,
  - optional `run.dev` contract,
  - referenced build artifacts (for example `bin`, `dist`, bundle paths).
- Explicitly exclude library-only targets from runnable contract emission:
  - library targets remain build artifacts, not runnable entries,
  - runnable listing and `p`/`d` resolution must include only non-library targets that declare a
    runnable contract.
- Update materialization/reporting UX so post-build output always prints runnable targets:
  - Replace or augment `Materialized binaries:` / `no bins found` messaging with
    `Runnable targets:` summary.
  - Ensure non-binary runnable targets (for example webapps with `dist`) are listed clearly.
- Add command routing:
  - `p <target>` resolves and executes `run.prod`.
  - `d <target>` resolves and executes `run.dev` when available, with clear error/help if missing.
  - Keep existing long-form command path behavior intact for compatibility.
- External callers importing `build-tools/tools/nix/graph-generator.nix` directly should pass
  `nodeMods` from per-system context to keep selected-target eval deterministic; when omitted, planner
  Node path uses a compatibility fallback import.
- Keep verify/CI isolation and correctness semantics unchanged:
  - `v` and CI stage flows must not implicitly switch to `run.dev` behavior,
  - runnable UX changes apply to developer run commands (`p`/`d` and long-form equivalents), not to
    verify/CI execution contracts.
- Keep interpreter-run contracts explicit (no fake executable coercion):
  - script targets run via declared interpreter/argv contract,
  - webapps use explicit run mode rather than pretending to be native `bin` outputs.

### Tests (in this PR)

- Add manifest-schema tests for runnable contract fields and backward-compatible parsing.
- Add planner/materialization tests proving runnable entries are emitted for:
  - native binary target,
  - interpreter-script target,
  - webapp target.
- Add command-routing tests for:
  - `p` dispatch to `run.prod`,
  - `d` dispatch to `run.dev`,
  - deterministic failure/help text when requested mode is unavailable.
- Add regression tests proving webapp/script targets are discoverable as runnable even when
  `bin/` is empty.
- Add regression tests proving library targets are not emitted in runnable listings and cannot be
  executed through `p`/`d`.

### Docs (in this PR)

- Update `build-tools/docs/build-system-design.md` to define runnable-target contract semantics and
  mode split (`run.prod` vs `run.dev`).
- Update language design docs (`build-tools/docs/*-design.md`) to define how each language/template
  maps app/service/script targets into `run.prod`/`run.dev` runnable contracts, and to confirm
  library targets remain non-runnable.
- Update `docs/handbook/nix-gaps.md`/related run guidance to reference runnable-target reporting,
  not binaries-only language.
- Update contributor workflow docs (`TESTING.md` and command references) with `p` and `d` usage.

### Test runtime controls used

- Coverage remains opt-in.
- Scoped test execution for planner/manifest/run-command behavior.
- No full-suite rerun in PR loop; safety suite remains merge-gate responsibility.

### Execution log note

- Added runnable-contract manifest fields (`runnable.kind`, `run.prod`, optional `run.dev`, artifacts) while preserving legacy `bins`.
- Updated materialization output to report `Runnable targets:` instead of binaries-only messaging.
- Added `p`/`d` command wrappers and route tests for prod/dev dispatch and missing dev-mode contract failures.

### Acceptance Criteria

- After build/materialization, output includes a runnable-target listing (not binaries-only).
- Runnable listing includes non-binary app targets (for example webapps and interpreter-run apps).
- `p` and `d` commands resolve runnable targets through manifest contracts and execute the correct
  mode (`run.prod`/`run.dev`).
- Existing native binary behavior remains compatible and deterministic.
- Library targets are never surfaced as runnable targets and `p`/`d` reject them with clear errors.
- Verify/CI behavior remains strict and isolation-safe, with no implicit adoption of dev-mode run
  semantics.
- Tests fail on regression to binaries-only discovery/reporting.

### Risks

Manifest and command UX changes may break existing consumers that assume `bin`-only semantics.

### Mitigation

Ship runnable contract as additive schema first, preserve existing `bin` fields, and provide clear
fallback/error messaging for legacy assumptions.

### Consequence of Not Implementing

DX remains inconsistent for non-binary apps; runnable discovery stays biased toward native binaries,
and webapp/interpreter targets continue to appear "missing" after build.

### Downsides for Implementing

Adds a new stable contract surface (manifest schema + run dispatch) and ongoing compatibility
maintenance for command UX.

### Recommendation

Implement.

---

## PR-29: Validate Nix experimental-feature usage and disable unused features

### Description

I will close the configuration gap by validating which Nix experimental features are actually used by
the build system implementation (not policy scripts), then disable features that are proven unused.

This PR keeps runtime behavior intact while reducing feature surface area to only what current build
paths require.

### Scope & Changes

- Add an implementation-level feature-usage validation matrix for representative build paths, including:
  - flake entrypoint resolution,
  - planner-selected build path,
  - node-modules derivation path,
  - verify/dev command invocation paths that call Nix.
- Record and enforce the minimum required feature set for current build-system behavior:
  - required: `nix-command`, `flakes`,
  - candidate-to-disable (validated unused): `dynamic-derivations`, `recursive-nix`, `ca-derivations`.
- Update Nix configuration defaults/templates used in local development to remove experimentally enabled
  features that are not required by build implementation.
- Keep CI policy decisions explicit and separate from implementation-usage results:
  - this PR validates runtime dependency,
  - CI policy may continue to require additional features for organizational reasons.
- Add a single source-of-truth note describing:
  - "implementation-required features" vs
  - "policy-required features".

### Tests (in this PR)

- Add a feature-matrix integration test that runs representative Nix commands with controlled
  `NIX_CONFIG` feature subsets and asserts:
  - success with minimum implementation-required feature set,
  - failure when required features are missing (`nix-command`, `flakes`),
  - no behavioral dependency on removed candidate features for covered paths.
- Add regression coverage ensuring future introduction of actual dynamic/recursive/CA feature
  dependencies is detected and documented.
- Add/update a docs/config parity test so documented "implementation-required" features match validated
  matrix outcomes.

### Docs (in this PR)

- Update `build-tools/docs/build-system-design.md` to distinguish implementation-required features from
  policy-enforced features and reference the validation matrix.
- Update `build-tools/docs/remote-build-setup.md` with explicit minimum implementation requirements and
  separate policy recommendations.
- Add a short execution-log note in `docs/handbook/nix-gaps-prs.md` summarizing matrix evidence and the
  resulting disabled features.

### Test runtime controls used

- Coverage remains opt-in.
- Scoped test execution for feature-matrix and docs/config parity suites.
- No full-suite rerun in PR loop; safety suite remains merge-gate responsibility.

### Acceptance Criteria

- Representative build-system paths pass with implementation-required features only
  (`nix-command`, `flakes`).
- Candidate features (`dynamic-derivations`, `recursive-nix`, `ca-derivations`) are disabled in local
  default config surfaces where this repo controls defaults.
- Tests fail if required-feature assumptions drift without updating validation expectations/docs.
- Documentation clearly separates implementation usage from CI/policy requirements.

### Risks

A path not covered by the validation matrix may still rely on a feature that appears unused.

### Mitigation

Use representative command coverage across planner, selected-target, and node-modules paths; add
regression checks whenever a new Nix invocation path is introduced.

### Consequence of Not Implementing

The repo continues carrying unnecessary experimental-feature surface area and ambiguity between runtime
requirements and policy choices.

### Downsides for Implementing

Adds a small ongoing maintenance burden for the feature-matrix test and docs/config parity checks.

### Recommendation

Implement.
