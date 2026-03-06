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
4. After scaffold time, app authors must not manually edit wasm/TS manifest files to add dependencies.
5. For dependency growth, required app-author inputs are limited to existing module wiring in `TARGETS` and dependency declarations in `package.json`.

Completion criteria:

1. Apps can declare and consume multiple wasm modules through one generated contract surface.
2. Apps can declare and consume multiple TypeScript modules through one generated contract surface.
3. Dev update loops apply module edits for both TS and wasm modules in one running session without process restart.
4. Wasm and TS module orchestration is manifest-driven, not hardcoded to one module path or filename.
5. For SSR templates, per-module-key behavior is verified for both client and server paths.
6. Each merged PR includes implementation, tests, and docs for the behavior introduced in that PR.
7. Adding new dependencies through `TARGETS` and `package.json` is sufficient to enable dev updates in the same session; no manual manifest edits are required.
8. Final goal-validation tests prove no-boilerplate multi-module HMR behavior for client and server code.
9. E2E suites validate mixed TS+wasm module additions and edit cycles for static, SSR Vite, and SSR Next templates.
10. Each PR closes with a green verification set and no failing touched tests.

Dependency chain:

1. PR-1 introduces manifest contracts and generated loaders for both wasm and TS modules.
2. PR-2 introduces generalized multi-module dev orchestration and deterministic concurrency controls.
3. PR-3 migrates `ts/webapp-static` and `ts/webapp-ssr-vite` to the new contracts.
4. PR-4 migrates `ts/webapp-ssr-next` and locks cross-template parity.
5. PR-5 locks the final matrix and removes remaining hardcoded path expectations.
6. PR-6 introduces producer-surface contracts and root-set module discovery plumbing.
7. PR-7 finalizes zero-edit module growth, watcher efficiency, and zero-wasm default lock-in across templates.
8. PR-8 closes in-session growth gaps by refreshing generated contracts/watch sets without restart and strengthens contract-test enforcement.
9. PR-9 enforces generated-only runtime authority and removes remaining compatibility/fallback bridges.
10. PR-10 closes remaining hardcoded runtime-path and policy-coverage gaps for final strict canonical-path behavior.

Phase 5 checkpoints:

- Checkpoint A: `READY` for PR-2 when PR-1 contract generation, tests, and docs are green.
- Checkpoint B: `READY` for PR-3 when PR-2 multi-module orchestration and generated-contract tests are green.
- Checkpoint C: `READY` for PR-4 when PR-3 static+SSR-vite migrations are green.
- Checkpoint D: `READY` for PR-5 when PR-4 SSR-next migration and parity checks are green.
- Checkpoint E: `READY` for PR-6 when PR-5 full matrix and hardcoded-path policy checks are green.
- Checkpoint F: `READY` for PR-7 when PR-6 producer-surface contracts and root-set discovery tests/docs are green.
- Checkpoint G: `READY` for PR-8 when PR-7 zero-edit growth + zero-wasm default matrix, tests, and docs are green.
- Checkpoint H: `READY` for PR-9 when PR-8 in-session growth + strict contract-test enforcement is green.
- Checkpoint I: `READY` for PR-10 when PR-9 generated-authority + compatibility-bridge-removal matrix, tests, and docs are green.
- Checkpoint J: `COMPLETED` for Phase 5 when PR-10 runtime-path canonicalization + policy-lock matrix, tests, and docs are green.

### Phase 5 contract update (effective from PR-2 onward)

PR-1 content remains unchanged. Starting with PR-2 implementation, manifest ownership shifts from user-managed source files to generated contract artifacts:

1. Dev/build orchestration generates runtime manifest contracts from existing app wiring in `TARGETS` and dependency declarations in `package.json`.
2. Generated manifest artifacts live outside template source trees (for example under `buck-out/tmp/...`), and are not user-edited.
   - Note (intentionally refined in PR-9): some frameworks may consume generated projections in `app/` or `src/`, but those files remain generated derivatives of the canonical `buck-out` artifacts, not user-authored authority.
3. Runtime helper APIs remain module-key based, but module-key availability is derived from generated contracts rather than user-authored manifest edits.
4. Dependency growth after scaffold time must not require manual manifest updates.

Generated-path contract (explicit):

1. Generated manifest artifacts use one canonical location family under `buck-out/tmp/module-contracts/<app-id>/`.
2. The canonical location is resolved through one shared resolver API used by dev orchestration, runtime helper wiring, tests, and build packaging.
3. No project-local symlink is required for correctness. Any optional convenience symlink is non-canonical and must not be required by tooling or tests.
4. For PR-2, generated artifacts are authoritative for dev/watch orchestration.
5. Runtime helper cutover from source-tree manifests to generated artifacts is completed in PR-3.
   - Note (intentionally superseded by PR-9 closeout): PR-3/PR-4 complete template migration, while PR-9 performs final authority hard-cutover/policy lock and removes remaining compatibility bridges.

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

I will move from hardcoded single-module watch paths to generated-manifest orchestration loops that run all wasm and TS module pipelines automatically with deterministic behavior under concurrent edits, without requiring users to manually maintain manifest files.

### Scope & Changes

- Extend dev orchestration to generate app wasm and TS manifests at startup from existing `TARGETS` wiring and `package.json` dependency declarations.
- Load generated manifests from canonical non-source generated paths in `buck-out/tmp/module-contracts/<app-id>/` for dev/watch orchestration paths.
- Add one shared contract-path resolver and remove ad hoc path inference in call sites.
- For each declared wasm module, create one managed watch/build/sync pipeline.
- For each declared TS module set, ensure orchestration registers and validates module-key-driven dev update probes.
- Keep deterministic queue behavior per module and deterministic logging across modules.
- Standardize event markers to include module key and module type.
- Ensure startup/shutdown lifecycle handles all module watchers with clean teardown.
- Do not require app authors to add one script per module.
- Add explicit concurrency bounds and fairness rules for multi-module queues.
- Keep `TARGETS` and `package.json` as the only required app-author touch points for dependency growth.
- For PR-2, consume generated artifacts on the watcher/dev orchestration path; keep runtime helper source-manifest cutover scoped to PR-3.
  - Note (intentionally superseded by PR-9 closeout): final authority lock and fallback/bridge removal complete in PR-9 after migration and growth plumbing land.

### Tests (in this PR)

- Add generated-contract tests:
  - generated wasm/TS manifests are deterministic for unchanged `TARGETS` and `package.json`
  - manifest regeneration updates only when `TARGETS`/`package.json` contract inputs change
  - generated manifests are consumed from canonical non-source generated paths via the shared resolver
  - no call site relies on a template-local source manifest path or optional symlink
- Add orchestrator unit/integration tests:
  - starts one watcher per declared wasm module
  - module-scoped rebuild events are deterministic
  - failure in one module is surfaced without hiding errors from others
  - queue fairness holds across at least 5 concurrently edited module keys
- Add scaffolded E2E temp-repo tests for multi-module edits:
  - add/update wasm dependency wiring in `TARGETS`, assert corresponding module output updates
  - add/update TS local dependency in `package.json`, assert module update in one session
  - edit TS module A and TS module B in one session, assert both update
  - assert no dev process restart
