## Cross‑Language Cleanup and Consolidation — PR Sequence (Go ↔ C++) — Round 4

This round consolidates small, high‑value refactors to reduce duplication across Go and C++, strengthen shared abstractions, and keep the system easy to extend. Each PR is independent, low‑risk, and ships with tests and doc updates. No functional changes are intended; parity and determinism are preserved.

---

### PR 1 — Shared patch “glue” orchestration (ensureGraph + runGlue)

Scope

- Add `build-tools/tools/patch/glue.ts` exporting `ensureGraph()` and `runGlue()`.
- Refactor `build-tools/tools/patch/patch-go.ts` and `build-tools/tools/patch/patch-cpp.ts` to import and use these helpers.

Detailed Design

- `ensureGraph()`
  - If `build-tools/tools/buck/graph.json` is missing, invoke `build-tools/tools/buck/export-graph.ts` via zx (reusing `build-tools/tools/dev/zx-init.mjs`).
  - Fail with actionable error if exporter cannot run (consistent with current `patch-go.ts`).
- `runGlue()`
  - Invoke `build-tools/tools/buck/sync-providers.ts` (no `--lang`, so all languages update deterministically).
  - Invoke `build-tools/tools/buck/gen-auto-map.ts --graph build-tools/tools/buck/graph.json --out third_party/providers/auto_map.bzl`.
  - Keep command lines and write order identical to today to preserve byte‑stable outputs.
- Replace local glue code in `patch-go.ts` and `patch-cpp.ts` with calls to the shared helpers.

Acceptance Criteria

- Running `patch-pkg apply go <module>` and `patch-pkg apply cpp <attr>` produces byte‑for‑byte identical `third_party/providers/TARGETS*.auto` and `auto_map.bzl` to pre‑refactor outputs.
- Existing patch workflow tests pass with no changes.

Risks

- Very low. Ensure the zx invocation flags and ordering match existing behavior to avoid textual diffs.

Consequence if not implemented

- Glue logic remains duplicated across languages, increasing drift risk and maintenance cost.

---

### PR 2 — Deduplicate label‑collection DFS in planners

Scope

- Extend `build-tools/tools/nix/planner/lib.nix` with a generic `collectLabelsWithPrefix` helper.
- Refactor `build-tools/tools/nix/planner/cpp.nix` and `build-tools/tools/nix/planner/go.nix` to use this helper for `nixpkg:*` label discovery.

Detailed Design

- In `build-tools/tools/nix/planner/lib.nix`, add:
  - `collectLabelsWithPrefix = { nodes, get, byName, labelsOf, depsOf, name }: prefix -> [labels]` performing a DFS from `name`, collecting unique labels with the given prefix.
  - Keep the function pure, stable, and bounded by the provided `nodes` graph.
- `planner/cpp.nix`:
  - Replace local DFS (`collectNixAttrsFor`) with `collectLabelsWithPrefix(..., "nixpkg:")` followed by normalization (`lib.removePrefix`).
- `planner/go.nix`:
  - Use the same helper instead of bespoke `labelsOfName`/`depsOfName` traversals; continue deriving `nixCgoAttrs` from collected labels.

Acceptance Criteria

- For representative graphs (C++ bins/libs/tests and Go libs/bins with cgo), the sets of `nixpkg:*` attributes passed into templates match pre‑refactor results exactly.
- All existing planner tests remain green.

Risks

- Moderate if DFS semantics diverge. Mitigate with explicit tests on small synthetic graphs and by preserving traversal/stable ordering.

Consequence if not implemented

- Duplicate DFS logic persists across planners, raising the risk of future drift and bugs.

---

### PR 3 — Factor shared internals in Nix templates (C++ and Go)

Scope

- `build-tools/tools/nix/templates/cpp.nix`: factor shared compile/link logic used by `cppApp`/`cppTest` into small internal helpers.
- `build-tools/tools/nix/templates/go.nix`: factor CGO/base argument setup shared by `goApp`/`goLib`/`goCArchive` into small internal helpers.

Detailed Design

- C++:
  - Introduce internal functions like `discoverSources`, `composeCFlags`, `composeLdFlags`, `discoverLibFlags`, ensuring stable ordering and identical flag strings.
  - Reuse the helpers from both `cppApp` and `cppTest`; keep `installPhase` output and echo ordering unchanged.
- Go:
  - Introduce internal `mkCgoEnv` and `mkBaseArgs` to assemble `nativeBuildInputs`, environment exports, and module root handling.
  - Reuse in `goApp` and `goLib`; re‑use portions in `goCArchive` where applicable without altering outputs.

