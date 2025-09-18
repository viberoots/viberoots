## Build System Dev Plan 4 — Close Remaining Gaps (No Node path, no sample conversion, no pre-commit hook)

Scope: Implement remaining items from build-system-design.md excluding Node importer-scoped flow, converting a sample target to macros, and adding a pre-commit hook. Follow AI-PREFERENCES and METHODOLOGY: minimal, deterministic changes; clear SoC; ≤250 LOC per file; measurable acceptance criteria.

### PR 1: Cross-platform patch workspaces (improve makeWorkspace)

- Goals:
  - Implement APFS CoW clone on macOS when available; fallback to cp -a.
  - For all other platforms, use cp -a.
- Files:
  - `tools/patch/cross-platform.ts`
- Acceptance:
  - macOS: if `cp -cR` works, workspace creation uses CoW; else cp -a.
  - Non-macOS: cp -a.
  - Existing patch-go tests pass unchanged.

### PR 2: Glue regeneration in install-deps

- Goals:
  - Ensure local developer setup regenerates glue after dependency steps so the repo is build-ready without manual steps.
  - Sequence: export-graph → sync-providers (Go) → gen-auto-map.
- Files:
  - `tools/dev/install-deps.ts`
- Acceptance:
  - Running `node tools/dev/install-deps.ts` on a repo with patches produces `tools/buck/graph.json`, `third_party/providers/TARGETS.auto`, and `third_party/providers/auto_map.bzl` without errors.
  - Idempotent: re-running does not change files if inputs are unchanged.

### PR 3: Nix templates warn on dev overrides (non-CI)

- Goals:
  - Emit a warning when `NIX_GO_DEV_OVERRIDE_JSON` is non-empty in local builds; keep CI hard-fail intact.
- Files:
  - `tools/nix/lang-templates.nix`
- Acceptance:
  - Local eval/build prints a single-line warning when overrides set.
  - In CI (`CI=true`), same code path throws as before.

### PR 4: Buck macros manual override escape hatch

- Goals:
  - Allow overriding provider deps in macros when necessary, without removing auto providers.
  - New kwarg: `extra_module_providers` (list of labels) appended to auto providers.
- Files:
  - `go/defs.bzl`
- Acceptance:
  - Default behavior unchanged.
  - When `extra_module_providers=["//third_party/providers:example"]` is provided, the macro includes them in deps in addition to auto_map providers.

### PR 5: Prebuild guard env & auto-fix documentation alignment (no code change required)

- Goals:
  - Align script behavior with design doc expectations: document envs and auto-fix behavior locally.
  - No functional change; ensure messages are crisp and stable.
- Files:
  - `tools/buck/prebuild-guard.ts` (message polish only if needed)
  - `docs/handbook/troubleshooting.md` (docs change, can ship together or in Docs PR below)
- Acceptance:
  - Env vars recognized: `PREBUILD_GUARD_NO_FIX`, `PREBUILD_GUARD_VERBOSE`, `PREBUILD_GUARD_SKEW_MS`, `PREBUILD_GUARD_LIST_LIMIT` documented; output matches docs.

### PR 6: Patches lint strictness toggle & docs

- Goals:
  - Keep existing advisory mode in install-deps.
  - Ensure `--strict` exits non-zero on violations; add short usage help.
- Files:
  - `tools/dev/patches-lint.ts`
  - Update usage in `README.md` or handbook.
- Acceptance:
  - `node tools/dev/patches-lint.ts --strict` fails on duplicate/malformed patches or subdirs.
  - Advisory mode remains non-blocking in `install-deps`.

### PR 7: Docs update (align with implementation)

- Goals:
  - Document macros usage and tuple labels; exporter tuple/caching; patching filename encoding and apply/reset details; startup-check; glue regeneration via install-deps; prebuild-guard envs.
