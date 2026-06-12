# Node Wasm Staging Contract Design

## Purpose

Define a robust, low-boilerplate contract for Node wasm staging and inline-module generation that:

- keeps the primary path deterministic and explicit,
- avoids hidden secondary fallbacks that can mask bugs,
- remains aligned with `build-tools/docs/build-system-design.md`,
- is implementable by another engineer without rediscovery.

Compatibility posture for this design:

- The project has no external users yet.
- This work does not optimize for backward compatibility with pre-contract macro behavior.
- We standardize a single contract now, with sensible defaults for common callsites.

This design targets the two public Node macros that consume cross-language wasm outputs:

- `node_asset_stage(...)` in `build-tools/node/defs_stage.bzl`
- `node_wasm_inline_module(...)` in `build-tools/node/defs_stage.bzl`

## Context and Problem

Current failures show that these macros are sensitive to action-time path shapes for producer outputs (file vs directory, relative vs materialized path). The same logical source target may appear in multiple forms across Go/C++/Python/Node producers.

Observed failure patterns:

- missing staged app dir (`././dist`)
- missing wasm file (`././pyext.wasm`, `././cpp_emscripten.wasm`)
- brittle coupling to runtime tool dependencies in generated scripts

Affected tests include:

- `build-tools/tools/tests/node/node.asset-stage.webapp-stages-wasm.test.ts`
- `build-tools/tools/tests/scaffolding/scaf-new.ts.wasm-linking-app.scaffold-and-build.test.ts`
- `build-tools/tools/tests/node/node.wasm-inline-module.instantiate.test.ts`

## Philosophy Alignment

This design is consistent with `build-tools/docs/build-system-design.md`:

- no hidden secondary fallback that hides primary-path defects,
- explicit and deterministic artifact routing,
- Node remains macro-driven with Nix-calling shims,
- helper/wiring reuse instead of ad hoc per-callsite behavior.

Key references:

- `build-tools/docs/build-system-design.md` ("Path Invariants", "Planner languages vs. macro-only languages", `nix_calling_genrule` helper guidance).
- `build-tools/docs/wasm-node-linking.md` (explicit wasm staging and inline usage intent).

## Design Summary

Use a contract-based source resolution strategy with sensible defaults:

1. Keep user callsites compact for common cases.
2. Resolve source inputs deterministically.
3. Hard-fail when ambiguous.
4. Require explicit selector only for ambiguous producer outputs.

### Contract Defaults (Common Case)

For both macros:

- input may remain string label/path for common usage (`src = "//...:target"` or `src = "file.wasm"`).
- if source resolves to a file, use that file.
- if source resolves to a directory:
  - prefer `top.wasm` if present,
  - else if exactly one `*.wasm` exists (bounded scan), use it,
  - else fail with actionable message requiring selector.

### Explicit Selector (Ambiguous Case)

Allow optional selector fields when defaults are insufficient:

- `artifact_name = "<exact>.wasm"` (preferred explicit selector),
- `artifact_glob = "*.wasm"` only for controlled cases where exact names are intentionally unstable.

Do not silently choose among multiple matches.

## API Shape

### `node_asset_stage`

Keep current callsite shape:

```python
node_asset_stage(
    name = "webapp",
    app = ":webapp_raw",
    assets = [
        {"src": "//projects/libs/demo-wasm:wasm", "dest": "top.wasm"},
    ],
    out = "dist",
)
```

Extend each asset map with optional selector keys:

```python
{"src": "//projects/libs/demo-py-wasm:py_wasm", "artifact_name": "pyext.wasm", "dest": "wasm-inline/py.wasm"}
```

### `node_wasm_inline_module`

Keep current common callsite:

```python
node_wasm_inline_module(
    name = "wasm_inline",
    src = "//projects/libs/demo-wasm:wasm",
    out = "index.js",
)
```

Add optional selector args:

```python
node_wasm_inline_module(
    name = "wasm_inline_py",
    src = "//projects/libs/demo-py-wasm:py_wasm",
    artifact_name = "pyext.wasm",
    out = "py.js",
)
```

## Resolution Algorithm (Normative)

For a resolved source candidate `C`:

1. If `C` is a file, use it.
2. If `C` is a directory:
   - if `artifact_name` set, require `C/artifact_name`.
   - else if `top.wasm` exists, use it.
   - else gather matching `*.wasm` (bounded depth/strategy; deterministic ordering).
     - exactly one match: use it.
     - zero or many: fail.
3. Else fail ("source not found") with context:
   - macro name,
   - raw input,
   - candidate paths checked,
   - how to disambiguate.

