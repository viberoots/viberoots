# HMR Phase 5 Implementation Plan - PR Breakdown

This plan covers Phase 5: generalized multi-module dev updates for webapp templates, including multiple wasm modules and multiple TypeScript modules in one app, with no per-module boilerplate in app code.

Each PR includes code, tests, and documentation updates together.

Scope: `ts/webapp-static`, `ts/webapp-ssr-vite`, and `ts/webapp-ssr-next`.

Policy for this phase:

- no docs-only PRs
- no tests-only PRs
- no functionality merged without tests in the same PR
- no backward-compatibility workarounds
- no fallback-first behavior that masks primary path defects

Testing policy for this phase:

1. Prefer E2E coverage for all user-visible dev-loop behaviors.
2. Use lower-level unit/integration tests only for deterministic internals that E2E should not duplicate.
3. No PR is complete unless its new user-facing behavior is covered by at least one E2E target in the same PR.
4. No PR is complete unless all tests touched by that PR, and the PR verification command set, are passing before merge.

No-boilerplate definition for this phase:

1. Adding a new declared TS or wasm module must not require app authors to add new dev scripts.
2. Adding a new declared TS or wasm module must not require app authors to add module-specific runtime wiring in app entrypoints.
3. App authors consume modules through generated module-key APIs only.

Completion criteria:

1. Apps can declare and consume multiple wasm modules through one generated contract surface.
2. Apps can declare and consume multiple TypeScript modules through one generated contract surface.
3. Dev update loops apply module edits for both TS and wasm modules in one running session without process restart.
4. Wasm and TS module orchestration is manifest-driven, not hardcoded to one module path or filename.
5. For SSR templates, per-module-key behavior is verified for both client and server paths.
6. Each merged PR includes implementation, tests, and docs for the behavior introduced in that PR.
7. Adding a new module key to manifests is sufficient to enable dev updates for that module in the same session.
8. Final goal-validation tests prove no-boilerplate multi-module HMR behavior for client and server code.
9. E2E suites validate mixed TS+wasm module additions and edit cycles for static, SSR Vite, and SSR Next templates.
10. Each PR closes with a green verification set and no failing touched tests.

Dependency chain:

1. PR-1 introduces manifest contracts and generated loaders for both wasm and TS modules.
2. PR-2 introduces generalized multi-module dev orchestration and deterministic concurrency controls.
3. PR-3 migrates `ts/webapp-static` and `ts/webapp-ssr-vite` to the new contracts.
4. PR-4 migrates `ts/webapp-ssr-next` and locks cross-template parity.
5. PR-5 locks the final matrix and removes remaining hardcoded path expectations.

Phase 5 checkpoints:

- Checkpoint A: `READY` for PR-2 when PR-1 contract generation, tests, and docs are green.
- Checkpoint B: `READY` for PR-3 when PR-2 multi-module orchestration tests are green.
- Checkpoint C: `READY` for PR-4 when PR-3 static+SSR-vite migrations are green.
- Checkpoint D: `READY` for PR-5 when PR-4 SSR-next migration and parity checks are green.
- Checkpoint E: `COMPLETED` for Phase 5 when PR-5 full matrix tests and docs are green.

---

## PR-1: Manifest contracts and generated multi-module loaders

### Description

I will replace single-contract assumptions with manifest contracts that define all wasm and TS modules for an app and generate one typed loader API for each category.

### Scope & Changes

- Define a canonical app manifest schema for wasm modules, including:
  - module key
  - source label/path
  - runtime destinations for client and SSR parity
  - default module key
- Define a canonical app manifest schema for TS modules, including:
  - module key
  - source entry path
  - runtime import contract key
  - default module key where relevant
- Generate per-app manifests during scaffold/update:
  - `wasm-modules.manifest.json`
  - `ts-modules.manifest.json`
- Generate single typed app helper surfaces, for example:
  - `readWasmModuleBytes(moduleKey)`
  - `listWasmModules()`
  - `loadTsModule(moduleKey)`
  - `listTsModules()`
- Remove template-level assumptions that only one wasm or one TS module exists.
- Keep implementation modular:
  - schema validation in one module
  - generation logic in one module
  - template-facing helper generation in one module

### Tests (in this PR)

- Add manifest schema contract tests:
  - valid multi-module manifests pass
  - duplicate module keys fail
  - missing default key fails
