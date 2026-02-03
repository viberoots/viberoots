## Trio Alignment Plan — Abstraction Tightening (CPP / Go / PNPM) — Part 4\n

This plan continues the fine-grained consolidation work from Part 3. Each PR is small, independently reversible, and focused on reducing duplication, tightening cross-language parity, and improving maintainability without altering behavior.\n

## PR‑1: Patch CLI utilities and session consolidation\n

### Description\n

Unify shared patch CLI behavior across languages by extracting common utilities (debug flag, path checks) and the interactive session loop into small helpers. Standardize on a single debug flag (`PATCH_PKG_DEBUG=1`) while continuing to support existing per‑language flags as aliases.\n

### Scope & Changes\n

- Add `tools/patch/lib/util.ts` (debug flag, pathExists, small logging helper)\n
- Add `tools/patch/lib/session.ts` (Ctrl‑D apply, Ctrl‑C reset loop)\n
- Update `tools/patch/patch-go.ts` and `tools/patch/patch-cpp.ts` to consume helpers (no behavior change)\n
- Keep `PATCH_GO_DEBUG` / `PATCH_CPP_DEBUG` as backward‑compatible aliases; prefer `PATCH_PKG_DEBUG`\n

### Acceptance Criteria\n

- `patch-pkg start|apply|reset|session` works identically for Go and C++\n
- Re-running integration tests under `tools/tests/patching` passes with no snapshot changes\n
- Setting `PATCH_PKG_DEBUG=1` produces the same diagnostic verbosity previously gated by per‑language flags\n

### Risks\n

Low. Pure refactor with minimal import churn.\n

### Consequence of Not Implementing\n

Duplicated session loops and debug handling drift over time.\n

### Downsides for Implementing\n

Minor file moves and import updates.\n

### Recommendation\n

Implement.\n
\n

## PR‑2: Provider naming — single source of truth\n

### Description\n

Eliminate duplication between `tools/lib/providers.ts` and `tools/lib/labels.ts` for provider naming/normalization (importer names and nixpkgs attributes). Introduce a single small module that both import.\n

### Scope & Changes\n

- Add `tools/lib/provider-names.ts` exporting:\n
  - `normalizeNixAttr(...)`\n
  - `providerNameForImporter(lockfilePath, importer)`\n
  - `providerNameForNixAttr(attr)`\n
- Update `labels.ts` and `providers.ts` to import these functions\n
- Keep public exports unchanged; update unit tests accordingly\n

### Acceptance Criteria\n

- No output diffs for `third_party/providers/TARGETS*.auto` or `auto_map.bzl`\n
- All existing tests in `tools/tests/provider-names` and `tools/tests/auto-map` remain green\n

### Risks\n

Low. Function moves with identical behavior.\n

### Consequence of Not Implementing\n

Naming/normalization rules may diverge subtly across call sites.\n

### Downsides for Implementing\n

Small import churn; requires touching a few tests.\n

### Recommendation\n

Implement.\n
\n

## PR‑3: Planner helper reuse in `graph-generator.nix`\n

### Description\n

Reduce duplication by reusing `tools/nix/planner/lib.nix` helpers (`cleanLabel`, lookups) directly in `graph-generator.nix` instead of re‑defining variants.\n

### Scope & Changes\n

- Import `planner/lib.nix` into `graph-generator.nix`\n
- Replace local copies of label cleanup and lookups with shared helpers\n
- Keep target selection and language routing intact\n

### Acceptance Criteria\n

- `nix build .#graph-generator` produces identical derivations/store paths on unchanged graphs\n
- ZX tests under `tools/tests/planner` are green\n

### Risks\n

Low. Readability improvement only.\n

### Consequence of Not Implementing\n

Two similar implementations can drift and complicate future changes.\n

### Downsides for Implementing\n

Minor edits to `graph-generator.nix`.\n

### Recommendation\n

Implement.\n
\n

## PR‑4: Multi-language dev override logging in planner\n

### Description\n

Make planner logging language‑agnostic for dev overrides. Emit a short diagnostic line for any `NIX_*_DEV_OVERRIDE_JSON` present (when not in CI), or gate via an env flag to suppress logs entirely.\n