- Add E2E stress tests for sequential and concurrent edits across multiple module keys in one session.
- Add deterministic negative-path tests for generated contracts:
  - malformed or incomplete `TARGETS`/`package.json` contract inputs fail with stable diagnostics
  - missing generated artifact path or resolver mismatch fails with stable diagnostics

### PR-2 generated contract freeze (handoff contract for PR-3+)

1. Canonical output path:
   - `buck-out/tmp/module-contracts/<app-id>/`
2. `app-id` derivation:
   - deterministic, cross-platform normalized identifier derived from canonical app target identity
   - shared implementation used by generator, resolver, watcher, tests, and packaging
3. Resolver contract:
   - one shared resolver API is the only supported path lookup mechanism
   - callsites must not hand-roll generated-contract paths
4. Generated schema contract:
   - versioned generated schema for wasm and TS manifests
   - required fields and ordering are deterministic and test-locked
5. Failure-signature contract:
   - generation failures emit stable markers and actionable recovery guidance
   - no silent fallback to stale source-tree manifests

### Docs (in this PR)

- Document generated-manifest watcher orchestration in scaffolding docs.
- Document module-scoped diagnostics and recovery commands for wasm and TS module paths.
- Update template README guidance to reflect zero per-module script boilerplate.
- Document concurrency and fairness guarantees in the dev orchestration contract.
- Document that manifests are generated artifacts, not user-authored source files, and that dependency growth uses only `TARGETS` and `package.json`.

### Verification Commands

- `buck2 test //:scaffolding_webapp_static_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_multi_module_orchestrator_contract`
- `buck2 test //:scaffolding_webapp_multi_module_concurrency_contract`
- `buck2 test //:scaffolding_webapp_multi_module_generated_manifest_contract`
- `buck2 test //:scaffolding_webapp_multi_module_contract_path_resolver_contract`
- `buck2 test //:scaffolding_webapp_multi_module_no_source_manifest_dependency_contract`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`

### Acceptance Criteria

- Dev orchestrator runs all declared wasm module pipelines automatically.
- Module-key-driven TS and wasm edits update expected outputs in one session.
- Deterministic behavior is validated under concurrent multi-module edits.
- Tests and docs confirm module-scoped diagnostics and recovery behavior.
- Multi-module orchestration requires no per-module script additions in scaffolded app `package.json`.
- Adding dependencies after scaffold time does not require manual edits to wasm/TS manifest files.
- Generated manifest artifacts are derived from existing `TARGETS` and `package.json` inputs and consumed from canonical non-source generated paths via one shared resolver on the PR-2 dev/watch path.
- PR-2 locks the generated-contract freeze for PR-3+ (canonical path, `app-id` derivation, resolver contract, schema version, and failure signatures).
- PR-2 closes with generated-contract + orchestration implementation combined (no PR-2A/PR-2B split), leaving runtime helper cutover for PR-3.
- E2E targets prove mixed TS+wasm module edits in one session on the orchestrated path.

### Risks

Running multiple watchers can increase orchestration complexity and failure triage effort.

### Mitigation

Keep per-module queues isolated, logs structured, concurrency bounded, lifecycle control centralized, and manifest generation deterministic with explicit input contracts.

### Consequence of Not Implementing

Multiple modules require manual scripts and cannot be maintained as a clean default path.

### Downsides for Implementing

Orchestration code becomes a critical path and needs strict test coverage.

### Recommendation

Implement second to make the module contracts operational in dev sessions.

PR-2 delivery policy:

1. Combine generated-manifest contract generation and multi-module watcher orchestration in one PR-2 implementation.
2. Keep PR-3 focused on runtime helper cutover and template runtime migration.

---

## PR-3: Template migration to multi-module contracts for static and SSR Vite

### Description

I will migrate template runtime wiring to consume generated wasm and TS module contracts across `ts/webapp-static` and `ts/webapp-ssr-vite`.

### Scope & Changes

- Update static and SSR Vite runtime helpers to load wasm by module key through generated helper and generated manifest artifacts.
- Update static and SSR Vite runtime helpers to load TS modules by module key through generated helper and generated manifest artifacts.
- Make generated artifacts authoritative for runtime helper reads in static and SSR Vite (completes runtime helper cutover begun by PR-2 dev/watch path).
  - Note (intentionally refined in PR-9): canonical authority remains generated artifacts, with framework-local generated projections allowed where runtime import mechanics require them.
- Remove hardcoded single-path assumptions in static and SSR Vite runtime code and scripts.
- Ensure SSR Vite server parity paths for each wasm module are staged consistently.
- Ensure SSR Vite client and server paths can resolve TS modules by module key.
- Keep template files within size and separation constraints by splitting helpers where needed.

### Tests (in this PR)

- Extend template-specific E2E contract tests for:
  - static multi-module wasm and TS usage
  - SSR Vite multi-module wasm and TS usage (client + server)
- Add per-module-key E2E edit-cycle tests:
  - for each declared/generated key from fixture `TARGETS` + `package.json` inputs, assert static and SSR Vite updates where applicable
  - combined TS module edit + wasm module A edit + wasm module B edit in one dev session
  - no process restart, deterministic output updates
- Keep existing HMR no-restart assertions in migrated tests.

### Docs (in this PR)

- Update static and SSR Vite docs to show module-key usage through generated helpers for wasm and TS.
- Update static and SSR Vite docs to call out canonical generated contract paths and resolver usage.
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
- Dependency growth in static and SSR Vite requires only existing `TARGETS`/`package.json` updates, not manual manifest edits.
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

- Update SSR Next runtime helpers to load wasm by module key through generated helper and generated manifest artifacts.
- Update SSR Next runtime helpers to load TS modules by module key through generated helper and generated manifest artifacts.
- Make generated artifacts authoritative for runtime helper reads in SSR Next parity with static and SSR Vite.
  - Note (intentionally refined in PR-9): canonical authority remains generated artifacts, with framework-local generated projections allowed where runtime import mechanics require them.
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
- Update SSR Next docs to call out canonical generated contract paths and resolver usage.
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
- Dependency growth in SSR Next requires only existing `TARGETS`/`package.json` updates, not manual manifest edits.
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
  - Note (intentionally superseded by PR-9 sequencing): this closeout objective is finalized in PR-9, where remaining legacy watcher flags and `top.wasm` compatibility bridge behavior are removed and policy-locked.

### Tests (in this PR)

- Add/extend policy contract tests that fail on new hardcoded single-module runtime assumptions in active template code.
- Run full in-scope matrix:
  - static, SSR Vite, SSR Next
  - TS local + TS workspace + wasm multi-module + combined cycle targets
  - per-module-key SSR client/server target checks
- Add targeted deterministic diagnostics tests for multi-module failure triage output.
- Add explicit final goal-validation tests:
  - add a new TS dependency entry through fixture `package.json`, run dev, assert client/server updates with no app-entrypoint edits
  - add a new wasm dependency wiring through fixture `TARGETS`, run dev, assert client/server updates with no app-entrypoint edits
  - add mixed TS+wasm dependencies together in one fixture, run one dev session, assert both update paths without extra boilerplate edits

### Docs (in this PR)

- Update docs to present final Phase 5 contracts as canonical behavior.
- Remove outdated single-module implementation guidance from active docs.
- Remove/forbid guidance that implies source-tree manifest edits are required for dependency growth.
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
- `buck2 test //:scaffolding_webapp_multi_module_generated_manifest_contract`
- `buck2 test //:scaffolding_webapp_multi_module_contract_path_resolver_contract`
- `buck2 test //:scaffolding_webapp_multi_module_no_source_manifest_dependency_contract`
- `buck2 test //:scaffolding_webapp_multi_template_parity_contract`
- `buck2 test //:scaffolding_webapp_phase5_final_goal_validation_contract`
- `buck2 test //:scaffolding_webapp_phase5_final_goal_validation_static_contract`
- `buck2 test //:scaffolding_webapp_phase5_final_goal_validation_ssr_next_contract`
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
- Final E2E matrix proves dependency growth requires only `TARGETS` and `package.json` updates and does not require manual manifest edits.

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

