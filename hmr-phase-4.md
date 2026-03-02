# HMR Phase 4 Implementation Plan - PR Breakdown

This plan covers implementation of Phase 4 from `hmr-plan.md`: regression coverage and docs lock-in, without reopening Phase 2 design decisions.

Each PR includes code, tests, and documentation updates together.

Scope: `ts/webapp-static`, `ts/webapp-ssr-vite`, and `ts/webapp-ssr-next` remain the in-scope templates, and `ts/webapp-ssr-express` removal and migration guidance are finalized.

Non-goals:

- no docs-only PRs
- no tests-only PRs
- no fallback-first behavior that masks primary path defects
- no expansion beyond `ts/webapp-static`, `ts/webapp-ssr-vite`, and `ts/webapp-ssr-next`
- no redesign of canonical producer automation path

Completion criteria:

1. Permanent dev-reload contract coverage for app-local TS edits, workspace-linked TS edits, and wasm-producer edits is enforced in CI for all in-scope templates.
2. Troubleshooting guidance is explicit and tested for stale lock state, watcher build failures, and missing local link configuration.
3. Canonical producer command-path checks are documented and enforced by tests.
4. `ts/webapp-ssr-express` is fully removed and migration to Vite/Next SSR templates is documented and tested.
5. Each functional change in this phase is shipped with tests and docs in the same PR.

Dependency chain:

1. PR-1 establishes shared regression guardrails and deterministic failure contracts.
2. PR-2 applies the guardrails to all in-scope templates and hardens troubleshooting contracts.
3. PR-3 removes deprecated SSR Express path and completes migration and closeout validation.

Phase 4 checkpoints:

- Checkpoint A: `READY` for PR-2 when PR-1 tests and docs contracts are green.
- Checkpoint B: `READY` for PR-3 when PR-2 full matrix is green.
- Checkpoint C: `COMPLETED` for Phase 4 when PR-3 passes and all migration contracts are green.

---

## PR-1: Regression contract foundation and deterministic diagnostics

### Description

I will establish the shared regression contract baseline used by all Phase 4 template validations, with deterministic checks and direct recovery guidance tied to primary path behavior.

### Scope & Changes

- Add shared regression helpers used by template dev-reload tests:
  - deterministic file mutation helpers
  - deterministic process and probe assertions
  - stable failure-signature extraction for triage
- Normalize failure contract checks so each template test asserts:
  - no dev-process restart in the update path
  - deterministic watcher markers for wasm pipeline
  - expected update semantics by change class
- Add stale lock and missing local-link contract checks in shared scaffolding test paths.
- Keep implementation minimal and reusable:
  - prefer existing test utilities
  - only add helpers where current utilities do not cover the contract

### Tests (in this PR)

- Add or extend shared contract tests for:
  - stale lock detection and recovery guidance
  - watcher build-failure signature and recovery command visibility
  - missing local-link detection for workspace dependencies
- Run representative template targets against shared helpers:
  - one static target
  - one SSR Vite target
  - one SSR Next target
- Keep policy gates green:
  - template conventions metadata contract
  - command-path docs contract where touched

### Docs (in this PR)

- Update `hmr-plan.md` and scaffolding docs sections used as canonical contract sources:
  - deterministic failure signatures per change class
  - direct recovery command expectations
  - no-restart and marker requirements as first-class constraints
- Document how shared Phase 4 helpers are intended to be reused in template tests.

### Verification Commands

- `buck2 test //:scaffolding_webapp_phase3_runtime_consistency_policy_contract`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`
- `buck2 test //:scaffolding_webapp_static_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_hmr_local_ts_dep`

### Acceptance Criteria

- Shared regression helpers are in place and used by at least one target in each template family.
- Failure diagnostics for stale lock, watcher failure, and missing local link are deterministic and test-backed.
- Docs and tests express the same contract language and recovery expectations.

### Risks

Shared helper design may become too broad and hide template-specific contract needs.

### Mitigation

Keep helper APIs narrow and require template-specific assertions to remain in template test modules.

### Consequence of Not Implementing

Phase 4 lacks a stable contract baseline and later template hardening becomes duplicated and inconsistent.

### Downsides for Implementing

Initial helper extraction adds short-term refactor effort before full matrix lock-in.

### Recommendation

Implement first to set a deterministic contract baseline for all subsequent Phase 4 work.

---

## PR-2: Full template regression matrix and troubleshooting lock-in

### Description

I will lock the permanent regression matrix across static, SSR Vite, and SSR Next templates so all in-scope change classes are validated with explicit troubleshooting contracts in the same PR.

### Scope & Changes

- Ensure each template has permanent contract coverage for:
  - app-local TypeScript edit behavior
  - workspace-linked TypeScript dependency edit behavior
  - non-TS wasm-producer edit behavior