No "last-resort" fallback that guesses among multiple wasm files.

## Implementation Plan

## Phase 1: Macro Contract and Resolver Helpers

Goal: introduce shared source resolution helper(s) for stage/inline macros.

Tasks:

1. Implement resolver helper in `build-tools/node/defs_stage.bzl`.
2. Add selector support (`artifact_name`, `artifact_glob`) in:
   - `node_asset_stage` asset entries
   - `node_wasm_inline_module` args
3. Ensure deterministic error messages for ambiguous cases.
4. Remove implicit behavior that conflicts with this contract.

Checkpoint:

- Contract defaults handle the common callsites without extra selector boilerplate.
- Ambiguous cases fail with actionable guidance.

## Phase 2: Inline Generation Primary Path Hardening

Goal: remove non-essential runtime dependency fragility for inline module generation.

Tasks:

1. Ensure inline module generation uses stable runtime dependencies only.
2. Prefer built-in Node modules in helper scripts where possible.
3. Keep generated module output shape stable:
   - `wasmBytesBase64`
   - `wasmBytes()`

Checkpoint:

- Inline module generation works for Go/C++/Python wasm producers in temp-repo scaffold tests.

Phase 2 status (PR-2):

- `node_wasm_inline_module` now stays on one primary resolution path and no longer uses the hidden
  `export-wasm-from-nix.ts` fallback route.
- `build-tools/tools/wasm/export-wasm-from-nix.ts` uses Node built-in modules only and keeps graph
  lock behavior deterministic.
- Regression coverage now includes a temp-repo test that poisons local `fs-extra` resolution and
  confirms inline export still works.

## Phase 3: Tests and Regression Coverage

Goal: ensure cross-language producer compatibility and prevent regressions.

Required tests:

1. Existing:
   - `node.asset-stage.webapp-stages-wasm.test.ts`
   - `node.wasm-inline-module.instantiate.test.ts`
   - `scaf-new.ts.wasm-linking-app.scaffold-and-build.test.ts`
2. New targeted tests:
   - ambiguous directory source fails with clear error (both macros),
   - explicit `artifact_name` unblocks ambiguous source,
   - default `top.wasm` selection works where expected.

Checkpoint:

- failing tests above pass individually and as grouped reruns.

Phase 3 status (PR-3):

- Scaffold end-to-end parity is covered by
  `build-tools/tools/tests/scaffolding/scaf-new.ts.wasm-linking-app.scaffold-and-build.test.ts`
  and validated against mixed Go/C++/Python wasm producer labels.
- Node wasm stage/inline coverage includes focused mixed-producer staging and inline assertions in
  `build-tools/tools/tests/node/node.wasm-stage-inline.mixed-producer-labels.test.ts`.
- Scaffold templates keep default resolution for unambiguous file outputs and rely on explicit
  selectors only where source ambiguity exists.

## Phase 4: Documentation Updates

Goal: align user-facing and design docs.

Update:

1. `docs/handbook/starlark-api.md`
   - document optional selector args and default resolution semantics.
2. `build-tools/docs/wasm-node-linking.md`
   - add section on default selection and ambiguity behavior.
3. `build-tools/docs/build-system-design.md` (required short note)
   - confirm deterministic source-resolution contract and no ambiguity fallbacks.
4. `docs/history/build-system/nix-gaps-plan.md`
   - add/keep reference to this design as the implementation source of truth.

Checkpoint:

- docs and macro behavior are consistent.

## File Touchpoints

Primary implementation:

- `build-tools/node/defs_stage.bzl`
- `build-tools/tools/wasm/export-wasm-from-nix.ts`

Tests:

- `build-tools/tools/tests/node/node.asset-stage.webapp-stages-wasm.test.ts`
- `build-tools/tools/tests/node/node.wasm-inline-module.instantiate.test.ts`
- `build-tools/tools/tests/scaffolding/scaf-new.ts.wasm-linking-app.scaffold-and-build.test.ts`
- new focused resolver behavior tests under `build-tools/tools/tests/node/`

Docs:

- `docs/handbook/starlark-api.md`
- `build-tools/docs/wasm-node-linking.md`
- `build-tools/docs/build-system-design.md`
- `docs/history/build-system/nix-gaps-plan.md`

## Non-Goals

- No change to public macro names.
- No auto-inference from JS import graphs.
- No weakening of failure behavior to preserve broken ambiguous callsites.
- No hidden fallback to alternate build paths.

## Risks and Mitigations

Risk: contract tightening requires updates to some in-repo fixtures/templates that encoded implicit
selection behavior.

Mitigation:

- provide explicit selector fields,
- include clear migration messages and examples.

