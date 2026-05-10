# Template Testing Plan - Convention-Driven Targeted Verification

This plan introduces template-aware test selection so template-only edits do not trigger a full
build-system verify run.

Each PR includes code, tests, and documentation updates together.

Scope: use conventions + changed-file detection + Buck2 label queries to select template-relevant
tests, and skip unrelated build-system tests when changes are template-only.

Non-goals: no hand-maintained ownership manifest, no docs-only or tests-only PRs, no fallback paths
that silently widen/narrow scope without diagnostics.

Completion criteria: template-only edits run only relevant template tests plus a small safety floor,
mixed build-system edits still run full scope, and selection is deterministic and auditable from
Buck metadata and changed paths.

Dependency chain (must execute in order):

- PR-1 -> define and enforce template test conventions in Buck targets/rules.
- PR-2 -> implement template-only selector from changed paths + Buck label queries.
- PR-3 -> integrate selector into verify/CI with guardrails and diagnostics.

---

## PR-1: Establish Buck2 template-test conventions (labels + explicit template inputs)

### Description

I will encode template ownership directly in Buck target metadata and explicit inputs so selection is
derived from the build graph, not a separate manifest.

### Scope & Changes

- Define template test conventions:
  - template-owned tests must carry labels like `template:<language>/<template>`.
  - classification labels are standardized (for example `template:smoke`, `template:contract`,
    `template:shared`).
- Extend `zx_test` and/or `auto_zx_tests` helper support for:
  - passing through custom labels.
  - attaching explicit template file inputs as action inputs.
- Apply conventions to scaffolding/template tests so Buck metadata is queryable by template id.
- Define a small fixed safety-floor target set (in code) that always runs in template-only mode.

### Tests (in this PR)

- Add/extend tests asserting:
  - template tests expose required `template:<id>` labels.
  - non-template tests do not get template labels accidentally.
  - declared template inputs are attached for template-owned tests.
- Add convention validation tests that fail when template tests miss required label/input metadata.

### Docs (in this PR)

- Document template-test label conventions and required metadata in scaffolding/testing docs.
- Document Buck query usage for selecting template tests by label.

### Acceptance Criteria

- Template ownership is represented by Buck labels, not external manifests.
- Template files are explicit Buck inputs for template-owned tests.
- Safety-floor targets are defined and resolvable.

### Risks

Label/input conventions may be applied inconsistently across existing tests.

### Mitigation

Add convention enforcement tests and fail fast on missing metadata.

### Consequence of Not Implementing

Template test selection remains heuristic and difficult to trust.

### Downsides for Implementing

Requires touching test rule plumbing and annotating existing template tests.

### Recommendation

Implement.

---

## PR-2: Implement template-only selector via changed paths + Buck label queries

### Description

I will add selector logic that detects template-only changes from file paths and resolves the exact
template test set from Buck labels.

### Scope & Changes

- Add selector tool (for example `select-template-tests.ts`) that:
  - reads changed files from git diff/working tree.
  - extracts changed template ids from
    `build-tools/tools/scaffolding/templates/<language>/<template>/...`.
  - classifies run mode as:
    - `template-only`
    - `mixed` (template + other build-system paths)
    - `no-template-impact`
  - queries Buck targets by `template:<id>` labels.
  - unions fixed safety-floor targets for `template-only`.
  - emits sorted, unique target list and decision diagnostics.
- Keep behavior strict:
  - template-only path classification is allowlist-based.
  - mixed mode does not skip full build-system testing.

### Tests (in this PR)

- Add selector tests for:
  - single-template edits
  - multi-template edits
  - mixed template + non-template edits
  - deletes/renames under template roots
  - no-template-impact edits.
- Add integration tests asserting selector output matches Buck label query results.

### Docs (in this PR)

- Document selector modes, path classification rules, and emitted diagnostics.
- Document template-only safety floor and why it is always included.

### Acceptance Criteria

- Template-only edits deterministically map to label-selected template test targets.
- Mixed edits correctly report `mixed` and request full-scope testing.
- Selector diagnostics clearly explain why tests were selected.

### Risks

Path classification edge cases can misclassify mode and affect scope.

### Mitigation

Use strict allowlist classification and cover rename/delete/mixed cases in tests.

### Consequence of Not Implementing

Buck label conventions cannot be translated into actual run scope decisions.

### Downsides for Implementing

Adds selector maintenance and integration complexity.

### Recommendation

Implement.

---

## PR-3: Integrate selector into verify/CI with strict guardrails and pnpm filtered checks

### Description

I will wire selector decisions into verify/CI so template-only changes skip unrelated build-system
tests while keeping deterministic safety checks and clear observability.

### Scope & Changes

- Integrate selector into verify and CI stage orchestration:
  - `template-only` -> run selected Buck targets + safety floor.
  - `mixed` -> run existing full build-system test scope.
  - `no-template-impact` -> skip template suite path.
- Add explicit scope control env:
  - `VBR_TEMPLATE_TEST_SCOPE=auto|always|never`
  - `auto` uses selector decision
  - `always` forces template selector path
  - `never` forces current full build-system path.
- Add strict guardrails:
  - fail if `template-only` mode yields zero template targets.
  - fail if Buck label queries for changed template ids return empty unexpectedly.
  - fail with actionable diagnostics rather than silently widening scope.
- Add pnpm best-practice integration for template mode:
  - use filtered workspace commands (`pnpm --filter ...`) for template-local checks only.
  - avoid workspace-wide template checks in template-only mode.

### Tests (in this PR)

- Add verify integration tests asserting:
  - template-only mode runs selected Buck targets and skips unrelated build-system tests.
  - mixed mode falls back to full build-system scope.
  - env overrides (`auto/always/never`) work as specified.
- Add CI stage tests validating selected-target propagation and diagnostics.
- Add guardrail tests for empty-selection and mislabelled-template failures.

### Docs (in this PR)

- Update verify/CI docs with template-only behavior and env controls.
- Document guardrail failure modes and expected remediation steps.
- Document pnpm filtered-command policy for template-only mode.

### Acceptance Criteria

- Template-only edits automatically skip unrelated build-system tests.
- Mixed edits preserve full-scope verification behavior.
- Guardrails fail loudly on invalid selection states.
- Scope decisions are visible in logs and reproducible from diagnostics.

### Risks

Incorrect integration can under-test template changes or overrun full scope too often.

### Mitigation

Use strict integration tests for each mode and fail-fast guardrails on suspicious outputs.

### Consequence of Not Implementing

Template-only changes continue to pay full build-system test cost.

### Downsides for Implementing

Adds orchestration branching and more integration tests to maintain.

### Recommendation

Implement.
