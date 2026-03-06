# HMR Phase 4 Implementation Plan - PR Breakdown

This plan covers implementation of Phase 4 from `docs/design-history/hmr-plan.md`: regression coverage and docs lock-in, without reopening Phase 2 design decisions.

Each PR includes code, tests, and documentation updates together.

Scope: `ts/webapp-static`, `ts/webapp-ssr-vite`, and `ts/webapp-ssr-next` remain the in-scope templates, and `ts/webapp-ssr-express` removal is finalized.

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
4. `ts/webapp-ssr-express` is fully removed from scaffolding, tests, and docs.
5. Each functional change in this phase is shipped with tests and docs in the same PR.

Dependency chain:

1. PR-1 establishes shared regression guardrails and deterministic failure contracts.
2. PR-2 applies the guardrails to all in-scope templates and hardens troubleshooting contracts.
3. PR-3 removes deprecated SSR Express path and completes closeout validation.

Phase 4 checkpoints:

- Checkpoint A: `READY` for PR-2 when PR-1 tests and docs contracts are green.
- Checkpoint B: `READY` for PR-3 when PR-2 full matrix is green.
- Checkpoint C: `COMPLETED` for Phase 4 when PR-3 passes and all removal contracts are green.

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

- Update `docs/design-history/hmr-plan.md` and scaffolding docs sections used as canonical contract sources:
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

## PR-3: SSR Express removal and Phase 4 closeout

### Description

I will complete the deprecated `ts/webapp-ssr-express` removal and lock removal safety with tests in the same PR.

### Scope & Changes

- Remove deprecated `ts/webapp-ssr-express` template and related wiring:
  - template source
  - scaffolding registration and selection points
  - stale references in tests/docs/tooling manifests
- Keep Phase 4 contract coverage intact after removal:
  - ensure remaining templates still pass matrix and policy checks
  - ensure removed template is not selectable in scaffolding flows

### Tests (in this PR)

- Add or extend removal tests:
  - assert Express SSR template is no longer scaffoldable
  - assert template conventions and manifests no longer include removed path
- Run post-removal non-regression matrix:
  - static + SSR Vite + SSR Next contract targets
  - policy and docs contract targets touched by removal updates

### Docs (in this PR)

- Update docs to remove Express SSR generation path and references.
- Update `docs/design-history/hmr-plan.md` Phase 4 closeout notes to reflect completed removal.

### Verification Commands

- `buck2 test //:scaffolding_template_conventions_metadata_cquery`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`
- `buck2 test //:scaffolding_webapp_static_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_static_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_runtime_consistency_phase3`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_runtime_consistency`

### Acceptance Criteria

- `ts/webapp-ssr-express` is removed from scaffolding and supporting manifests.
- Remaining in-scope template matrix and policy contracts remain green after removal.
- Phase 4 checkpoint reaches `COMPLETED`.

### Risks

Template removal can leave orphan references in less-visible tooling paths.

### Mitigation

Use manifest and convention contract tests plus targeted selector tests to catch stale references.

### Consequence of Not Implementing

Deprecated template remains available and conflicts with declared scope and maintenance direction.

### Downsides for Implementing

Removal updates can touch multiple files and require careful synchronization.

### Recommendation

Implement third and treat this PR as Phase 4 closeout gate.

---

## PR-4: Phase 4 gap closure for static app-local coverage, docs removal completeness, and execution guardrails

### Description

I will close the remaining Phase 4 contract gaps found in review by adding missing permanent app-local TypeScript regression coverage for `ts/webapp-static`, completing Express-template removal in active docs, and aligning HMR temp-repo tests with execution-time guardrails.

### Scope & Changes

- Add explicit permanent app-local TypeScript edit coverage for `ts/webapp-static`:
  - mutate `src/main.ts` (or equivalent app-local module) in one dev session
  - assert updated output is observed without dev-process restart
  - preserve deterministic checks and existing no-restart invariants
- Keep coverage model aligned with current in-scope templates:
  - no expansion beyond `ts/webapp-static`, `ts/webapp-ssr-vite`, and `ts/webapp-ssr-next`
  - no fallback-first behavior
  - no producer automation redesign
- Complete deprecated `webapp-ssr-express` removal in active implementation docs:
  - remove or reclassify stale command-path guidance that still implies Express SSR scaffold availability
  - preserve historical references only where explicitly archival and not implementation guidance
- Align HMR temp-repo test flows with execution-time guardrails:
  - avoid unnecessary lockfile regeneration in hot test paths when scaffolded lockfiles are already fresh
  - keep deterministic install/build behavior and avoid broad runtime-cost increases

### Tests (in this PR)

- Add or extend static app-local TypeScript dev-reload regression coverage:
  - deterministic app-local edit mutation
  - deterministic output-update assertion
  - deterministic no-restart assertion
- Keep and extend policy contracts where touched:
  - `//:scaffolding_webapp_static_dev_hmr_local_ts_dep`
  - `//:scaffolding_template_conventions_metadata_cquery`
  - `//:scaffolding_ts_command_path_docs_contract`
- Add or extend docs contract checks for active-vs-archival handling when Express references are moved/removed:
  - active docs must not claim scaffold support for removed `webapp-ssr-express`
  - archival docs may retain historical context only when explicitly classified
- Add or extend guardrail-oriented assertions in touched HMR tests:
  - lockfile/install path remains deterministic and bounded for temp-repo runs
  - no new broad install path introduced in template-focused contract tests

### Docs (in this PR)

- Update `docs/design-history/hmr-plan.md` and `build-tools/docs/scaffolding.md` to reflect final Phase 4 completeness:
  - explicit static app-local edit coverage as permanent CI contract
  - explicit statement that deprecated Express SSR scaffold path remains removed
- Update active docs still implying Express template scaffolding:
  - migrate guidance to `webapp-ssr-vite` and `webapp-ssr-next` only
  - preserve historical references only in explicitly archival docs
- Update `docs/handbook/getting-started-on-a-pr.md` references where needed to keep execution-time guardrails and test-path recommendations consistent with actual Phase 4 HMR test practice

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

- `ts/webapp-static` has deterministic permanent app-local TypeScript edit coverage in CI, including no-restart assertion.
- Active implementation docs do not advertise `webapp-ssr-express` scaffold usage.
- Historical Express references are either removed or explicitly classified as archival.
- Touched HMR temp-repo tests align with execution-time guardrails and avoid unnecessary lockfile-regeneration overhead.
- Phase 4 closeout criteria in docs, tests, and troubleshooting contracts are consistent.

### Risks

Additional static app-local coverage can increase test runtime if implemented with non-minimal setup work.

### Mitigation

Reuse existing shared helpers and existing scaffold setup flow, keep mutations narrow and deterministic, and avoid introducing extra install/regeneration phases in hot-path tests.

### Consequence of Not Implementing

Phase 4 remains partially complete against its own completion criteria, leaving avoidable regression and documentation drift risk in an area intended to be locked.

### Downsides for Implementing

This adds another closeout PR and maintenance surface for one more permanent contract test path.

### Recommendation

Implement as the final Phase 4 contract-closure PR before treating Phase 4 as fully complete.