Risk: resolver logic becomes too complex.

Mitigation:

- centralize logic in one helper,
- test matrix for file/dir/single/multi/none scenarios,
- keep algorithm small and documented.

## Definition of Done

Done when all are true:

1. Cross-language wasm staging/inline tests pass in isolation:
   - asset stage webapp wasm,
   - wasm inline instantiate,
   - wasm-linking-app scaffold build.
2. Ambiguous source behavior is deterministic and tested.
3. Common callsites remain concise via defaults (`top.wasm`, single `*.wasm`).
4. Documentation reflects contract and disambiguation options.
5. No secondary fallback path masks primary-path defects.

## Verification Commands

Run these during PR implementation to enforce buildable/testable checkpoints:

- Resolver and core stage/inline checks:
  - `build-tools/tools/tests/node/node.asset-stage.webapp-stages-wasm.test.ts`
  - `build-tools/tools/tests/node/node.wasm-inline-module.instantiate.test.ts`
- Scaffold end-to-end:
  - `build-tools/tools/tests/scaffolding/scaf-new.ts.wasm-linking-app.scaffold-and-build.test.ts`

Suggested grouped run (same invocation style used in this repo for zx TypeScript tests):

- `direnv exec . node --experimental-top-level-await --disable-warning=ExperimentalWarning --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs <test-file.ts>`

Gate expectation:

- At PR end, the PR-scoped tests are green and no known failures are deferred to later PRs.

---

## PR Implementation Plan

Each PR below includes code, tests, and documentation updates together.

Scope: complete implementation of this design in `build-tools/node/defs_stage.bzl`, associated tests,
and user-facing docs.

Non-goals: standalone docs-only or tests-only PRs.

Checkpoint rule: each PR must end in a buildable/testable state (no known failing targets introduced
or left unresolved for the scoped area).

Completion criteria: all three previously failing wasm stage/inline tests pass with deterministic
source-resolution behavior and clear ambiguity errors, and every PR includes tests/docs for the code
it changes.

---

## PR-1: Add deterministic source-resolution contract and clear current failing wasm tests

### Description

I will implement a single, deterministic source-resolution contract for `node_asset_stage` and
`node_wasm_inline_module`, with low-boilerplate defaults for common cases and explicit
disambiguation fields for ambiguous producer outputs.

### Scope & Changes

- Update `build-tools/node/defs_stage.bzl`:
  - Add shared resolver logic used by both macros.
  - Add optional selectors:
    - `artifact_name` (preferred explicit selector),
    - `artifact_glob` only for controlled unstable-name producers.
  - Default resolution rules:
    - file -> use file,
    - directory -> prefer `top.wasm`,
    - else exactly one `*.wasm` -> use it,
    - else fail with actionable error.
- Ensure deterministic ordering and error text so failures are reproducible.
- Keep `prepare_language_wiring(..., wiring = "nix_calling_genrule")` usage and current macro
  contracts intact outside the source-resolution behavior.

### Tests (in this PR)

- Add targeted tests under `build-tools/tools/tests/node/` for resolver behavior:
  - directory with `top.wasm` selected by default,
  - directory with exactly one `*.wasm` selected by default,
  - directory with multiple `*.wasm` fails without selector,
  - `artifact_name` disambiguates correctly.
- Resolve and rerun the currently failing targets as part of PR-1 completion:
  - `build-tools/tools/tests/node/node.asset-stage.webapp-stages-wasm.test.ts`
  - `build-tools/tools/tests/node/node.wasm-inline-module.instantiate.test.ts`
  - `build-tools/tools/tests/scaffolding/scaf-new.ts.wasm-linking-app.scaffold-and-build.test.ts`
- Update affected fixture expectations to match the explicit contract where prior implicit behavior
  differed.

### Docs (in this PR)

- Update `docs/handbook/starlark-api.md` for both macros:
  - default behavior,
  - new optional selector args,
  - ambiguity failure semantics.
- Update `build-tools/docs/wasm-node-linking.md` with a short note on the new contract and examples.

### Acceptance Criteria

- Common callsites are concise under contract defaults without additional selector boilerplate.
- Ambiguous cases fail deterministically with clear guidance.
- Resolver behavior is covered by focused tests and cannot silently regress.
- The three currently failing wasm stage/inline tests above pass individually and as a grouped run.
- PR-1 ends at a buildable/testable checkpoint for the scoped Node wasm flows.

### Risks

In-repo fixtures that relied on implicit multi-match selection may fail until updated.

### Mitigation

Provide explicit selectors (`artifact_name` first) and make failure messages include exact
disambiguation instructions and candidate matches.

