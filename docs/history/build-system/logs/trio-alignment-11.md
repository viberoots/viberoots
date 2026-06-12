## Trio Alignment Plan — Abstraction Tightening (CPP / Go / PNPM) — Part 11

This plan lands small, high‑value refinements to keep abstractions tight, reduce duplication, and align implementations with our shared helpers. It focuses on standardizing Node patch utilities with the Go/C++ pattern, adding a flat patch‑dir lint, consolidating CLI parsing, modularizing oversized files, and optionally extracting PNPM lock traversal into a shared library. Behavior is intended to remain unchanged; only implementation consistency and maintainability improve.

## PR‑1: Node patch utilities reuse shared helpers (repoRoot/pathExists)

### Description

Unify `patch-node` with Go/C++ patch handlers by reusing shared helpers for repo‑root detection and filesystem checks. Today, `build-tools/tools/patch/patch-node.ts` carries local implementations for `pathExists` and repo root resolution. This refactor reduces duplication and ensures consistent behavior across languages.

### Scope & Changes

- `build-tools/tools/patch/patch-node.ts`:
  - Replace local `pathExists()` with `./lib/util.pathExists`.
  - Replace `repoRootFromScript()` + ad‑hoc cwd juggling with `repoRoot()` from `./lib/apply` where appropriate.
  - Preserve existing CLI flags and glue invocation.
- Documentation:
  - Short note in the patching handbook that all patch handlers now use shared helpers for root detection and existence checks.

### Acceptance Criteria

- `build-tools/tools/bin/patch-pkg start|apply|reset|session node …` works identically pre/post.
- No changes to `build-tools/tools/buck/sync-providers.ts` or `gen-auto-map.ts` outputs when running the same sequence.
- zx tests that exercise Node patching continue to pass locally and in CI.

### Risks

Low. The change replaces small local utilities with battle‑tested shared helpers.

### Consequence of Not Implementing

Minor duplication and drift risk in Node patch behavior vs Go/C++ persists.

### Downsides for Implementing

None material. Small refactor introduces shared imports.

### Recommendation

Implement.

## PR‑2: Flat patch‑dir lint (go/cpp/node)

### Description

Add a lightweight lint that enforces flat patch directories (no subdirectories) for `patches/go`, `patches/cpp`, and `patches/node`. This prevents accidental nesting that can silently bypass patch scanning and invalidation.

### Scope & Changes

- `build-tools/tools/dev/lint-patch-dirs.ts` (new):
  - Uses `build-tools/tools/lib/provider-sync.validateFlatDir()` to check `patches/go`, `patches/cpp`, and `patches/node` (when present).
  - Warns locally; can be elevated to error via `--strict` or `CI=true`.
- `build-tools/tools/dev/install-deps.ts`:
  - Invoke the lint early (warn mode) to surface issues during routine workflows.
- Documentation:
  - Add a brief note under patching handbook about flat directories and the lint behavior.

### Acceptance Criteria

- On a clean repo, lint emits no warnings.
- Introducing a nested directory (e.g., `patches/go/foo/bar.patch`) yields a clear warning locally and a hard error in CI (or when run with `--strict`).
- No changes to provider sync or auto‑map outputs in clean runs.

### Risks

Low. Pure validation.

### Consequence of Not Implementing

Developers may inadvertently create nested patch directories, causing confusing invalidation or missing patches.

### Downsides for Implementing

None material.

### Recommendation

Implement.

## PR‑3: Standardize CLI flag parsing across patchers/generators

### Description

Consolidate ad‑hoc argument parsing in patchers/generators to `build-tools/tools/lib/cli.ts` helpers (e.g., `getFlagStr`, `getFlagBool`), maintaining the current flag surface. This reduces bespoke parsing and improves testability.

### Scope & Changes

- `build-tools/tools/patch/patch-node.ts`, `build-tools/tools/patch/patch-cpp.ts`, `build-tools/tools/patch/patch-go.ts`:
  - Replace hand‑rolled parsing for common flags (`--importer`, `--target`, `--patch-dir`, `--force`) with `build-tools/tools/lib/cli.ts` when feasible without altering UX.
- Generators (only where not already standardized):
  - Audit `build-tools/tools/buck/*` zx scripts; ensure `getFlagStr/Bool` usage is consistent (many already comply).
- Documentation:
  - Update developer snippets to reflect consistent flags/help across patchers.

### Acceptance Criteria

- Command help/flags continue to work as before (no behavior change).
- zx tests for patch flows and generators pass with no modifications to expectations.

### Risks

Low. Minimal surface area change; behavior preserved.

### Consequence of Not Implementing

Small parsing inconsistencies accumulate, increasing maintenance overhead.

### Downsides for Implementing

Slight churn in patcher files; negligible runtime impact.

### Recommendation

Implement.

## PR‑4: Modularize oversized files (readability, methodology alignment)

