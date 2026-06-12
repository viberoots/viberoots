## Trio Alignment Plan — Cross-Language Tightening (CPP / Go / PNPM) — Part 15

This plan proposes small, high‑leverage refactors that reduce duplication, improve parity across languages, and clarify intent. All items are designed to be low‑risk, independently reversible, and behavior‑preserving for builds, labels, and provider mapping.

## PR‑1: Unify Node patch session with shared helper

### Description

Align `patch-pkg session node` with the shared session loop used by Go/C++ to eliminate bespoke stdin handling and improve UX consistency.

### Scope & Changes

- `build-tools/tools/patch/patch-node.ts`:
  - Replace the inline Ctrl‑D/Ctrl‑C loop with `runSession(onApply, onReset)` (already used by Go/C++).
  - No change to `start/apply/reset/remove` behaviors or pnpm integration.

### Acceptance Criteria

- Running `patch-pkg session node <pkg>` behaves identically (Ctrl‑D apply, Ctrl‑C reset), printing the same user‑visible instructions as Go/C++ sessions.
- All existing zx tests for Node patching pass unchanged.

### Risks

Low. Logic moves to a shared, already‑used helper.

### Consequence of Not Implementing

Minor duplication persists; future fixes must touch multiple session implementations.

### Downsides for Implementing

None beyond minimal refactor churn.

### Recommendation

Implement.

## PR‑2: Normalize echo‑snippet behavior across Go and C++ patchers

### Description

Unify `--echo-snippet` handling so both Go and C++ patchers provide the same flag and output format for exporting local dev‑overrides, improving muscle memory and test stability.

### Scope & Changes

- `build-tools/tools/patch/lib/cli.ts`:
  - Add `echoSnippetRequested(): boolean` (reads flag/env consistently).
- `build-tools/tools/patch/patch-go.ts`, `build-tools/tools/patch/patch-cpp.ts`:
  - Use the shared helper to decide whether to print the `export NIX_*_DEV_OVERRIDE_JSON='{}'` snippet instead of setting env in‑process.
  - Preserve existing env var names and messages; align wording where they differ.

### Acceptance Criteria

- `patch-pkg start go ... --echo-snippet` and `patch-pkg start cpp ... --echo-snippet` both print a single, identically formatted export snippet and do not set the process env.
- Existing tests that assert snippet presence/absence still pass (or get minimally updated for exact message parity if they were previously divergent across languages).

### Risks

Very low. Behavior is already present; this standardizes detection/wording.

### Consequence of Not Implementing

Slight UX drift remains across languages; tests may continue to special‑case wording.

### Downsides for Implementing

Small edits across two files and the shared CLI helper.

### Recommendation

Implement.

## PR‑3: Share patch‑tool flag parsing for common options

### Description

Standardize parsing of `--target`, `--patch-dir`, `--force` (and Node’s `--importer`) via a single helper to remove ad‑hoc parsing differences across patch tools.

### Scope & Changes

- `build-tools/tools/patch/lib/cli.ts`:
  - Add helpers: `readTargetArg()`, `readPatchDirArg()`, `readForceFlag()`, and reuse existing `getFlagStr/getFlagBool` where appropriate.
- `build-tools/tools/patch/patch-go.ts`, `build-tools/tools/patch/patch-cpp.ts`, `build-tools/tools/patch/patch-node.ts`:
  - Adopt shared helpers in place of local flag scanning where they diverge.
  - No change to user‑facing flags; only centralize parsing.

### Acceptance Criteria

- All three patch handlers accept the same flag variants and produce identical results as before across representative scenarios.
- Existing zx tests remain green without output diffs (other than benign reorderings of debug lines, if any).

### Risks

Low. Straightforward consolidation; surface area is small.

### Consequence of Not Implementing

Flag‑handling edge cases must be patched in multiple places.

### Downsides for Implementing

Minor refactor across the three handlers.

### Recommendation

Implement.

## PR‑4: Reduce duplicate dev‑override presence logs

### Description

Trim redundant dev‑override notices by consolidating them in the prebuild guard while keeping CI enforcement in Nix templates. Goal: less Nix evaluation noise without changing CI policy.

### Scope & Changes

- `build-tools/tools/buck/prebuild/notice.ts`:
  - Ensure a single, concise local notice is printed when `NIX_GO_DEV_OVERRIDE_JSON` or `NIX_CPP_DEV_OVERRIDE_JSON` is set and `CI!=true` (already present; verify wording parity).