- Add deterministic troubleshooting checks in template tests for:
  - stale lock state signals
  - watcher rebuild failure and recovery command output
  - missing local-link configuration signals
- Enforce canonical producer command-path expectations in generated template docs and tests.
- Preserve existing behavior:
  - no fallback-first semantics
  - no producer automation redesign

### Tests (in this PR)

- Extend and run full in-scope matrix:
  - `//:scaffolding_webapp_static_dev_hmr_local_ts_dep`
  - `//:scaffolding_webapp_static_dev_reload_wasm_producer`
  - `//:scaffolding_webapp_ssr_vite_dev_hmr_local_ts_dep`
  - `//:scaffolding_webapp_ssr_vite_dev_reload_wasm_producer`
  - `//:scaffolding_webapp_ssr_vite_dev_runtime_consistency_phase3`
  - `//:scaffolding_webapp_ssr_next_dev_hmr_local_ts_dep`
  - `//:scaffolding_webapp_ssr_next_dev_reload_wasm_producer`
  - `//:scaffolding_webapp_ssr_next_dev_runtime_consistency`
- Add or extend targeted troubleshooting contract tests:
  - stale lock contract
  - watcher-failure contract
  - missing local-link contract
- Keep policy/test wiring checks green:
  - template conventions metadata cquery
  - command-path docs contract

### Docs (in this PR)

- Update `build-tools/docs/scaffolding.md` and template-facing docs for permanent Phase 4 matrix:
  - expected behavior by change class
  - recovery commands for stale lock, watcher failure, missing local link
  - canonical producer command-path checks
- Update maintainer guidance for verifying matrix completeness in CI.

### Verification Commands

- `buck2 test //:scaffolding_webapp_static_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_static_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_runtime_consistency_phase3`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_runtime_consistency`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`

### Acceptance Criteria

- All in-scope templates have permanent Phase 4 regression coverage for all change classes.
- Troubleshooting contracts for stale lock, watcher failure, and missing local link are tested and documented.
- Canonical producer command-path contract is validated in tests and present in docs.

### Risks

Matrix breadth can increase CI runtime and make failures slower to triage.

### Mitigation

Keep tests deterministic, reuse shared helpers, and preserve clear failure signatures tied to one change class at a time.

### Consequence of Not Implementing

Regression coverage remains partial and future changes can drift from defined contracts without early detection.

### Downsides for Implementing

More coverage increases ongoing maintenance and CI cost for template test targets.

### Recommendation

Implement second to lock full matrix behavior before deprecating legacy template paths.

---

## PR-3: SSR Express removal, migration contracts, and Phase 4 closeout

### Description

I will complete the deprecated `ts/webapp-ssr-express` removal, ship migration guidance to Vite/Next SSR templates, and lock migration safety with tests in the same PR.

### Scope & Changes

- Remove deprecated `ts/webapp-ssr-express` template and related wiring:
  - template source
  - scaffolding registration and selection points
  - stale references in tests/docs/tooling manifests
- Add migration contract updates:
  - explicit mapping from removed Express SSR path to supported Vite/Next SSR paths
  - command and verification guidance for migration validation
- Keep Phase 4 contract coverage intact after removal:
  - ensure remaining templates still pass matrix and policy checks
  - ensure removed template is not selectable in scaffolding flows

### Tests (in this PR)

- Add or extend removal/migration tests:
  - assert Express SSR template is no longer scaffoldable
  - assert migration guidance references supported replacements
  - assert template conventions and manifests no longer include removed path
- Run post-removal non-regression matrix:
  - static + SSR Vite + SSR Next contract targets
  - policy and docs contract targets touched by migration updates

### Docs (in this PR)

- Update migration and handbook docs:
  - remove Express SSR generation path
  - add supported migration routes to `ts/webapp-ssr-vite` and `ts/webapp-ssr-next`
  - provide verification checklist for migrated projects
- Update `hmr-plan.md` Phase 4 closeout notes to reflect completed removal.

### Verification Commands

- `buck2 test //:scaffolding_webapp_ssr_express_contracts`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`
- `buck2 test //:scaffolding_webapp_static_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_static_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_runtime_consistency_phase3`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_runtime_consistency`

### Acceptance Criteria

- `ts/webapp-ssr-express` is removed from scaffolding and supporting manifests.
- Migration documentation is explicit, test-backed, and points to supported SSR templates.
- Remaining in-scope template matrix and policy contracts remain green after removal.
- Phase 4 checkpoint reaches `COMPLETED`.

### Risks

Template removal can leave orphan references in less-visible tooling paths.

### Mitigation

Use manifest and convention contract tests plus targeted selector tests to catch stale references.

### Consequence of Not Implementing

Deprecated template remains available and conflicts with declared scope and maintenance direction.

### Downsides for Implementing

Removal and migration updates can touch multiple files and require careful synchronization.

### Recommendation

Implement third and treat this PR as Phase 4 closeout gate.