### Description

Split oversized files into focused modules to improve readability and align with methodology file‑size guidance. No functional changes; imports/exports preserved.

### Scope & Changes

- `build-tools/tools/nix/graph-generator.nix` (~480+ lines):
  - Extract small helper modules (e.g., target selection, language collection, manifest/bin linking) under `build-tools/tools/nix/planner/` and import them in the main file.
- `build-tools/tools/nix/templates/cpp.nix` (~350+ lines):
  - Split into `cpp-app.nix`, `cpp-lib.nix`, `cpp-test.nix` and re‑export from a thin `cpp.nix` facade.
- `build-tools/tools/patch/patch-cpp.ts` (~430+ lines):
  - Extract `resolve.ts` (nixpkgs resolution), `extract.ts` (source materialization), and `apply.ts` (diff/write/verify), imported by a thin top‑level file.
- Tests/Docs:
  - Ensure zx tests reference stable entrypoints; add brief notes in internal docs indicating module locations.

### Acceptance Criteria

- `nix build .#graph-generator` and representative Buck builds/tests succeed unchanged.
- No diffs in generated artifacts (`build-tools/tools/buck/graph.json` consumers, provider outputs) for unchanged inputs.
- zx tests pass without updates beyond import path adjustments (if any).

### Risks

Medium (mechanical refactor). Mitigated by incremental changes and test coverage.

### Consequence of Not Implementing

Large files remain harder to navigate/maintain; increases ramp‑up time and risk of subtle regressions.

### Downsides for Implementing

Temporary churn in diffs/imports; reviewers must scan module boundaries once.

### Recommendation

Implement.

## PR‑5: Optional — Extract PNPM lock traversal to `build-tools/tools/lib/pnpm-lock.ts`

### Description

Factor the importer‑scoped PNPM lock traversal into a shared library reused by `build-tools/tools/buck/providers/node.ts` (and optional diagnostics). Preserve current behavior and output determinism.

### Scope & Changes

- `build-tools/tools/lib/pnpm-lock.ts` (new):
  - Parse lockfile, construct dependency graph, compute importer effective set (including peer resolution), and expose stable APIs.
- `build-tools/tools/buck/providers/node.ts`:
  - Replace in‑file traversal with calls to the new library; keep naming, ordering, and output identical.
- Tests:
  - Reuse existing zx tests for provider wiring; add a focused unit test for effective‑set computation with peers to guard behavior.

### Acceptance Criteria

- Byte‑for‑byte identical `third_party/providers/TARGETS.node.auto` for the same inputs.
- No changes to `gen-auto-map.ts` output or provider index.
- zx tests for Node providers and e2e wiring remain green.

### Risks

Low. Pure extraction with equivalent logic.

### Consequence of Not Implementing

Small duplication remains; minor future drift risk if traversal evolves.

### Downsides for Implementing

Adds a tiny shared surface; requires a couple of imports to change.

### Recommendation

Implement (optional). Safe to defer if churn is undesirable.

## Rollout & Sequencing

1. PR‑1 (Node patch utilities reuse shared helpers) — zero behavior change; reduces duplication.
2. PR‑2 (Flat patch‑dir lint) — warn‑by‑default locally; optional CI gating after a grace period.
3. PR‑3 (Standardize CLI parsing) — zero behavior change; improves consistency.
4. PR‑4 (Modularize oversized files) — larger mechanical refactor; land after 1–3 to minimize merge friction.
5. PR‑5 (Optional PNPM lock traversal library) — independent; can land anytime after PR‑3.

Each PR is independent and reversible. Land with green CI.

## Verification & Backout Strategy

- Verification (per PR):
  - PR‑1: Exercise Node patch lifecycle (`start/apply/reset/session`); confirm glue runs and outputs remain unchanged. Run Node provider wiring tests.
  - PR‑2: Run the lint on clean repo (no warnings). Introduce a nested patch directory in a throwaway branch; verify warning locally and error under `CI=true` (if enabled).
  - PR‑3: Smoke test patchers and generators; confirm flags and help remain intact; zx tests unchanged.
  - PR‑4: Compare outputs pre/post for representative targets (graph‑generator outputs, C++/Go derivations). Ensure zx tests remain green; no provider/auto_map diffs.
  - PR‑5: Snapshot `TARGETS.node.auto` and provider index before/after; expect byte‑for‑byte identity. Run e2e wiring tests.

- Backout:
  - Revert individual PRs cleanly. All are leaf‑level refactors with no public API changes beyond imports/internal structure.

## Summary of Expected Impact

- Reduced duplication and drift across languages for patch utilities and CLI handling.
- Cleaner developer feedback via a flat patch‑dir lint; fewer puzzling invalidation misses.
- Improved readability/maintainability by splitting oversized files while preserving behavior.
- Optional centralization of PNPM lock traversal to simplify future diagnostics and reuse.