- `build-tools/tools/nix/lib/lang-helpers.nix`:
  - Optionally gate `builtins.trace` behind an env toggle (e.g., `PLANNER_DEV_OVERRIDE_TRACE=1`) to suppress the default trace locally while leaving behavior unchanged in CI (templates still `throw` in CI when set).
- Documentation comment noting the preferred place to see local notices (prebuild guard).

### Acceptance Criteria

- Local runs show a single clear notice via prebuild guard by default; planner traces can be re‑enabled with an explicit env toggle.
- CI behavior unchanged; templates still fail on overrides.

### Risks

Low‑medium (logging only). The default trace reduction must not hide important diagnostics; the env toggle provides an escape hatch.

### Consequence of Not Implementing

Duplicated messages continue to appear; developers may ignore important signals.

### Downsides for Implementing

Very small: one optional env flag and documentation.

### Recommendation

Implement with the conservative env toggle; keep CI strictness intact.

## PR‑5: Document Node template shim intent

### Description

Clarify in code and docs that `build-tools/tools/nix/templates/node.nix` is a discoverability shim and the authoritative Node planner logic lives elsewhere, preventing misinterpretation by newcomers.

### Scope & Changes

- `build-tools/tools/nix/templates/node.nix`:
  - Add a short header comment explaining the shim role and pointing to the planner plugin + macros.
- Docs:
  - Expand `docs/handbook/adding-language.md` with a brief subsection reinforcing the separation.

### Acceptance Criteria

- Comments visible in the template; docs updated; zero code path changes.

### Risks

None. Documentation only.

### Consequence of Not Implementing

Occasional confusion about where Node build logic lives.

### Downsides for Implementing

None.

### Recommendation

Implement.

## PR‑6: Audit and unify patch filename decoding usage

### Description

Ensure all patch‑consuming scripts rely on the shared decoders to handle encoding/case edge cases consistently and prevent drift.

### Scope & Changes

- TS audit:
  - Replace any ad‑hoc parsing with `decodeNameVersionFromPatch` (Node/Go) or `decodeNixAttrFromPatchPrefix` (C++).
  - Verify `build-tools/tools/dev/patches-lint.ts` and provider generators already use the shared helpers; no code changes if audit is clean.

### Acceptance Criteria

- No diffs in generated provider files, auto_map, or lints for identical inputs.
- All zx tests remain green.

### Risks

Low. Likely a no‑op; reinforces consistency.

### Consequence of Not Implementing

Small risk of drift in edge‑case parsing over time.

### Downsides for Implementing

Small audit and quick edits if gaps are found.

### Recommendation

Implement.

## Rollout & Sequencing

1. PR‑1 (Node session unification) — smallest refactor; easiest to verify.
2. PR‑2 (Echo‑snippet normalization) — low‑risk UX alignment.
3. PR‑3 (Shared patch‑tool flags) — consolidate parsing across handlers.
4. PR‑4 (Dev‑override logs trimming) — apply conservative env‑gated reduction.
5. PR‑5 (Node template shim docs) — documentation; independent.
6. PR‑6 (Parsing audit/adoption) — final pass; should be no‑op or tiny edits.

All PRs are independent and reversible.

## Verification & Backout Strategy

- PR‑1:
  - Run Node patch session flows (start/session/apply/reset/remove) against a sample importer; ensure behavior matches prior tests. Backout: restore previous inline loop.
- PR‑2:
  - Exercise `--echo-snippet` for Go/C++; assert identical snippet shape; verify no env mutation in that mode. Backout: revert helper adoption.
- PR‑3:
  - Run representative patch flows for Go/C++/Node using `--target`, `--patch-dir`, `--importer`, `--force`; assert identical outcomes. Backout: revert per‑file flag parsing changes.
- PR‑4:
  - Local: confirm single prebuild notice; optional `PLANNER_DEV_OVERRIDE_TRACE=1` restores planner trace. CI: no change. Backout: remove env gate and keep planner trace default.
- PR‑5:
  - Docs render; no code paths touched. Backout: delete added comments/doc lines.
- PR‑6:
  - Regenerate providers/auto_map and run lints; expect no diffs. Backout: revert specific adoptions if any.

## Summary of Expected Impact

- Reduced duplication across patch handlers (shared session + flags + echo‑snippet).
- Clearer, less noisy local messaging for dev overrides; unchanged CI strictness.
- Improved discoverability of Node’s planner vs template roles.
- Consistent, future‑proof patch filename parsing across tools.
