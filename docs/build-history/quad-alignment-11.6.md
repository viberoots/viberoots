## Quad Alignment Plan — File Size Compliance Rollout (≤250 LOC) — Part 11.6

This installment closes the remaining methodology gap around file size. The goal is to make it mechanically true that a deterministic grep over our **source files** finds no file with more than 250 lines, while keeping behavior stable and preserving test coverage.

---

## PR‑1: Define “source files” scope + enforce the ≤250 LOC rule in CI/local verify

### Description

Make the file-size rule objective and enforceable. Today, the repo contains both production/tooling code and large test fixtures. This PR defines what we mean by “source files” for the purpose of the methodology gate, and wires the existing file-size tooling to enforce it so we stop regressing.

### Scope & Changes

- Define the “source files” set for the file-size gate as:
  - Tracked files from `git ls-files`
  - Extensions: `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.bzl`, `.py`, `.go`, `.rs`
  - Exclusions (non-source or intentionally large fixtures):
    - `build-tools/tools/tests/**`
    - `docs/**`
    - `test-logs/**`
    - `buck-out/**`
    - `node_modules/**`
    - `coverage/**`
- Extend `build-tools/tools/dev/file-size-lint.ts` to support explicit include/exclude globs (and to run in `--fail` mode in verify/CI for the source-file set).
- Add a dedicated zx test that asserts the enforcement rule matches the documented scope:
  - A “source files are under 250 LOC” test that uses the same include/exclude rules as the lint script.
- Keep the existing focused `.bzl` guard test (it is still useful as a tight regression check for macro helpers).

### Tests (in this PR)

- New test: “source files remain under the 250 LOC methodology gate”.
- Existing: `build-tools/tools/tests/lang/file-size.lang-bzl-under-250.test.ts` remains unchanged.

### Docs (in this PR)

- Document the canonical check command (see Acceptance Criteria) in the new plan doc and optionally reference it from `TESTING.md` or a handbook page if needed.

### Acceptance Criteria

- A deterministic check reports no offenders for source files:

```bash
git ls-files | egrep '\.(ts|tsx|js|mjs|cjs|bzl|py|go|rs)$' \
  | egrep -v '^(build-tools/tools/tests/|docs/|test-logs/)' \
  | xargs wc -l | awk '$1>250{print}' | wc -l | tr -d ' ' | grep '^0$'
```

- `build-tools/tools/bin/v` (or `buck2 test //...`) fails if a source file exceeds 250 LOC.

### Risks

- Moderate. If the scope is defined too broadly, we will force splits of large test-only files that are intentionally verbose. If too narrow, we will fail to meet the stated goal.

### Consequence of Not Implementing

- The repo continues to drift and the ≤250 LOC methodology rule remains unenforced in practice.

### Downsides for Implementing

- Some refactors may be mechanically noisy as files are split to satisfy the gate.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches only `build-tools/tools/dev/file-size-lint.ts` and `build-tools/tools/tests/**` (plus docs).

---

## PR‑2: Split `build-tools/tools/scaffolding/scaf.ts` (currently ~1349 LOC) into small modules

### Description

`build-tools/tools/scaffolding/scaf.ts` is the largest file in the repo by line count. Split it into cohesive modules with clear responsibilities (CLI parsing, template resolution, render orchestration, filesystem operations, and helpers), keeping behavior identical.

### Scope & Changes

- Create a `build-tools/tools/scaffolding/scaf/` directory (or a similarly named folder consistent with existing conventions) containing:
  - CLI command table + argument parsing
  - Template discovery/selection
  - Render/apply orchestration
  - Validation and error shaping
  - IO helpers kept minimal and reused (prefer existing `build-tools/tools/lib/*` helpers when applicable)
- Keep `build-tools/tools/scaffolding/scaf.ts` as a thin entry point that wires the CLI to the new modules.
- Keep public CLI behavior unchanged:
  - same commands, flags, output formatting, and exit codes
  - same default template paths (`build-tools/tools/scaffolding/templates/**`)

### Tests (in this PR)

- Existing scaffolding zx tests should remain green without modification.
- Add one small “module boundary” test only if needed (prefer relying on existing e2e scaffolding tests).

### Docs (in this PR)

- None required if behavior is stable. If new contributors commonly open `scaf.ts` directly, add a short pointer at the top-level entry point explaining where logic moved (without duplicating details).

### Acceptance Criteria

- `build-tools/tools/scaffolding/scaf.ts` ≤250 lines and delegates to modules.
- No diffs in scaffolded outputs for representative commands (existing tests provide coverage).
- `build-tools/tools/bin/v` passes.