## PR-6: Producer-surface contracts + root-set discovery plumbing

### Description

I will introduce one deterministic producer-surface contract that language macros can export, then wire webapp module-contract generation to consume those surfaces so app/importer developers do not need per-file `TARGETS` edits as module files grow.

### Scope & Changes

- Define one macro-level producer surface contract for modules:
  - producer surfaces declare language-owned source roots and runtime artifact mapping hints
  - consumers (webapp scaffolding/dev/build) do not infer module paths ad hoc
  - contract is generated-authoritative and deterministic
- Add one shared provider symbol in PR-6:
  - `ModuleSurfaceInfo` (new, additive) exported by producer macros/targets
  - includes deterministic fields for module kind, declared source roots, runtime mapping policy, and watch hints
- Add root-set declarations (not per-file declarations) for module growth:
  - app/dependency `TARGETS` declare root sets once
  - module files under declared roots are discovered automatically
  - no per-module `TARGETS` edit required after root-set declaration
- Keep naming language-specific at macro boundaries:
  - language macros expose attrs that match language conventions
  - shared contract normalization happens internally in dev/build tooling
- Keep generated-only runtime authority:
  - runtime helpers read generated contracts from canonical path only
  - no source-manifest fallback behavior
  - Note (intentionally refined in PR-9): "canonical path only" is interpreted as canonical generated authority, while framework-local generated projections remain allowed when required by template runtime loading.
- Add deterministic module-key derivation and collision policy:
  - module key derives from normalized path relative to declared root set
  - duplicate keys fail fast with stable diagnostics
  - ordering is stable and test-locked
- Add ergonomic dependency label normalization for surface deps (Node staging boundary):
  - keep `module_surface_deps` for explicit surface target labels
  - add optional `module_deps` shorthand for producer targets (for example `//pkg` or `//pkg:target`)
  - when `module_deps` entry omits `:target`, normalize to Buck-style default target (`//pkg:<pkg-basename>`)
  - infer surface label as `<normalized-target> + "__surface"` and fail fast when missing
  - conventional surfaces use `__surface`; non-standard producers remain supported via explicit `module_surface_deps`

### Execution Plan (within PR-6)

- Implement in two internal milestones (single PR, one merge gate):
  - Milestone A: `ModuleSurfaceInfo` provider + producer macro export plumbing across existing wasm/ts macro families.
  - Milestone B: `node_asset_stage` ergonomics (`module_deps` normalization/inference), deterministic diagnostics, docs/tests lock-in.
- Add an internal readiness checkpoint between Milestone A and B:
  - proceed to Milestone B only after provider parity and root-set discovery tests are stable.
- Split PR-6 further only if stabilization risk appears:
  - macro/provider plumbing expands beyond expected touch map,
  - label normalization/inference logic grows non-trivial edge-case handling,
  - deterministic diagnostics or cross-language parity tests become unstable.

Starlark contract sketch (shape only, additive in PR-6):

```python
# language macro family exports one producer surface provider
ModuleSurfaceInfo = provider(fields = [
    "module_kind",                # "ts" | "wasm"
    "source_roots",               # list of declared roots (repo-relative)
    "artifact_mapping_policy",    # deterministic runtime dest mapping policy id
    "watch_hints",                # source roots/watch hints for incremental dev loops
])

def _module_surface_impl(ctx):
    return [
        DefaultInfo(),
        ModuleSurfaceInfo(
            module_kind = ctx.attrs.module_kind,
            source_roots = ctx.attrs.source_roots,
            artifact_mapping_policy = ctx.attrs.artifact_mapping_policy,
            watch_hints = ctx.attrs.watch_hints,
        ),
    ]
module_surface = rule(
    impl = _module_surface_impl,
    attrs = {
        "module_kind": attrs.string(),
        "source_roots": attrs.list(attrs.string()),
        "artifact_mapping_policy": attrs.string(),
        "watch_hints": attrs.list(attrs.string()),
    },
)

load("//build-tools/go:defs.bzl", _base_nix_go_tiny_wasm_lib = "nix_go_tiny_wasm_lib")

def nix_go_tiny_wasm_lib(name, srcs = [], go_source_roots = ["."], **kwargs):
    # existing symbol retained; PR-6 adds optional metadata companion target
    _base_nix_go_tiny_wasm_lib(name = name, srcs = srcs, **kwargs)
    module_surface(
        name = name + "__surface",
        module_kind = "wasm",
        source_roots = go_source_roots,
        artifact_mapping_policy = "go-tiny-wasm-v1",
        watch_hints = go_source_roots,
        visibility = ["//visibility:public"],
    )
```

Generated-contract normalization sketch:

```ts
type NormalizedSurface = {
  moduleKind: "ts" | "wasm";
  sourceRoots: string[];
  watchHints: string[];
  mappingPolicy: string;
};

// Consume provider data from graph/planner export, not ad hoc path probing.
const surfaces: NormalizedSurface[] = readProducerSurfacesFromGraph(node);
```

Implementation-oriented pseudo-code sketches by existing macro family:

Notes:

1. These sketches show an additive forwarding pattern. They are not copy-paste into current files without corresponding load/rename refactors.
2. Existing public macro names remain stable. New behavior is additive through companion `__surface` targets and new optional attrs.

```python
# build-tools/go/defs.bzl forwarding pattern (existing symbol retained)
load("//build-tools/go:defs.bzl", _base_nix_go_tiny_wasm_lib = "nix_go_tiny_wasm_lib")

def nix_go_tiny_wasm_lib(name, srcs = [], go_source_roots = ["."], **kwargs):
    _base_nix_go_tiny_wasm_lib(name = name, srcs = srcs, **kwargs)
    module_surface(
        name = name + "__surface",
        module_kind = "wasm",
        source_roots = go_source_roots,
        artifact_mapping_policy = "go-tiny-wasm-v1",
        watch_hints = go_source_roots,
        visibility = ["//visibility:public"],
    )
```