### Consequence of Not Implementing

Path-shape fragility remains and cross-language wasm producer outputs continue to fail intermittently
at action runtime.

### Downsides for Implementing

Slightly more macro complexity and a small increase in contract surface.

### Recommendation

Implement.

---

## PR-2: Harden primary inline/staging execution paths and remove brittle runtime coupling

### Description

I will harden the primary execution path for wasm inline generation and staged asset copying so it no
longer depends on fragile action-time assumptions or non-essential runtime package availability.

### Scope & Changes

- Keep stage/inline generation on the primary macro path and avoid hidden fallback routes.
- Ensure inline module generation uses stable runtime dependencies only.
- Update `build-tools/tools/wasm/export-wasm-from-nix.ts` to use built-in Node modules and robust
  lock/graph handling where needed.
- Ensure staged app and asset copying behavior is deterministic for file/dir inputs once resolved.

### Tests (in this PR)

- Re-run and stabilize:
  - `build-tools/tools/tests/node/node.wasm-inline-module.instantiate.test.ts`
  - `build-tools/tools/tests/node/node.asset-stage.webapp-stages-wasm.test.ts`
- Add one regression test that verifies inline generation works in temp repos without relying on
  ambient `fs-extra` availability.

### Docs (in this PR)

- Add brief implementation notes in `build-tools/docs/node-wasm-staging-contract-design.md` under
  Phase 2 status.
- Update any stale examples in `build-tools/docs/wasm-node-linking.md` if helper runtime assumptions
  changed.

### Acceptance Criteria

- Inline and staged wasm flows run via the primary path with no hidden fallback behavior.
- Runtime dependency assumptions are minimized and explicit.
- Existing inline/stage integration tests pass.
- PR-2 preserves a buildable/testable checkpoint (no regression on PR-1 green targets).

### Risks

Refactors in helper scripts can subtly change output formatting or filesystem behavior.

### Mitigation

Keep output-module shape stable (`wasmBytesBase64`, `wasmBytes`) and assert compatibility in existing
instantiate tests.

### Consequence of Not Implementing

Builds remain sensitive to runtime environment drift in temp/sandboxed actions.

### Downsides for Implementing

Some helper code churn and additional regression tests to maintain.

### Recommendation

Implement.

---

## PR-3: End-to-end scaffold parity and documentation closure for cross-language wasm producers

### Description

I will complete end-to-end parity for the wasm-linking scaffold path so Go/C++/Python wasm producer
outputs are consumed consistently by `node_asset_stage` and `node_wasm_inline_module`.

### Scope & Changes

- Finalize any remaining path/shape resolution edge cases in `build-tools/node/defs_stage.bzl` based
  on scaffold E2E behavior.
- Ensure all wasm-inline outputs used by scaffold templates are resolvable under the contract.
- Keep defaults ergonomic while requiring explicit selector only where ambiguity exists.

### Tests (in this PR)

- Make the full scaffold path pass:
  - `build-tools/tools/tests/scaffolding/scaf-new.ts.wasm-linking-app.scaffold-and-build.test.ts`
- Run the related node tests as a set:
  - `build-tools/tools/tests/node/node.wasm-inline-module.instantiate.test.ts`
  - `build-tools/tools/tests/node/node.asset-stage.webapp-stages-wasm.test.ts`
- Add focused regression coverage for mixed Go/C++/Python wasm producer labels if not already covered.

### Docs (in this PR)

- Update `build-tools/docs/scaffolding.md` and/or scaffold template notes where examples should show
  explicit selector usage for ambiguous sources.
- Add a short "implementation completed" status update to
  `build-tools/docs/node-wasm-staging-contract-design.md`.
- If route wording changed materially, align `docs/handbook/nix-gaps.md` and
  `docs/history/build-system/nix-gaps-plan.md`.

### Acceptance Criteria

- The scaffold wasm-linking E2E test passes consistently.
- Node stage/inline wasm tests pass individually and as a set.
- Docs accurately describe defaults, explicit disambiguation, and failure behavior.
- PR-3 preserves a buildable/testable checkpoint and does not defer failing tests to a later PR.

### Risks

Cross-language output conventions may still differ enough to surface new ambiguity cases.

### Mitigation

Prefer deterministic contract failures plus explicit selectors over macro-level hidden heuristics;
capture new ambiguity cases in tests immediately.

### Consequence of Not Implementing

Scaffolded wasm-linking apps remain unreliable and continue to block a green full-suite run.

### Downsides for Implementing

Final integration pass may require iterative fixture/test updates before stabilizing.

### Recommendation

Implement.