- Add scaffolding generation tests:
  - generated app contains both manifests and loader helpers
  - helpers resolve each declared module key for wasm and TS
- Add SSR parity path tests:
  - wasm module destinations include client and server runtime paths
  - TS module keys are available in client and server loader contexts
- Add one scaffolding E2E smoke target that validates generated manifest and helper consumption in a running dev session.

### Docs (in this PR)

- Update scaffolding docs with new wasm and TS manifest contracts and generated loader APIs.
- Update HMR plan docs to define Phase 5 module contract terms.
- Add template usage documentation showing app-level consumption through generated helpers only.

### Verification Commands

- `buck2 test //:scaffolding_template_conventions_metadata_cquery`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`
- `buck2 test //:scaffolding_webapp_phase3_runtime_consistency_policy_contract`
- `buck2 test //:scaffolding_webapp_static_dev_hmr_config_contract`
- `buck2 test //:scaffolding_webapp_multi_module_manifest_contract`

### Acceptance Criteria

- Wasm and TS manifest schemas are implemented and validated by tests.
- Generated loaders expose module-key-driven APIs for multiple wasm and TS modules.
- Docs and tests use the same manifest terminology and contract expectations.
- Adding a module key in fixture manifests requires no extra module-specific script or app-entrypoint wiring.
- At least one E2E target proves scaffolded apps consume generated module-key helpers in a live dev loop.

### Risks

Manifest schemas may grow too broad and blur responsibilities across generation and runtime layers.

### Mitigation

Keep schemas minimal and enforce strict validation in dedicated contract modules.

### Consequence of Not Implementing

The codebase keeps single-module assumptions and cannot generalize multi-module dev updates cleanly.

### Downsides for Implementing

Initial refactor touches scaffold generation and runtime helper paths together.

### Recommendation

Implement first to establish strict, testable module contracts for all later PRs.

---

## PR-2: Generalized multi-module dev orchestration with deterministic concurrency

### Description

I will move from hardcoded single-module watch paths to manifest-driven orchestration loops that run all wasm and TS module pipelines automatically with deterministic behavior under concurrent edits.

### Scope & Changes

- Extend dev orchestration to load app wasm and TS manifests at startup.
- For each declared wasm module, create one managed watch/build/sync pipeline.
- For each declared TS module set, ensure orchestration registers and validates module-key-driven dev update probes.
- Keep deterministic queue behavior per module and deterministic logging across modules.
- Standardize event markers to include module key and module type.
- Ensure startup/shutdown lifecycle handles all module watchers with clean teardown.
- Do not require app authors to add one script per module.
- Add explicit concurrency bounds and fairness rules for multi-module queues.

### Tests (in this PR)

- Add orchestrator unit/integration tests:
  - starts one watcher per declared wasm module
  - module-scoped rebuild events are deterministic
  - failure in one module is surfaced without hiding errors from others
  - queue fairness holds across at least 5 concurrently edited module keys
- Add scaffolded E2E temp-repo tests for multi-module edits:
  - edit wasm producer A, assert module A output updates
  - edit wasm producer B, assert module B output updates
  - edit TS module A and TS module B in one session, assert both update
  - assert no dev process restart
- Add E2E stress tests for sequential and concurrent edits across multiple module keys in one session.

### Docs (in this PR)

- Document manifest-driven watcher orchestration in scaffolding docs.
- Document module-scoped diagnostics and recovery commands for wasm and TS module paths.
- Update template README guidance to reflect zero per-module script boilerplate.
- Document concurrency and fairness guarantees in the dev orchestration contract.

### Verification Commands