```python
# build-tools/cpp/wasm_defs.bzl forwarding pattern (existing symbol retained)
load("//build-tools/cpp:wasm_defs.bzl", _base_nix_cpp_wasm_static_lib = "nix_cpp_wasm_static_lib")

def nix_cpp_wasm_static_lib(name, srcs = [], cpp_source_roots = ["."], **kwargs):
    _base_nix_cpp_wasm_static_lib(name = name, srcs = srcs, **kwargs)
    module_surface(
        name = name + "__surface",
        module_kind = "wasm",
        source_roots = cpp_source_roots,
        artifact_mapping_policy = "cpp-static-wasm-v1",
        watch_hints = cpp_source_roots,
        visibility = ["//visibility:public"],
    )
```

```python
# build-tools/python/defs_wasm.bzl forwarding pattern (existing symbols retained)
load("//build-tools/python:defs_wasm.bzl", _base_nix_python_wasm_app = "nix_python_wasm_app", _base_nix_python_wasm_lib = "nix_python_wasm_lib")

def nix_python_wasm_app(name, srcs = [], python_source_roots = ["."], **kwargs):
    _base_nix_python_wasm_app(name = name, srcs = srcs, **kwargs)
    module_surface(
        name = name + "__surface",
        module_kind = "wasm",
        source_roots = python_source_roots,
        artifact_mapping_policy = "python-wasm-app-v1",
        watch_hints = python_source_roots,
        visibility = ["//visibility:public"],
    )

def nix_python_wasm_lib(name, srcs = [], python_source_roots = ["."], **kwargs):
    _base_nix_python_wasm_lib(name = name, srcs = srcs, **kwargs)
    module_surface(
        name = name + "__surface",
        module_kind = "wasm",
        source_roots = python_source_roots,
        artifact_mapping_policy = "python-wasm-lib-v1",
        watch_hints = python_source_roots,
        visibility = ["//visibility:public"],
    )
```

```python
# build-tools/node/defs.bzl / defs_stage.bzl forwarding pattern (existing symbols retained)
load("//build-tools/node:defs.bzl", _base_node_webapp = "node_webapp")
load("//build-tools/node:defs.bzl", _base_node_asset_stage = "node_asset_stage")
load("//build-tools/node:defs.bzl", _base_nix_node_lib = "nix_node_lib")

def node_webapp(name, ts_module_roots = ["src"], **kwargs):
    _base_node_webapp(name = name, **kwargs)
    module_surface(
        name = name + "__ts_surface",
        module_kind = "ts",
        source_roots = ts_module_roots,
        artifact_mapping_policy = "node-ts-v1",
        watch_hints = ts_module_roots,
        visibility = ["//visibility:public"],
    )

def node_asset_stage(
        name,
        app,
        assets = [],
        wasm_module_roots = [],
        module_deps = [],
        module_surface_deps = [],
        **kwargs):
    kw = dict(kwargs)
    base_deps = kw.pop("deps", []) or []
    inferred_surface_deps = infer_surface_labels_from_module_deps(module_deps)
    all_surface_deps = dedupe_labels(inferred_surface_deps + module_surface_deps)
    _base_node_asset_stage(
        name = name,
        app = app,
        assets = assets,
        deps = base_deps + all_surface_deps,
        **kw
    )
    if len(wasm_module_roots) > 0:
        module_surface(
            name = name + "__wasm_surface",
            module_kind = "wasm",
            source_roots = wasm_module_roots,
            artifact_mapping_policy = "node-wasm-stage-v1",
            watch_hints = wasm_module_roots,
            visibility = ["//visibility:public"],
        )
```

```python
# dependency-owned TS surface (existing symbol retained)
def nix_node_lib(name, ts_module_roots = ["src"], **kwargs):
    _base_nix_node_lib(name = name, **kwargs)
    module_surface(
        name = name + "__surface",
        module_kind = "ts",
        source_roots = ts_module_roots,
        artifact_mapping_policy = "node-ts-lib-v1",
        watch_hints = ts_module_roots,
        visibility = ["//visibility:public"],
    )
```

```python
# label normalization/inference sketch for node_asset_stage ergonomics
def _normalize_module_dep_label(dep):
    # :local -> //current/package:local
    if dep.startswith(":"):
        return "//%s:%s" % (native.package_name(), dep[1:])
    # //pkg -> //pkg:<pkg-basename>
    if dep.startswith("//") and ":" not in dep:
        pkg = dep[2:]
        pkg_base = pkg.split("/")[-1]
        return "%s:%s" % (dep, pkg_base)
    # //pkg:target stays as-is
    return dep

def _surface_label_for_module_dep(dep):
    normalized = _normalize_module_dep_label(dep)
    pkg, target = split_abs_label(normalized)  # helper: returns ("projects/libs/x", "foo")
    return "//%s:%s__surface" % (pkg, target)
```

```python
# app TARGETS (importer consumes existing symbols + additive attrs)
node_webapp(
    name = "app_raw",
    ts_module_roots = ["src/ts-modules"],
)

node_asset_stage(
    name = "app",
    app = ":app_raw",
    assets = [],
    wasm_module_roots = ["src/wasm-producer"],
    module_deps = [
        "//projects/libs/math-wasm",         # normalized to :math-wasm -> :math-wasm__surface
        "//projects/libs/vision-wasm:wasm",  # explicit producer target -> :wasm__surface
    ],
    module_surface_deps = [
        "//projects/libs/special:runtime_surface_override",  # explicit non-standard override
        "//projects/libs/demo-lib:demo_lib__surface",
    ],
    out = "dist",
)
```

Additive attribute map (introduced in PR-6):

| Macro                     | New attr              | Meaning                                                                     |
| ------------------------- | --------------------- | --------------------------------------------------------------------------- |
| `node_webapp`             | `ts_module_roots`     | App-local TS source roots for surface export                                |
| `node_asset_stage`        | `wasm_module_roots`   | App-local wasm producer source roots for surface export                     |
| `node_asset_stage`        | `module_deps`         | Ergonomic producer deps (`//pkg` or `//pkg:target`) inferred to `__surface` |
| `node_asset_stage`        | `module_surface_deps` | Explicit dependency surface targets consumed for discovery/watch            |
| `nix_go_tiny_wasm_lib`    | `go_source_roots`     | Go-owned source roots used for wasm module surface                          |
| `nix_cpp_wasm_static_lib` | `cpp_source_roots`    | C++-owned source roots used for wasm module surface                         |
| `nix_python_wasm_app`     | `python_source_roots` | Python-owned source roots used for wasm module surface                      |
| `nix_python_wasm_lib`     | `python_source_roots` | Python-owned source roots used for wasm module surface                      |
| `nix_node_lib`            | `ts_module_roots`     | Dependency-owned TS source roots used for TS surface                        |

### Tests (in this PR)

- Add producer-surface contract tests:
  - provider fields are present and deterministic for supported macro families
  - python wasm app/lib macro families both publish the same provider shape
  - contract export shape is stable across static, SSR Vite, SSR Next fixture apps
  - source-root declarations are consumed by generator without per-file `TARGETS` wiring
- Add root-set discovery unit/integration tests:
  - recursive discovery under declared roots picks up new files automatically
  - module-key derivation is deterministic and collision-safe
  - unchanged files do not trigger manifest rewrites