### Risks

- Moderate. Scaffolding is high-fanout and small path/ordering differences can cause golden diffs.

### Consequence of Not Implementing

- The repo cannot meet “no source files >250 LOC” while keeping the methodology meaningful.

### Downsides for Implementing

- Mechanical code motion; review noise.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Confined to `build-tools/tools/scaffolding/**` and existing scaffolding tests.

---

## PR‑3: Split `build-tools/tools/dev/dev-build.ts` and related dev orchestration into ≤250 LOC modules

### Description

`build-tools/tools/dev/dev-build.ts` is large and acts as orchestration glue. Split it into a small entrypoint plus narrowly scoped modules (build mode selection, argument parsing, invocation plumbing), preserving behavior and error text.

### Scope & Changes

- Move distinct responsibilities into focused modules under `build-tools/tools/dev/dev-build/` (or similar):
  - parse flags and environment
  - determine build mode (pure vs impure) and required prerequisites
  - run buck/nix invocations (delegating to existing helpers if present)
  - reporting and exit handling
- Keep `build-tools/tools/dev/dev-build.ts` as a thin entrypoint.

### Tests (in this PR)

- Existing zx tests that exercise dev-build behavior remain unchanged.
- Add targeted tests only when a behavior edge is uncovered during refactor.

### Docs (in this PR)

- None required if CLI usage is unchanged.

### Acceptance Criteria

- `build-tools/tools/dev/dev-build.ts` ≤250 lines.
- `build-tools/tools/bin/v` passes.

### Risks

- Low to moderate. CLI orchestration changes can alter ordering of diagnostics.

### Consequence of Not Implementing

- The dev tooling remains out of compliance with the file-size gate.

### Downsides for Implementing

- Mechanical code motion.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Confined to `build-tools/tools/dev/**`.

---

## PR‑4: Split `build-tools/tools/dev/patches-lint.ts` and tighten shared lint utilities

### Description

`build-tools/tools/dev/patches-lint.ts` is another large dev script. Split it into small modules and ensure shared patch naming/parsing logic is reused (avoid parallel implementations).

### Scope & Changes

- Create a small module set under `build-tools/tools/dev/patches-lint/`:
  - scanning + filtering
  - filename parsing + key normalization
  - reporting
- Keep `build-tools/tools/dev/patches-lint.ts` as a thin entrypoint.
- Prefer existing shared helpers in `build-tools/tools/lib/` for path normalization and key parsing.

### Tests (in this PR)

- Existing patch-lint tests remain green.
- Add one narrow unit-style test only if we introduce a new shared helper.

### Docs (in this PR)

- None required.

### Acceptance Criteria

- `build-tools/tools/dev/patches-lint.ts` ≤250 lines.
- `build-tools/tools/bin/v` passes.

### Risks

- Low. The linter is deterministic and already tested.

### Consequence of Not Implementing

- A large file remains, blocking the global “no source files >250 LOC” objective.

### Downsides for Implementing

- Minor churn.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Confined to `build-tools/tools/dev/**` and existing tests.

---

## PR‑5: Split `build-tools/tools/scaffolding/lib/scaffold-utils.ts` into focused utilities

### Description

Split `build-tools/tools/scaffolding/lib/scaffold-utils.ts` into smaller files that separate concerns cleanly (templating helpers vs filesystem helpers vs text transformations), preserving existing callers.

### Scope & Changes

- Create `build-tools/tools/scaffolding/lib/` submodules:
  - filesystem helpers (copy/write/atomic)
  - template helpers (vars, render steps, path mapping)
  - validation helpers
- Keep an index module (or keep `scaffold-utils.ts` as a compatibility re-export wrapper) so call sites are stable.

### Tests (in this PR)

- Existing scaffolding tests remain green.

### Docs (in this PR)

- None required.

### Acceptance Criteria

- `build-tools/tools/scaffolding/lib/scaffold-utils.ts` ≤250 lines (wrapper or removed).
- `build-tools/tools/bin/v` passes.

### Risks

- Low to moderate. Ordering and filesystem semantics must remain identical.

### Consequence of Not Implementing

- Scaffolding remains out of compliance with the file-size gate.

### Downsides for Implementing

- Mechanical changes.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Confined to `build-tools/tools/scaffolding/**`.

---

## PR‑6: Split `build-tools/tools/dev/update-pnpm-hash.ts` into focused utilities

### Description