### Scope & Changes\n

- In `graph-generator.nix`, detect common override envs (`NIX_GO_DEV_OVERRIDE_JSON`, `NIX_CPP_DEV_OVERRIDE_JSON`) and log a concise summary to `build.log` (non‑CI only)\n
- Do not change enforcement logic (templates already warn locally and fail in CI)\n

### Acceptance Criteria\n

- Logs show a neutral “dev overrides present” line when overrides are set locally\n
- No changes to derivations or planner outputs\n

### Risks\n

Low. Cosmetic diagnostics only.\n

### Consequence of Not Implementing\n

Planner logs remain Go‑centric; minor confusion during multi‑language debugging.\n

### Downsides for Implementing\n

None material.\n

### Recommendation\n

Implement.\n
\n

## PR‑5: Extend `patches-lint` to C++ and unify flat‑dir checks\n

### Description\n

Ensure the same flat‑directory and duplicate‑detection guarantees for C++ patches as for Go/Node. Reuse existing decode helpers for C++ filename schema.\n

### Scope & Changes\n

- Update `tools/dev/patches-lint.ts` to:\n
  - Apply flat‑dir warnings/errors to `patches/cpp`\n
  - Detect duplicates using decoded `nixAttr@version` keys\n
- Keep output formatting and severities consistent with existing languages\n

### Acceptance Criteria\n

- Running the lint over the repo yields no new findings on a clean tree\n
- Adding contrived duplicates in `patches/cpp` flags them deterministically\n

### Risks\n

Low. Lint‑only.\n

### Consequence of Not Implementing\n

CPP patch directory risks drift (subdirs/duplicates) versus other languages.\n

### Downsides for Implementing\n

Tiny code addition and tests.\n

### Recommendation\n

Implement.\n
\n

## PR‑6: Planner mk‑helpers consolidation (no behavior change)\n

### Description\n

Lightly consolidate the target construction helpers by introducing a thin `mkFor(template, kind)` wrapper to reduce repetition around `mkGo`/`mkCpp` while preserving existing language adapters and kind routing.\n

### Scope & Changes\n

- Add `mkFor` (internally) and have `mkGo`/`mkCpp` delegate to it\n
- Keep language adapter contracts (`LANGS.<lang>.mkApp/mkLib/...`) unchanged\n

### Acceptance Criteria\n

- No derivation or output changes across representative graphs\n
- Planner tests green; readability improved\n

### Risks\n

Low. Pure internal refactor.\n

### Consequence of Not Implementing\n

Small but growing repetition in planner code paths.\n

### Downsides for Implementing\n

None significant.\n

### Recommendation\n

Implement.\n
\n

## Rollout & Sequencing\n

1. PR‑1 (Patch CLI utilities) — reduces duplication for subsequent changes\n
2. PR‑2 (Provider naming SSoT) — centralizes naming/normalization\n
3. PR‑3 (Planner helper reuse) — removes duplication before mk‑helper consolidation\n
4. PR‑4 (Dev override logging) — improves multi‑language diagnostics\n
5. PR‑5 (patches‑lint C++) — aligns guardrails across languages\n
6. PR‑6 (Planner mk‑helpers) — final tidy while tests remain green\n
   \n

## Verification & Backout Strategy\n

- Verification:\n
  - PR‑1: Re-run patching tests (Go/C++) and a manual `session` smoke check\n
  - PR‑2: Re-run provider/auto‑map tests; diff generated files (expect no changes)\n
  - PR‑3/PR‑6: Snapshot derivations on representative targets; parity required\n
  - PR‑4: Confirm logs appear only outside CI; CI remains strict on overrides via templates\n
  - PR‑5: Add small zx tests to simulate duplicates/subdirs and assert lint behavior\n
- Backout:\n
  - Each PR touches a focused set of files; revert individually if any regression is observed\n
    \n

## Summary of Expected Impact\n

- Reduced duplication and tighter cross‑language parity in patching and planner code\n
- Single source of truth for provider naming and nix attribute normalization\n
- Cleaner diagnostics for dev overrides across languages without behavior changes\n
- Strengthened lint coverage for C++ patches to match Go/Node\n
