# Quad Alignment Plan - Close Cross-Language Wiring and Lockfile Contract Gaps - Part 48

This plan closes the gaps identified in the cross-language abstraction review.

Each PR includes code, tests, and documentation updates together.

Scope: prevent bypass of unified wiring, centralize lockfile basenames, and make importer patch
inclusion policy explicit across layers.

Non-goals: no standalone docs-only or tests-only PRs.

Completion criteria: unified wiring cannot be bypassed by macros, lockfile basenames come from a
single registry in Starlark and TypeScript, and importer patch inclusion policy is explicit and
validated across layers.

---

## PR-1: Quarantine legacy wiring helpers and enforce unified entrypoint

### Description

I will move legacy wiring helpers to an internal surface so macros do not call them directly. I will
add an enforcement test that checks macros only call `prepare_language_wiring(...)`.

### Scope & Changes

- Move `lang/package_local_wiring.bzl` and `lang/importer_wiring*.bzl` to an internal namespace and
  update their load paths.
- Keep `lang/language_wiring.bzl:prepare_language_wiring` as the only public macro wiring
  entrypoint.
- Add a test that fails if macro files call internal wiring helpers directly.
- Update `abstractions.md` to mark the internal helpers as implementation details only.

### Tests (in this PR)

- Add an enforcement test under `build-tools/tools/tests/lang/` that scans macro files and asserts they only
  call `prepare_language_wiring(...)`.
- Keep existing parity tests for unified wiring unchanged.

### Docs (in this PR)

- Update `abstractions.md` to state that macros must not load or call internal wiring helpers.

### Acceptance Criteria

- Macro files no longer load internal wiring helpers directly.
- Tests fail if a macro calls internal wiring helpers.
- Unified entrypoint remains the only supported macro wiring surface.

### Risks

Load path changes could break any out-of-tree macros that rely on internal helpers.

### Mitigation

Keep a temporary compatibility alias with a clear failure message that points to the unified
entrypoint.

### Consequence of Not Implementing

Macros can still bypass the contract and reintroduce mutation and ordering drift.

### Downsides for Implementing

Small refactor and a new enforcement test to maintain.

### Recommendation

Implement.

---

## PR-2: Centralize lockfile basenames across Starlark and TypeScript

### Description

I will introduce a single registry for lockfile basenames and use it from Starlark macros and
TypeScript provider sync. This removes repeated string constants and reduces drift risk.

### Scope & Changes

- Add a shared lockfile basename registry:
  - Starlark: `lang/lockfile_contracts.bzl` with `LOCKFILE_BASENAMES_BY_LANG`.
  - TypeScript: `build-tools/tools/lib/lockfile-contracts.ts` with the same mapping.
- Update Node and Python provider sync to use the shared registry.
- Update `lang/lockfile_labels.bzl` default lockfile helpers to use the registry.
- Add a parity test that checks Starlark and TypeScript registries match.
- Update `abstractions.md` to list the new registry as the canonical source.

### Tests (in this PR)

- Add `build-tools/tools/tests/lang/lockfile-contracts.parity.test.ts` to ensure registry parity.
- Add a small provider sync test that asserts the registry is used for basenames.

### Docs (in this PR)

- Update `abstractions.md` to point to the lockfile basename registry and the new parity test.

### Acceptance Criteria

- Lockfile basenames are not repeated in provider sync code.
- Default lockfile label helpers resolve through the registry.
- New parity test passes.

### Risks

Registry introduction could miss an edge case for repo-root lockfiles.

### Mitigation

Add a targeted test for repo-root lockfiles in the parity or provider sync tests.

### Consequence of Not Implementing

Basename drift can occur across layers and cause inconsistent provider behavior.

### Downsides for Implementing

Small amount of new registry code and a parity test to maintain.

### Recommendation

Implement.

---

## PR-3: Make importer patch inclusion policy explicit across layers

### Description

I will surface the importer patch inclusion policy in Starlark and tests so the intentional Node and
Python divergence is clear and enforced at the macro layer.

### Scope & Changes

- Add a Starlark mirror of importer patch inclusion policy, and expose it in a probe rule.
- Update `lang/lang_contracts.bzl` or a new `lang/importer_contracts.bzl` to include:
  - Node: `importer_patch_inclusion = "all"`
  - Python: `importer_patch_inclusion = "effective-set-only"`
- Add a parity test that compares the Starlark policy to
  `build-tools/tools/lib/lang-contracts.ts`.
- Update `abstractions.md` to include a clear section on the policy and why it differs.

### Tests (in this PR)

- Add a parity test under `build-tools/tools/tests/lang/` that compares Starlark and TS policy values.
- Extend provider sync tests to assert the policy is honored for Node and Python.

### Docs (in this PR)

- Update `abstractions.md` with an explicit description of Node and Python patch inclusion policy.

### Acceptance Criteria

- Starlark and TypeScript importer patch inclusion policies match.
- Provider sync behavior remains unchanged and is covered by tests.
- The policy difference is documented and easy to find.

### Risks

Policy duplication could introduce another parity surface if not tested.

### Mitigation

Keep a strict parity test and keep policy definitions minimal.

### Consequence of Not Implementing

The policy remains TS-only and can be missed by macro authors.

### Downsides for Implementing

Additional contract surface and a parity test to maintain.

### Recommendation

Implement.