- Add dependency-label ergonomics tests:
  - `module_deps = ["//pkg"]` normalizes to Buck-style default target and infers `//pkg:<pkg-basename>__surface`
  - `module_deps = ["//pkg:custom"]` infers `//pkg:custom__surface`
  - missing inferred surface fails with deterministic diagnostic that prints normalized and inferred labels
  - explicit `module_surface_deps` supports non-standard surface labels
- Add generated-authority tests:
  - runtime helper reads fail when generated contracts are missing/invalid
  - source-only manifest presence does not satisfy runtime helper contract

### Docs (in this PR)

- Document producer-surface contract fields and ownership boundaries.
- Document root-set declaration model and no-per-file-edit growth policy.
- Document deterministic key-derivation and collision behavior.
- Document `module_deps` shorthand normalization and explicit override path via `module_surface_deps`.

### Verification Commands

- `buck2 test //:scaffolding_webapp_multi_module_contract_path_resolver_contract`
- `buck2 test //:scaffolding_webapp_multi_module_generated_manifest_contract`
- `buck2 test //:scaffolding_webapp_multi_module_no_source_manifest_dependency_contract`
- `buck2 test //:scaffolding_webapp_producer_surface_contract`
- `buck2 test //:scaffolding_webapp_root_set_discovery_contract`
- `buck2 test //:scaffolding_webapp_module_dep_label_normalization_contract`
- `buck2 test //:scaffolding_webapp_macro_api_parity_contract`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`

### Acceptance Criteria

- Producer surfaces are exported by language macros and consumed by generator tooling.
- Root-set declarations eliminate per-file `TARGETS` edits for module additions.
- Runtime helper contract is generated-only with deterministic failure signatures.
- Docs and tests lock the producer-surface + root-set model in the same PR.
- Existing wasm macro families (Go/C++/Python/Node) expose `ModuleSurfaceInfo` without breaking current callsites.
- `module_deps` shorthand supports colon-optional labels while preserving explicit `module_surface_deps` overrides.

### Risks

Provider/export contract drift between macros and generator can break discovery in subtle ways.

### Mitigation

Lock provider fields with dedicated contract tests and keep one normalization path in shared tooling.

### Consequence of Not Implementing

Module discovery remains ad hoc, per-file wiring pressure persists, and scaling to multi-language producers stays fragile.

### Downsides for Implementing

Adds a new contract surface between macros and tooling that must be maintained with strict parity tests.

### Recommendation

Implement sixth to establish deterministic producer-surface plumbing before final zero-edit growth lock-in.

---

## PR-7: Zero-edit module growth + efficient watch invalidation + zero-wasm default lock-in

### Description

I will finalize the developer experience so new TS/wasm files under declared canonical roots are picked up automatically (app-owned and dependency-owned), watched for HMR updates, and staged without importer/app per-file edits.

### Scope & Changes

- Finalize zero-edit growth behavior:
  - adding a new module file under declared canonical roots requires no app/importer `TARGETS` edits
  - dependency packages do not manage module index files
  - importer runtime wiring remains unchanged
- Finalize dependency wiring ergonomics for importer callsites:
  - allow `module_deps` short labels (`//pkg` and `//pkg:target`) in `node_asset_stage`
  - infer `__surface` labels from normalized producer labels
  - keep `module_surface_deps` for explicit non-standard surface targets
- Support app-owned and dependency-owned module updates in one session:
  - watcher subscribes to normalized source roots + watch hints from producer surfaces
  - module updates remain module-scoped with deterministic queue behavior
  - no process restart for in-scope edit loops
  - Note (intentionally extended in PR-8): PR-7 establishes restart-free edit loops for already enrolled module sets; PR-8 adds in-session refresh/enrollment for module-set changes discovered during the same running session.
- Lock zero-wasm defaults across templates:
  - newly scaffolded webapps can run with no wasm modules declared
  - watcher path behaves as no-op when wasm set is empty
  - packaging paths remain valid for zero or many wasm modules
- Keep path consistency without forcing redundant directory layers:
  - runtime-relative module destinations use one contract shape (`wasm/<module>.wasm`)
  - template build roots map consistently by framework packaging needs

App/developer-facing snippet (no per-file additions after roots are declared).
Uses existing symbols with additive attrs introduced in PR-6:

```python
node_webapp(
    name = "app_raw",
    # new optional attr in PR-6; existing symbol retained
    ts_module_roots = ["src/ts-modules"],
)

node_asset_stage(
    name = "app",
    app = ":app_raw",
    # existing path still supported
    assets = [],
    # new optional attrs in PR-6; existing symbol retained
    wasm_module_roots = ["src/wasm-producer"],
    module_deps = [
        "//projects/libs/math-wasm",
        "//projects/libs/feature-wasm:wasm",
    ],
    module_surface_deps = [
        "//projects/vendor/nonstandard:runtime_surface_v2",
        "//projects/libs/demo-lib:demo_lib__surface",
    ],
    out = "dist",
)
```

Source growth snippet:

```text
# no TARGETS edit needed
src/ts-modules/new_feature.ts
src/wasm-producer/image_filter.cpp
```

### Tests (in this PR)

- Add zero-edit growth E2E tests:
  - add new TS file under declared root, assert contract + runtime pickup with no `TARGETS` edit
  - add new wasm source file under declared root, assert contract + staged runtime pickup with no `TARGETS` edit
  - run mixed app-owned + dependency-owned updates in one session
- Add dependency-declaration ergonomics tests:
  - `module_deps = ["//pkg"]` resolves to default target and inferred `__surface`
  - explicit `:target` in `module_deps` resolves to matching `:target__surface`
  - explicit `module_surface_deps` entries permit non-standard surface target names
- Add watch/invalidation efficiency tests:
  - unchanged files do not trigger rebuild/sync events
  - unrelated files outside declared roots do not trigger rebuild/sync
  - touching non-module files (for example `README.md`) keeps generated manifest contents and mtime unchanged
  - only changed module keys emit `[wasm-watch] rebuild:start` markers
  - queue fairness and module-scoped markers remain deterministic
- Add zero-wasm default E2E tests for static, SSR Vite, SSR Next:
  - scaffold -> install -> dev/build paths are green with empty wasm set
  - add first wasm module from zero baseline without app/importer wiring changes

### Docs (in this PR)

- Document canonical root conventions per template family.
- Document zero-edit growth workflow for app-owned and dependency-owned modules.
- Document watch/invalidation behavior and diagnostics for ignored vs in-scope file changes.
- Document when to use `module_deps` (default ergonomics) vs `module_surface_deps` (explicit override).

### Verification Commands