- `buck2 test //:scaffolding_webapp_static_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_multi_module_orchestrator_contract`
- `buck2 test //:scaffolding_webapp_multi_module_concurrency_contract`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`

### Acceptance Criteria

- Dev orchestrator runs all declared wasm module pipelines automatically.
- Module-key-driven TS and wasm edits update expected outputs in one session.
- Deterministic behavior is validated under concurrent multi-module edits.
- Tests and docs confirm module-scoped diagnostics and recovery behavior.
- Multi-module orchestration requires no per-module script additions in scaffolded app `package.json`.
- E2E targets prove mixed TS+wasm module edits in one session on the orchestrated path.

### Risks

Running multiple watchers can increase orchestration complexity and failure triage effort.

### Mitigation

Keep per-module queues isolated, logs structured, concurrency bounded, and lifecycle control centralized.

### Consequence of Not Implementing

Multiple modules require manual scripts and cannot be maintained as a clean default path.

### Downsides for Implementing

Orchestration code becomes a critical path and needs strict test coverage.

### Recommendation

Implement second to make the module contracts operational in dev sessions.

---

## PR-3: Template migration to multi-module contracts for static and SSR Vite

### Description

I will migrate template runtime wiring to consume generated wasm and TS module contracts across `ts/webapp-static` and `ts/webapp-ssr-vite`.

### Scope & Changes

- Update static and SSR Vite runtime helpers to load wasm by module key through generated helper.
- Update static and SSR Vite runtime helpers to load TS modules by module key through generated helper.
- Remove hardcoded single-path assumptions in static and SSR Vite runtime code and scripts.
- Ensure SSR Vite server parity paths for each wasm module are staged consistently.
- Ensure SSR Vite client and server paths can resolve TS modules by module key.
- Keep template files within size and separation constraints by splitting helpers where needed.

### Tests (in this PR)

- Extend template-specific E2E contract tests for:
  - static multi-module wasm and TS usage
  - SSR Vite multi-module wasm and TS usage (client + server)
- Add per-module-key E2E edit-cycle tests:
  - for each declared key in fixture manifests, assert static and SSR Vite updates where applicable
  - combined TS module edit + wasm module A edit + wasm module B edit in one dev session
  - no process restart, deterministic output updates
- Keep existing HMR no-restart assertions in migrated tests.

### Docs (in this PR)

- Update static and SSR Vite docs to show module-key usage through generated helpers for wasm and TS.
- Update troubleshooting sections for multi-module TS and wasm edit-cycle diagnostics.
- Update plan/status docs to mark migrated templates and active constraints.

### Verification Commands

- `buck2 test //:scaffolding_webapp_static_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_runtime_consistency_phase3`
- `buck2 test //:scaffolding_webapp_static_dev_multi_module_runtime_contract`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_multi_module_runtime_contract`

### Acceptance Criteria

- `ts/webapp-static` and `ts/webapp-ssr-vite` use generated wasm and TS module contracts instead of single-module assumptions.
- For SSR Vite, each declared module key is verified in both client and server update paths.
- Combined TS + multi-wasm edit cycles pass deterministically in static and SSR Vite tests.
- Docs match actual static and SSR Vite behavior and runtime helper APIs.
- Template usage for new module keys is via generated APIs only, with no module-specific app-entrypoint boilerplate.
- E2E coverage for static and SSR Vite validates easy addition of extra TS/wasm module keys without extra app wiring.

### Risks

Template migration can leave inconsistent runtime path assumptions between static and SSR Vite variants.

### Mitigation

Use shared contract helpers and cross-template contract tests for static and SSR Vite parity checks.

### Consequence of Not Implementing

The generalized orchestration exists but static and SSR Vite templates still require manual wiring and remain inconsistent.

### Downsides for Implementing

Migration still touches many files and can expand if boundaries are not kept to static+SSR Vite.

### Recommendation

Implement third to complete static and SSR Vite behavior, then isolate SSR Next migration next.

---

## PR-4: SSR Next migration and cross-template parity lock

### Description

I will migrate `ts/webapp-ssr-next` to generated wasm and TS module contracts and lock parity checks against static and SSR Vite behaviors.

### Scope & Changes

- Update SSR Next runtime helpers to load wasm by module key through generated helper.
- Update SSR Next runtime helpers to load TS modules by module key through generated helper.
- Remove hardcoded single-path assumptions in SSR Next runtime code and scripts.
- Ensure SSR Next server parity paths for each wasm module are staged consistently.
- Ensure SSR Next client and server paths resolve TS modules by module key.
- Add cross-template parity checks so SSR Next contract behavior matches static and SSR Vite expectations for equivalent module edits.

### Tests (in this PR)

- Add SSR Next multi-module E2E runtime contract tests:
  - per-module-key TS updates on client and server paths
  - per-module-key wasm updates on client and server paths
  - combined TS+wasm edit cycles in one session with no process restart
- Add cross-template parity E2E tests:
  - equivalent module edits produce equivalent contract outcomes across static, SSR Vite, and SSR Next
- Add targeted deterministic diagnostics tests for SSR Next multi-module failure triage output.

### Docs (in this PR)

- Update SSR Next docs to present multi-module contracts as canonical behavior.
- Update cross-template docs to record parity requirements and diagnostics.
- Record verification commands for SSR Next migration and parity checks.

### Verification Commands

- `buck2 test //:scaffolding_webapp_ssr_next_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_runtime_consistency`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_multi_module_runtime_contract`
- `buck2 test //:scaffolding_webapp_multi_template_parity_contract`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`

### Acceptance Criteria

- `ts/webapp-ssr-next` uses generated wasm and TS module contracts instead of single-module assumptions.
- For SSR Next, each declared module key is verified in both client and server update paths.
- Cross-template parity checks are green for equivalent multi-module edit scenarios.
- Docs and tests are consistent with migrated SSR Next behavior.
- E2E parity checks prove SSR Next supports easy TS/wasm module-key additions without module-specific app wiring.

### Risks

SSR Next migration can surface framework-specific path or watcher behavior differences not present in static or SSR Vite.

### Mitigation

Use dedicated SSR Next contracts plus parity tests scoped to equivalent scenarios across templates.

### Consequence of Not Implementing

Phase 5 remains incomplete for SSR Next and cross-template parity cannot be asserted.

### Downsides for Implementing

Parity work adds additional verification surface and can expose template-specific mismatches.

### Recommendation

Implement fourth to complete migration coverage before final closeout locking.

---

## PR-5: Full matrix lock-in and hardcoded path removal

### Description

I will close Phase 5 by removing remaining single-module hardcoding and locking full regression coverage for multi-module TS and wasm behavior across static and SSR paths.

### Scope & Changes

- Remove remaining hardcoded `top.wasm` assumptions from active template runtime contracts where module keys should apply.
- Remove remaining hardcoded single-entry TS module assumptions from active template runtime contracts where module keys should apply.
- Enforce policy checks that disallow new hardcoded single-module paths in active template runtime wiring.
- Finalize one regression matrix that covers:
  - app-local TS edits
  - workspace-linked TS edits
  - multiple wasm module edits
  - combined TS and wasm edit cycles in one session
  - per-module-key SSR client and server assertions
- Keep only primary-path behavior. No compatibility bridges.

### Tests (in this PR)

- Add/extend policy contract tests that fail on new hardcoded single-module runtime assumptions in active template code.
- Run full in-scope matrix:
  - static, SSR Vite, SSR Next
  - TS local + TS workspace + wasm multi-module + combined cycle targets
  - per-module-key SSR client/server target checks
- Add targeted deterministic diagnostics tests for multi-module failure triage output.
- Add explicit final goal-validation tests:
  - add new TS module key in fixture manifest, run dev, assert client/server updates with no app-entrypoint edits
  - add new wasm module key in fixture manifest, run dev, assert client/server updates with no app-entrypoint edits
  - add mixed TS+wasm module keys together in one fixture, run one dev session, assert both update paths without extra boilerplate edits

### Docs (in this PR)

- Update docs to present final Phase 5 contracts as canonical behavior.
- Remove outdated single-module implementation guidance from active docs.
- Record final verification matrix and troubleshooting commands for maintainers.

### Verification Commands

- `buck2 test //:scaffolding_webapp_static_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_static_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_runtime_consistency_phase3`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_runtime_consistency`
- `buck2 test //:scaffolding_webapp_static_dev_multi_module_runtime_contract`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_multi_module_runtime_contract`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_multi_module_runtime_contract`
- `buck2 test //:scaffolding_webapp_multi_module_orchestrator_contract`
- `buck2 test //:scaffolding_webapp_multi_module_concurrency_contract`
- `buck2 test //:scaffolding_webapp_multi_template_parity_contract`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`

### Acceptance Criteria

- Full matrix is green for multi-module TS and wasm update behavior.
- Active templates no longer depend on single-module hardcoded runtime assumptions.
- For SSR templates, per-module-key client/server behavior is test-backed and green.
- Docs, policy tests, and runtime behavior are consistent.
- Phase 5 checkpoint reaches `COMPLETED`.
- Final goal-validation tests prove no-boilerplate multi-module HMR for TS and wasm in client and server code.
- Final E2E matrix proves mixed TS+wasm module additions can be made quickly without module-specific scripts or runtime entrypoint wiring.

### Risks

Final hardcoded-path removal can reveal hidden dependencies in less-visible test or tooling paths.

### Mitigation

Use explicit policy tests plus full matrix reruns in the same PR.

### Consequence of Not Implementing

Phase 5 remains partially complete and single-module assumptions can regress into active templates.

### Downsides for Implementing

Closeout PR has broad verification scope and can take longer to stabilize.

### Recommendation

Implement fifth and treat this PR as Phase 5 closeout gate.

---

## Implementation Handoff Appendix

This appendix is a handoff aid. It defines default implementation boundaries and expected artifacts. It does not forbid necessary deviations when an engineer finds a better minimal path to satisfy the PR acceptance criteria.

Engineering judgment policy:

1. The PR acceptance criteria and test gates are authoritative.
2. File and target lists below are expected starting points, not hard restrictions.
3. Engineers may touch additional files when needed for correctness, determinism, readability, or required integration.
4. Any deviation from the listed scope should remain minimal, be explained in the PR description, and include tests in the same PR.

Progressive scope review policy:

1. After each PR is merged, the engineer should review the scope of all remaining PRs before starting the next one.
2. If completed work changes assumptions, dependencies, or risk, the engineer should adjust remaining PR scopes minimally and document the rationale.
3. Scope adjustments must preserve the phase completion criteria, no-boilerplate goals, and per-PR test/doc requirements.

### Shared fixture contract for all PRs

- Maintain one shared multi-module fixture shape used across static, SSR Vite, and SSR Next tests:
  - at least two TS module keys
  - at least two wasm module keys
  - one mixed edit-cycle scenario (TS + wasm in one session)
- Keep fixture naming and module keys consistent across template families to support parity checks.
- Keep fixture behavior deterministic and aligned with no-restart assertions.

### PR-1 default touch map

Expected focus areas:

- scaffolding generation contract modules for manifests
- generated helper template sources for module-key APIs
- docs describing manifest schema and helper usage
- scaffold contract tests for manifest generation and loader behavior

Expected new/updated target families:

- manifest schema contract test target(s)
- scaffold generation contract test target(s)

Out-of-bounds by default:

- orchestrator runtime behavior changes
- template runtime migration changes beyond generated helper plumbing

### PR-2 default touch map

Expected focus areas:

- dev orchestration modules (watch/build/sync coordination)
- module-scoped logging and lifecycle handling
- concurrency/fairness controls
- orchestration E2E + stress tests
- orchestration docs and troubleshooting

Expected new/updated target families:

- multi-module orchestrator contract test target(s)
- multi-module concurrency contract test target(s)
- orchestrator mixed-edit E2E target(s)

Out-of-bounds by default:

- broad template runtime migration changes
- cross-template parity closeout logic

### PR-3 default touch map (static + SSR Vite)

Expected focus areas:

- `ts/webapp-static` template runtime/module helper wiring
- `ts/webapp-ssr-vite` template runtime/module helper wiring
- template-specific E2E contract tests for static + SSR Vite
- docs for static + SSR Vite usage and troubleshooting

Expected new/updated target families:

- static multi-module runtime contract target(s)
- SSR Vite multi-module runtime contract target(s)

Out-of-bounds by default:

- SSR Next migration
- final hardcoded path policy lock-in

### PR-4 default touch map (SSR Next + parity)

Expected focus areas:

- `ts/webapp-ssr-next` template runtime/module helper wiring
- SSR Next E2E contract tests for module-key client/server behavior
- cross-template parity E2E tests
- docs for SSR Next and parity requirements

Expected new/updated target families:

- SSR Next multi-module runtime contract target(s)
- multi-template parity contract target(s)

Out-of-bounds by default:

- final global hardcoded-path lock-in and closeout cleanup

### PR-5 default touch map (closeout)

Expected focus areas:

- policy checks preventing single-module hardcoded regressions
- final matrix target wiring and stability fixes
- final goal-validation E2E tests
- final canonical docs alignment

Expected new/updated target families:

- hardcoded-path policy contract target(s)
- final mixed TS+wasm goal-validation E2E target(s)

Out-of-bounds by default:

- new architecture directions not required by Phase 5 acceptance criteria

### Definition of "easy module addition" (harness-level)

A PR set satisfies "easy module addition" when these assertions are green:

1. Add a new TS module key in fixture manifests.
2. Add a new wasm module key in fixture manifests.
3. Run one dev session and observe expected client/server updates for both module types.
4. Do not add module-specific scripts in app `package.json`.
5. Do not add module-specific runtime entrypoint wiring in app code.

If any of the above requires additional edits outside listed touch maps, the engineer should make those edits using best judgment, keep them minimal, and include test coverage in the same PR.