`build-tools/tools/dev/update-pnpm-hash.ts` is still over the source-files limit. Split it into small, single-purpose modules (argument parsing, importer normalization, Nix build invocation, lockfile generation, hash-file update), keeping behavior identical.

### Scope & Changes

- Create `build-tools/tools/dev/update-pnpm-hash/` modules, for example:
  - args parsing (`--lockfile`, `--force`)
  - importer normalization (apps/_ and libs/_)
  - Nix build runner (including timeout + `--no-link --print-out-paths` handling)
  - lockfile seeding/generation behavior (`NIX_PNPM_ALLOW_GENERATE`)
  - `build-tools/tools/nix/node-modules.hashes.json` read/modify/write
- Keep `build-tools/tools/dev/update-pnpm-hash.ts` as a thin entrypoint that delegates to these modules.
- Prefer existing shared helpers where applicable (avoid bespoke flag parsing and path-existence helpers if the repo already provides them).

### Tests (in this PR)

Existing scaffolding and nix-node tests already cover this path; keep them green without modification.

### Docs (in this PR)

None required.

### Acceptance Criteria

- `build-tools/tools/dev/update-pnpm-hash.ts` ≤250 lines and delegates to modules.
- No behavior drift (flags, env vars, and printed diagnostics remain stable).
- `build-tools/tools/bin/v` passes.

### Risks

- Moderate. This script is invoked in multiple e2e scaffolding flows; small behavior drift can cause golden diffs or lockfile churn.

### Consequence of Not Implementing

- The repo cannot reach “no source files >250 LOC” and the temporary allowlist cannot be removed.

### Downsides for Implementing

- Mechanical code motion; review noise.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Confined to `build-tools/tools/dev/**` and existing scaffolding tests.

---

## PR‑7: Split `build-tools/tools/dev/langs-diagnose.ts` into focused utilities

### Description

`build-tools/tools/dev/langs-diagnose.ts` is slightly over the source-files limit. Split it into small modules (manifest reading, filesystem detection, exporter adapter detection, planner plugin detection, stage computation, output formatting), keeping output stable.

### Scope & Changes

- Create `build-tools/tools/dev/langs-diagnose/` modules for:
  - manifest IO and parsing (`build-tools/tools/nix/langs.json`)
  - enabled/disabled evaluation and missing-path detection
  - exporter adapter discovery
  - planner plugin discovery
  - stage computation (including pnpm-lock activation rules)
  - printing (human + `--json`)
- Keep `build-tools/tools/dev/langs-diagnose.ts` as a thin entrypoint that delegates to modules.
- Prefer existing shared CLI helpers and filesystem helpers where applicable to avoid duplicated logic.

### Tests (in this PR)

Existing unit-style zx tests already cover `langs-diagnose`; keep them green without modification.

### Docs (in this PR)

None required.

### Acceptance Criteria

- `build-tools/tools/dev/langs-diagnose.ts` ≤250 lines and delegates to modules.
- Output remains stable for both `--json` and human mode (existing tests cover `--json`).
- `build-tools/tools/bin/v` passes.

### Risks

- Low. The tool is diagnostic-only and already has tests.

### Consequence of Not Implementing

- The repo cannot reach “no source files >250 LOC” and the temporary allowlist cannot be removed.

### Downsides for Implementing

- Mechanical change.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Confined to `build-tools/tools/dev/**` and existing tests.

## Rollout & Sequencing

1. PR‑1 (scope + enforcement) — makes the goal measurable and blocks new regressions.
2. PR‑2 (`scaf.ts` split) — removes the largest offender first.
3. PR‑3 (`dev-build.ts` split)
4. PR‑4 (`patches-lint.ts` split)
5. PR‑5 (`scaffold-utils.ts` split)
6. PR‑6 (`update-pnpm-hash.ts` split)
7. PR‑7 (`langs-diagnose.ts` split)

---

## Verification & Backout Strategy

### Verification (each PR)

- Run `build-tools/tools/bin/v` once before landing.
- Run the canonical grep command from PR‑1’s Acceptance Criteria (or rely on the new enforcement test).

### Verification (end of series)

- Run `build-tools/tools/bin/v` twice back-to-back on the same machine.
- Confirm the canonical grep command returns zero offenders.
- Confirm `KNOWN_SOURCE_FILES_OVER_250_LOC` is empty (or removed) so the source-files gate is “mechanically true” without a temporary allowlist.

### Backout

- Each PR is intended to be a refactor-only change and can be reverted independently.
  - PR‑1 revert removes enforcement (not recommended once adopted).
  - PR‑2/3/4/5 revert returns to monolithic files.