- `buck2 test //:scaffolding_webapp_zero_wasm_default_static_contract`
- `buck2 test //:scaffolding_webapp_zero_wasm_default_ssr_vite_contract`
- `buck2 test //:scaffolding_webapp_zero_wasm_default_ssr_next_contract`
- `buck2 test //:scaffolding_webapp_zero_wasm_to_multi_wasm_growth_contract`
- `buck2 test //:scaffolding_webapp_multi_module_orchestrator_contract`
- `buck2 test //:scaffolding_webapp_multi_module_concurrency_contract`
- `buck2 test //:scaffolding_webapp_module_surface_dependency_growth_contract`
- `buck2 test //:scaffolding_webapp_phase5_final_goal_validation_contract`
- `buck2 test //:scaffolding_webapp_phase5_final_goal_validation_static_contract`
- `buck2 test //:scaffolding_webapp_phase5_final_goal_validation_ssr_next_contract`
- `buck2 test //:scaffolding_webapp_module_dep_label_normalization_contract`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`

### Acceptance Criteria

- App/importer developers do not edit per-file wiring when adding modules under declared canonical roots.
- Dependency developers do not maintain module index artifacts.
- App-owned and dependency-owned module updates are watched and applied in one running dev session.
- Zero-wasm default behavior is stable across static, SSR Vite, and SSR Next templates.
- Invalidation behavior is efficient and deterministic for in-scope changes only.
- Non-module edits outside declared roots do not rewrite module contracts.
- Module watch logs are key-scoped and only report changed keys.
- Importer deps can use `module_deps` with or without `:target`; explicit `module_surface_deps` remains available for custom/non-standard surfaces.

### Risks

Broad file discovery can cause noisy invalidation if root scoping and ignore policies are not strict.

### Mitigation

Use declared canonical roots only, stable extension filters, and explicit ignore sets with contract tests.

### Consequence of Not Implementing

Developers keep paying per-file wiring cost, and zero-wasm default behavior remains partial or brittle.

### Downsides for Implementing

Requires coordinated updates across watcher, generator, template wiring, and packaging logic.

### Recommendation

Implement seventh as the final Phase 5 DX and performance lock so growth is zero-edit and runtime behavior remains deterministic.

---

## PR-8: In-session contract refresh + strict contract-test enforcement

### Description

I will close remaining in-session growth gaps by making watcher orchestration refresh generated module contracts and watch sets during a running session, while also hard-failing contract tests that currently allow probe failures to pass silently.

### Scope & Changes

- Add generated-contract refresh behavior on the dev/watch path:
  - watcher re-evaluates generated wasm/TS contract artifacts during a running session
  - newly discovered module keys are enrolled without process restart
  - removed module keys are retired deterministically with stable diagnostics
- Add deterministic watch-set refresh triggers:
  - refresh when generated manifest files change
  - refresh when producer-surface graph inputs change
  - preserve module-scoped fairness and queue determinism through refresh cycles
  - keep refresh bounded (fingerprint/mtime gated + throttled) to avoid execution-time regression
- Make dynamic growth behavior explicit in watcher diagnostics:
  - contract refresh markers include added/removed module keys
  - refresh failure signatures are stable and actionable
- Tighten contract-test enforcement:
  - remove any early-return paths that convert failed Buck probes into implicit passes
  - fail fast when required contract probes fail or produce incomplete evidence
- Keep runtime behavior restart-free for in-scope module additions through canonical roots and dependency declarations.

### Tests (in this PR)

- Add/extend watcher refresh contract tests:
  - add new wasm/TS module file during one active dev session and assert pickup without restart
  - add workspace dependency module during one active dev session and assert pickup without restart
  - remove/rename module file and assert deterministic de-registration behavior
- Add/extend concurrency/fairness tests with refresh events:
  - refresh under pending queue load does not violate single-build-at-a-time invariant
  - fairness remains deterministic after dynamic module-set changes
- Add strict contract-test enforcement checks:
  - producer-surface and module-dep normalization contract tests fail when Buck probe fails
  - no silent test pass on probe failure
- Add deterministic negative-path tests:
  - manifest refresh failure emits stable marker and recovery guidance
  - malformed refresh input does not fall back to stale watcher state silently
  - refresh cadence remains bounded under unchanged inputs (no hot-loop re-probe churn)

### Docs (in this PR)

- Document in-session contract refresh semantics and diagnostics.
- Document dynamic module enrollment/removal behavior in one running dev session.
- Document strict contract-test policy (probe failure is a hard failure).
- Update troubleshooting with refresh-specific failure signatures and recovery steps.

### Verification Commands

- `buck2 test //:scaffolding_webapp_multi_module_orchestrator_contract`
- `buck2 test //:scaffolding_webapp_multi_module_concurrency_contract`
- `buck2 test //:scaffolding_webapp_zero_wasm_to_multi_wasm_growth_contract`
- `buck2 test //:scaffolding_webapp_module_surface_dependency_growth_contract`
- `buck2 test //:scaffolding_webapp_producer_surface_contract`
- `buck2 test //:scaffolding_webapp_module_dep_label_normalization_contract`
- `buck2 test //:scaffolding_webapp_phase5_dynamic_refresh_contract`
- `buck2 test //:scaffolding_webapp_phase5_dynamic_refresh_negative_contract`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`

### Acceptance Criteria

- New in-scope TS/wasm modules are discovered and watched in one running dev session with no process restart.
- Dynamic module enrollment/removal keeps queue fairness and module-scoped diagnostics deterministic.
- Contract tests no longer allow Buck probe failures to pass silently.
- Refresh failures produce stable markers and actionable recovery guidance.
- Refresh behavior is deterministic and bounded under steady-state inputs.
- Docs, tests, and watcher behavior are aligned on in-session growth semantics.

### Risks

Refreshing module sets while builds are queued can introduce race conditions or non-deterministic ordering.

### Mitigation

Use explicit refresh boundaries, atomic module-set swaps, and deterministic queue-order assertions in tests.

### Consequence of Not Implementing

Phase 5 continues to miss no-restart growth behavior in real running sessions for some module-addition paths.

### Downsides for Implementing

Watcher/orchestrator logic grows and requires additional deterministic-state testing.

### Recommendation

Implement eighth to make in-session growth behavior operational and test-enforced before final authority/fallback closeout.

---

## PR-9: Generated-authority hard cutover + compatibility bridge removal

### Description

I will complete the Phase 5 closeout by enforcing generated-only runtime authority, removing remaining compatibility/fallback paths, and aligning docs/tests to the final canonical behavior.

### Scope & Changes

- Enforce generated-only runtime contract authority:
  - runtime helpers resolve module contracts from canonical generated outputs via shared resolver
  - framework-local manifest files (for example `app/` or `src/`) are generated projections of canonical outputs, never hand-authored authority
  - remove non-generated/non-authoritative mirror paths and stale-manifest fallbacks
- Remove legacy watcher compatibility paths:
  - remove legacy single-module CLI flag mode from watcher tooling
  - fail fast on legacy flag usage with stable migration diagnostics
- Remove remaining hardcoded compatibility bridges:
  - remove `top.wasm` compatibility symlink/bridge behavior from active dev paths (including Next public bridge mode)
  - keep canonical module-key/runtime-destination authority in generated manifests; remove docs guidance that treats bridge behavior as required
- Lock policy tests that prevent regression:
  - no new hand-authored source-manifest authority paths
  - no new legacy single-module watcher fallback wiring
  - no new hardcoded `top.wasm` compatibility bridge assumptions in active templates/dev scripts

### Tests (in this PR)

- Add generated-authority runtime tests:
  - runtime helper authority is canonical generated contracts (directly or via generated projection)
  - non-generated/source-authored manifest presence does not alter authority behavior
- Add legacy-removal negative-path tests:
  - legacy watcher flag invocation fails with stable migration message
  - compatibility symlink assumptions are absent from active dev path tests
- Extend hardcoded-path policy tests:
  - fail on reintroduced `top.wasm` hardcoded assumptions in active runtime helpers/scripts/docs
- Re-run full final matrix with authority/fallback checks included:
  - static, SSR Vite, SSR Next
  - mixed TS+wasm growth and per-module-key client/server behavior

### Docs (in this PR)

- Update docs to declare canonical generated-contract authority as the only supported runtime source.
- Remove compatibility wording that implies source-tree manifests or `top.wasm` bridges are required.
- Document migration guidance for removed legacy watcher flags.
- Publish final closeout notes for Phase 5 authority/fallback policy lock.

### Verification Commands

- `buck2 test //:scaffolding_webapp_multi_module_no_source_manifest_dependency_contract`
- `buck2 test //:scaffolding_webapp_phase5_hardcoded_runtime_path_policy_contract`
- `buck2 test //:scaffolding_webapp_phase5_final_goal_validation_contract`
- `buck2 test //:scaffolding_webapp_phase5_final_goal_validation_static_contract`
- `buck2 test //:scaffolding_webapp_phase5_final_goal_validation_ssr_next_contract`
- `buck2 test //:scaffolding_webapp_phase5_generated_authority_runtime_contract`
- `buck2 test //:scaffolding_webapp_phase5_legacy_flag_removal_contract`
- `buck2 test //:scaffolding_webapp_phase5_top_wasm_bridge_removal_contract`
- `buck2 test //:scaffolding_webapp_multi_template_parity_contract`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`

### Acceptance Criteria

- Runtime helper authority is canonical generated contracts only.
- Active templates may consume framework-local generated projections, but correctness does not rely on hand-authored or stale source-tree manifests.
- Legacy single-module watcher flags and compatibility `top.wasm` bridge behavior are removed from active paths.
- Policy tests block reintroduction of removed fallback/compatibility behaviors.
- Docs, tests, and runtime behavior are consistent with final generated-authority contracts.
- Phase 5 reaches checkpoint `READY` for PR-10 closeout.

### Risks

Removing compatibility behavior can expose hidden consumers still relying on transitional paths.

### Mitigation

Add explicit negative-path tests, stable migration diagnostics, and one final full matrix run in the same PR.

### Consequence of Not Implementing

Phase 5 remains partially transitional, with ambiguous authority and fallback paths that can hide regressions.

### Downsides for Implementing

Closeout touches runtime helpers, watcher tooling, tests, and docs simultaneously and needs careful stabilization.

### Recommendation

Implement ninth as the generated-authority and compatibility-bridge closeout gate that makes PR-10 the final strict runtime-path completion step.

---

## PR-10: Runtime-path canonicalization closeout + strict policy coverage completion

### Description

I will close the remaining Phase 5 gaps by removing residual hardcoded legacy runtime path assumptions, eliminating multi-candidate fallback probing in active helper/test surfaces, and extending policy tests/docs so canonical runtime paths are enforced consistently across runtime, planner, and test helper boundaries.

### Scope & Changes

- Canonicalize server/runtime wasm artifact references across active paths:
  - explicitly close residual legacy-path assumptions in:
    - `build-tools/tools/lib/runnables.ts`
    - `build-tools/tools/nix/planner/manifest.nix`
    - `build-tools/tools/tests/lib/ssr-scaffold-build.ts`
    - `build-tools/tools/tests/scaffolding/webapp.multi-module.manifest.contract.test.ts`
  - remove residual hardcoded `server/wasm-contract/top.wasm` assumptions in runnable/planner helper surfaces
  - align runtime/planner artifact metadata with canonical runtime-destination contracts used by generated manifests
  - keep generated-authority contracts as the only source of truth for path selection
- Remove fallback-style multi-candidate path probing from active helper/test surfaces:
  - replace "try many candidate locations" behavior with strict canonical-path assertions
  - fail fast with stable diagnostics when canonical runtime artifacts are missing
  - avoid compatibility probing that can mask primary-path regressions
- Extend policy coverage for hardcoded runtime-path regressions:
  - include runnable/planner metadata paths and scaffold helper surfaces in policy checks
  - add explicit negative checks for reintroduction of `server/wasm-contract/top.wasm` assumptions in active runtime/planner paths
  - keep top-wasm bridge-removal policy checks while broadening path-canonicalization coverage
- Wire new/updated tests into canonical target metadata in the same PR:
  - update `build-tools/tools/tests/template_conventions.bzl` mappings for any new Phase 5 closeout tests
  - keep verification commands and generated test target wiring aligned
- Final docs alignment for canonical runtime destinations:
  - update architecture/docs examples to match canonical runtime path behavior
  - remove stale examples that still describe transitional runtime locations

### Tests (in this PR)

- Add canonical-runtime-path contract tests:
  - runnable/planner contract generation emits canonical server wasm runtime path metadata
  - scaffold SSR/static helper paths assert canonical runtime location only (no candidate fallback set)
- Extend hardcoded-path policy tests:
  - fail on reintroduced `server/wasm-contract/top.wasm` assumptions in active runtime/planner/helper surfaces
  - fail on reintroduced multi-candidate runtime probing in active helper/test contract surfaces
- Keep final matrix coverage with canonical-path assertions enabled:
  - static, SSR Vite, SSR Next
  - mixed TS+wasm growth and per-module-key client/server behavior
- Add test wiring/metadata coverage checks:
  - new PR-10 contract tests are discoverable through canonical target wiring conventions
  - template/test metadata contract checks remain green after PR-10 additions

### Docs (in this PR)

- Update runtime-path references in build-system/scaffolding docs to canonical generated-authority behavior.
- Document strict canonical-path policy for runtime/planner/helper surfaces (no compatibility probing).
- Record migration notes for removing residual hardcoded legacy runtime path assumptions.

### Verification Commands

- `buck2 test //:scaffolding_webapp_phase5_hardcoded_runtime_path_policy_contract`
- `buck2 test //:scaffolding_webapp_phase5_generated_authority_runtime_contract`
- `buck2 test //:scaffolding_webapp_phase5_top_wasm_bridge_removal_contract`
- `buck2 test //:scaffolding_webapp_phase5_runtime_path_canonicalization_contract`
- `buck2 test //:scaffolding_webapp_phase5_runtime_path_fallback_probe_removal_contract`
- `buck2 test //:scaffolding_webapp_phase5_final_goal_validation_contract`
- `buck2 test //:scaffolding_webapp_phase5_final_goal_validation_static_contract`
- `buck2 test //:scaffolding_webapp_phase5_final_goal_validation_ssr_next_contract`
- `buck2 test //:scaffolding_webapp_multi_template_parity_contract`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`

### Acceptance Criteria

- Active runtime/planner/helper surfaces no longer hardcode legacy `server/wasm-contract/top.wasm` runtime assumptions.
- Active helper/test contract surfaces no longer rely on multi-candidate fallback probing for runtime wasm path selection.
- Policy tests block reintroduction of hardcoded legacy runtime paths and fallback probing in active paths.
- Docs, tests, and runtime/planner metadata are consistent with canonical generated-authority runtime destinations.
- Phase 5 reaches final `COMPLETED` checkpoint.

### Phase 5 Final Closure Checklist (PR-10 merge gate)

PR-10 is not complete unless every item below is explicitly confirmed in the PR description/checklist:

1. Runtime/planner path closure:
   - no active runtime/planner/helper surface hardcodes legacy `server/wasm-contract/top.wasm` assumptions
   - canonical runtime-destination behavior is used consistently in active paths
2. Fallback/probe closure:
   - no active helper/test contract surface relies on multi-candidate runtime path probing
   - canonical-path failures are fail-fast with stable diagnostics
3. Policy-test closure:
   - policy tests cover runtime + planner + helper/doc surfaces for hardcoded legacy path reintroduction
   - policy tests cover fallback-probe reintroduction
4. Matrix closure:
   - final Phase 5 matrix targets are green with canonical-path and policy assertions enabled
   - static, SSR Vite, and SSR Next parity is preserved under the same assertions
5. Documentation closure:
   - `docs/build-history/hmr-phase-5.md`, `build-tools/docs/build-system-design.md`, and scaffolding/runtime docs describe the same canonical behavior
   - no active docs describe transitional/compatibility runtime locations as canonical
6. Final audit closure:
   - one final read-only implementation-vs-plan audit reports no remaining behavior/policy/test/doc gaps for Phase 5
   - if any implementation-affecting gap remains, it must be absorbed into PR-10 before Phase 5 can be marked `COMPLETED`

### Risks

Tightening canonical-path assertions can expose hidden consumers still depending on transitional runtime path assumptions.

### Mitigation

Use explicit fail-fast diagnostics, targeted negative-path policy tests, and one final full matrix rerun in the same PR.

### Consequence of Not Implementing

Phase 5 remains partially transitional in runtime-path behavior, with residual hardcoded/fallback assumptions that can hide regressions.

### Downsides for Implementing

Closeout requires coordinated updates across runtime/planner helpers, policy tests, and docs to keep strict behavior consistent.

### Recommendation

Implement tenth as the final Phase 5 strictness and consistency closeout for canonical runtime-path behavior.

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
- generated manifest contract modules and deterministic input mapping (`TARGETS` + `package.json`)
- module-scoped logging and lifecycle handling
- concurrency/fairness controls
- orchestration E2E + stress tests
- orchestration docs and troubleshooting

Expected new/updated target families:

- multi-module orchestrator contract test target(s)
- multi-module concurrency contract test target(s)
- generated-manifest derivation contract target(s)
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

### PR-6 default touch map (producer surfaces + root-set discovery)

Expected focus areas:

- language-macro provider/export paths that publish module surface contract fields
- graph/export/generator modules that normalize producer surfaces into module contracts
- deterministic root-set file discovery and key-derivation modules
- runtime helper read paths that enforce generated-only contract authority
- docs for producer-surface ownership and root-set discovery semantics
- additive macro API extensions on existing symbols:
  - `node_webapp` (`ts_module_roots`)
  - `node_asset_stage` (`wasm_module_roots`, `module_deps`, `module_surface_deps`)
  - wasm producer macros (`go_source_roots` / `cpp_source_roots` / `python_source_roots` metadata emission)

Expected new/updated target families:

- producer-surface contract target(s)
- root-set discovery contract target(s)
- generated-authority contract target(s)

Out-of-bounds by default:

- unrelated template runtime migrations not needed for producer-surface plumbing
- non-deterministic discovery paths that bypass declared root sets

### PR-7 default touch map (zero-edit growth + zero-wasm default lock-in)

Expected focus areas:

- watcher/orchestrator paths that consume normalized root sets and module surfaces
- static, SSR Vite, and SSR Next template wiring for zero-wasm defaults
- packaging/staging logic for zero-or-many wasm modules with consistent runtime-relative destinations
- E2E contract tests for zero-edit module growth and efficient invalidation
- docs for canonical roots, growth workflow, and watch diagnostics

Expected new/updated target families:

- zero-wasm default contract target(s)
- zero-to-multi growth contract target(s)
- watch/invalidation efficiency contract target(s)
- final goal-validation matrix target(s) for zero-edit growth

Out-of-bounds by default:

- new provider/schema directions outside PR-6 contract
- convenience behavior that reintroduces per-file app/importer wiring

### PR-8 default touch map (in-session refresh + strict contract-test enforcement)

Expected focus areas:

- watcher/orchestrator refresh logic for generated contract changes in one running session
- deterministic module-set enrollment/removal and queue coordination
- strict contract-test enforcement where probe failures must fail tests
- dynamic-refresh diagnostics and recovery markers
- docs for in-session refresh semantics

Expected new/updated target families:

- dynamic-refresh watcher contract target(s)
- dynamic-refresh negative-path contract target(s)
- strict probe-enforcement contract target(s)

Out-of-bounds by default:

- generated-authority hard cutover and compatibility bridge removals (reserved for PR-9)
- broad template/runtime rewrites unrelated to refresh correctness

### PR-9 default touch map (generated authority + fallback removal closeout)

Expected focus areas:

- runtime helper authority cutover to canonical generated contracts plus framework-required generated projections
- removal of legacy watcher single-module flag mode
- removal of hardcoded `top.wasm` compatibility bridge behavior (not canonical producer artifact naming)
- policy tests that forbid reintroduction of removed fallback/compatibility paths
- final docs alignment for authority and migration guidance

Expected new/updated target families:

- generated-authority runtime contract target(s)
- legacy-flag removal contract target(s)
- top-wasm bridge removal contract target(s)
- final closeout matrix/policy lock target(s)

Out-of-bounds by default:

- new architecture directions beyond Phase 5 completion criteria
- new compatibility bridges that reintroduce non-authoritative paths

### PR-10 default touch map (runtime-path canonicalization + strict policy completion)

Expected focus areas:

- runtime/planner helper metadata path canonicalization for server wasm artifacts
- removal of fallback-style multi-candidate runtime path probing in active helper/test surfaces
- policy-test expansion for residual hardcoded legacy runtime path assumptions
- docs alignment for final canonical runtime destination behavior

Expected new/updated target families:

- runtime-path canonicalization contract target(s)
- runtime fallback-probe removal contract target(s)
- hardcoded-path policy extension target(s)
- final closeout matrix target(s)

Out-of-bounds by default:

- new architecture directions beyond Phase 5 completion criteria
- compatibility probes/bridges that reintroduce non-canonical runtime path behavior

### Definition of "easy module addition" (harness-level)

A PR set satisfies "easy module addition" when these assertions are green:

1. Add a new TS dependency through fixture `package.json` (for local workspace-linked TS paths).
2. Add a new wasm dependency wiring through fixture `TARGETS`.
3. Run one dev session and observe expected client/server updates for both module types.
4. Do not add module-specific scripts in app `package.json`.
5. Do not add module-specific runtime entrypoint wiring in app code.
6. Do not manually edit wasm/TS manifest files.

If any of the above requires additional edits outside listed touch maps, the engineer should make those edits using best judgment, keep them minimal, and include test coverage in the same PR.