Acceptance Criteria

- Byte‑stable derivation outputs: build logs and artifacts identical to pre‑refactor runs (allowing for trivial timestamp differences only where unavoidable; echo ordering must remain the same).
- All existing tests pass.

Risks

- Low. The main risk is textual differences in logs. Keep echo ordering and sorting logic unchanged.

Consequence if not implemented

- Continued duplication in template definitions, increasing effort to evolve flags or environment setup consistently.

---

### PR 4 — Minimal validation in C++ exporter adapter (warn‑only)

Scope

- Add a light validation step in `build-tools/tools/buck/exporter/lang/cpp.ts` to warn (not fail) when a node seems C++‑related but lacks both `cxx_*` rule_type and `lang:cpp` label.

Detailed Design

- Implement `validate(nodes)` that:
  - Scans nodes; when `rule_type` does not start with `cxx_` and `labels` lacks `lang:cpp`, do nothing unless `.cc/.cpp/.cxx` appear in `srcs` (if present); in that case, emit a console warning guiding to stamp `lang:cpp` or use `cxx_*`.
  - Keep default behavior a no‑op in CI (no failures), purely advisory to reduce silent misclassification.

Acceptance Criteria

- No new failures in exporter runs across the repo.
- When intentionally constructing a mis‑labeled C++ node in tests, a warning is produced.

Risks

- Very low; warn‑only, gated on presence of obvious C++ sources in `srcs`.

Consequence if not implemented

- Inconsistent labeling can slip through silently, making graphs harder to diagnose.

---

### PR 5 — Shared `graph.json` reader utility

Scope

- Add `build-tools/tools/lib/graph.ts` with a tiny helper `readGraph(graphPath)` that returns a normalized `Node[]` from either an array or object‑map JSON.
- Refactor `build-tools/tools/buck/gen-auto-map.ts` and `build-tools/tools/buck/providers/cpp.ts` to import and use this helper.

Detailed Design

- `readGraph(graphPath: string): Promise<Node[]>`:
  - `JSON.parse` the file, return `Array.isArray ? arr : Object.values(obj)`; swallow minor shape differences.
  - No caching; pure file read to keep behavior simple.
- Replace ad‑hoc JSON parsing in the two scripts with this helper; keep sort orders and output formatting identical.

Acceptance Criteria

- Generated `auto_map.bzl` and `TARGETS.cpp.auto` remain byte‑for‑byte identical to pre‑refactor outputs.
- Unit tests for `readGraph` cover both array and object‑map shapes.

Risks

- Low; only removes duplication in graph parsing.

Consequence if not implemented

- Multiple scripts implement slightly different graph parsing, inviting subtle drift.

---

### PR 6 — Docs and tests refresh for the above refactors

Scope

- Update design docs and add/adjust tests to prove no behavior changes while duplication is reduced.

Detailed Design

- Tests
  - Add zx tests asserting byte‑stable outputs for: `patch-pkg apply` (both languages), provider sync, and auto‑map generation.
  - Add tiny planner DFS tests on synthetic graphs to assert identical `nixpkg:*` attrs pre/post refactor.
- Docs
  - Refresh `build-tools/docs/build-system-design.md` appendices to mention shared patch glue and planner helper.
  - Note the C++ exporter’s warn‑only validation in the exporter docs.

Acceptance Criteria

- All tests (existing + new) pass locally and in CI; no content diffs in generated provider files or `auto_map.bzl`.

Risks

- None; doc/test only.

Consequence if not implemented

- Refactors land without the guardrails that ensure parity, raising risk of regressions later.

---

## PR Ordering and Blast Radius

- Recommended order: PR 1 → PR 2 → PR 3 → PR 5 → PR 4 → PR 6.
  - PR 4 is warn‑only; can land anytime after exporter adapter import paths stabilize.
  - Each PR is designed to avoid behavior changes; byte‑stable outputs are required where applicable.

## Program‑Level Acceptance

- Patch workflows for Go and C++ share a single glue implementation.
- Planners share a single DFS helper for label collection; Go/C++ results match before/after.
- Nix templates have reduced duplication (C++ compile/link; Go CGO/base args) with identical outputs.
- Exporter’s C++ adapter optionally warns on mis‑labeled C++ targets without failing builds.
- Scripts that read `graph.json` use a single, normalized reader.
- Docs/tests reflect and protect the refactors.