- Files:
  - `docs/handbook/conventions.md` (TARGETS vs BUCK reminder, path invariants)
  - `docs/handbook/adding-language.md` (keep Node section brief; we are skipping Node work)
  - `docs/handbook/patching.md` (encoding `'/'→'__'`, one patch per module@version, `PATCH_EDITOR`, apply clears overrides and deletes workspace, `--force` overwrite rule)
  - `docs/handbook/testing.md` (PATH not modified in tests; coverage note remains)
  - `docs/handbook/troubleshooting.md` (prebuild guard envs, glue regeneration steps)
  - `README.md` (install-deps regenerates glue)
- Acceptance:
  - Docs reflect current behavior in codebase after PRs 1–6.

### PR 8: Exporter UX polish (optional, small)

- Goals:
  - Add a brief `--metrics-out` mention in docs; ensure metrics written when flag is set.
  - No behavioral change required.
- Files:
  - `tools/buck/export-graph.ts` (help text comment only)
  - Docs mention
- Acceptance:
  - Running with `--metrics-out tools/buck/export-metrics.json` writes a JSON summary; documented.

---

Dependencies and sequencing:

1. PR 1 (workspaces) — independent
2. PR 2 (install-deps glue) — independent
3. PR 3 (Nix warning) — independent
4. PR 4 (macros override) — independent
5. PR 5 (guard docs/message polish) — after PR 2 for consistent messaging
6. PR 6 (patches-lint strict & docs) — independent; update docs in PR 7
7. PR 7 (docs sweep) — after 1–6
8. PR 8 (exporter UX docs) — after 7 or folded into 7

Quality gates (per METHODOLOGY):

- File size checks: keep edits ≤250 LOC or split modules.
- Deterministic behavior: overlays guarded by env; install-deps idempotent; CI semantics unchanged.
- Tests: run full suite with external timeouts and coverage before merging each PR.

Verification checklist per PR:

- Local: `node tools/dev/install-deps.ts` (ensures glue), `buck2 build //...` (smoke), `timeout -k 10s 180s buck2 test //...`.
- CI: Jenkins stages already present; confirm green on each PR.

### PR 1 — Detailed Design: Cross-platform patch workspaces

Overview:

- Implement writable workspaces for Go module patch sessions with best-effort CoW/overlay and safe fallbacks. Keep behavior deterministic and simple. No root privileges required.

Behavior by platform:

- macOS:
  - Preferred: APFS CoW clone via `cp -cR <origin>/. <dst>/`.
  - Fallback: `cp -a <origin>/. <dst>/` when `-c` unsupported or fails.
- Others:
  - `cp -a <origin>/. <dst>/`.

Env toggles (tests/dev only):

- `NIX_GO_PATCH_BASE` (optional): Override base temp directory; defaults to `os.tmpdir()`.

Session lifecycle and cleanup:

- Start:
  - Determine platform and attempt preferred copy (CoW on macOS when available).
  - Create workspace directory name: `${safeModuleKey}-${YYYYMMDDhhmmss}` under base.
  - Update session store and set dev override (unchanged semantics).
- Apply/Reset:
  - Proceed with existing flow (diff → write patch → clear override → delete session) for apply; or just clear for reset.

Data model changes:

- None required.

Failure modes and fallback ladder:

- macOS: try `cp -cR`; on error, fall back to `cp -a` and continue.
- Others: `cp -a`.

Minimal code changes (≤250 LOC total budget across touched files):

- `tools/patch/cross-platform.ts`: implement cp -cR on macOS with cp -a fallback; cp -a elsewhere.
- No other code changes required.

Testing plan:

- Existing patch-go tests remain valid.
- Optional: add a zx test on macOS builders to ensure `cp -cR` path works (skip if unsupported), otherwise ensure copy fallback works.

Operational notes:

- No changes to Jenkins; no root privileges required.
- Startup-check keeps macOS CoW note; overlayfs messaging removed.

Acceptance criteria (expanded):

- macOS: on systems supporting `cp -cR`, start uses CoW (verified indirectly); fallback to `cp -a` otherwise.
- Non-macOS: start uses `cp -a`.
- All existing tests pass with external timeouts and coverage.
