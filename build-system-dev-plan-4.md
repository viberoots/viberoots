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

### PR 2 — Detailed Design: Glue regeneration in install-deps

Overview:

- Ensure a developer who runs `tools/dev/install-deps.ts` ends up with current glue files locally, without manual steps. Glue is not committed; this only prepares the workspace.

Invocation sequence (added near the end of install-deps):

1. `node tools/buck/export-graph.ts --out tools/buck/graph.json`
2. `node tools/buck/sync-providers.ts` (Go)
3. (Optional) `node tools/buck/sync-providers-node.ts` when PNPM lockfiles exist and the `yaml` package is resolvable
4. `node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`

Placement in `tools/dev/install-deps.ts`:

- After existing steps (pnpm lockfile handling, node-modules link, advisory `patches-lint`, and `gomod2nix` generation). This ensures the exporter sees any newly generated Go deps and that Go/Nix inputs are in place.

Gating and behavior:

- If `--dry-run` is passed (or `INSTALL_DEPS_DRY_RUN=1`), echo the four commands with no changes.
- If `buck2` is not available on PATH, print a warning and skip steps (1) and (4) that depend on the exported graph; still run `sync-providers.ts` to keep provider files aligned with patches.
- Node provider sync is best-effort: if no `**/pnpm-lock.yaml` files are present or `require('yaml')` fails, skip silently with a concise warning (consistent with tools/ci/run-stage.ts).

Idempotency:

- `sync-providers.ts` and `gen-auto-map.ts` already write deterministically and use a write-if-changed strategy; repeated execution should yield no diffs.
- `export-graph.ts` writes normalized, deterministic JSON. Re-running with unchanged inputs should produce identical file content (mtime may change, which is acceptable locally).

Flags and env:

- Reuse existing flags parser; add an optional `--skip-glue` that bypasses glue steps entirely (defaults to false). Honor `--dry-run`.
- `--verbose` (existing) should print the exact commands when glue steps run.

Errors and exit policy:

- Any non-dry-run glue sub-step failure should fail the script with a non-zero exit code.
- When `buck2` is missing, the script does not fail; it warns and skips exporter/auto-map. This keeps install-deps usable outside the dev shell while nudging devs to enter it.

Minimal edits (≤250 LOC budget across touched files):

- `tools/dev/install-deps.ts`
  - Add small helpers: `have(cmd: string): Promise<boolean>` and `runGlue(dryRun: boolean, verbose: boolean)`.
  - Append invocation near the end, gated by flags.

Testing plan:

- Add a zx test that runs `tools/dev/install-deps.ts --dry-run` in a temp copy and asserts the echoed glue commands appear in order.
- Add a zx test that creates a dummy Go patch file in `patches/go/…` and runs the glue section (with buck2 available in dev shell), then asserts:
  - `third_party/providers/TARGETS.auto` contains one provider rule for the dummy patch.
  - `third_party/providers/auto_map.bzl` is present and non-empty.
- Re-run to confirm no content changes (idempotency) when inputs are unchanged.

Acceptance criteria (expanded):

- Running `tools/dev/install-deps.ts` in a dev shell with Buck available produces fresh `graph.json` and `auto_map.bzl` and regenerates provider files based on patches.
- Running with `--dry-run` prints planned glue commands without performing changes.
- Running on a machine without `buck2` prints a single warning and completes without throwing, but still syncs provider files for Go patches.
- Repeating the command when repo inputs are unchanged leads to no content diffs in glue files.

### PR 3: Nix templates warn on dev overrides (non-CI)

- Goals:
  - Emit a warning when `NIX_GO_DEV_OVERRIDE_JSON` is non-empty in local builds; keep CI hard-fail intact.
- Files:
  - `tools/nix/lang-templates.nix`
- Acceptance:
  - Local eval/build prints a single-line warning when overrides set.
  - In CI (`CI=true`), same code path throws as before.

### PR 3 — Detailed Design: Nix templates warn on dev overrides

Overview:

- Align implementation with the design doc: when `NIX_GO_DEV_OVERRIDE_JSON` is set locally, print a concise, single-line warning during Nix evaluation; in CI (`CI=true`) hard-fail remains intact.

Exact changes (tools/nix/lang-templates.nix):

- Introduce a helper function to read overrides and emit a warning only when appropriate:

  ```nix
  # At top-level inside the file's `let` or adjacent scope used by templates
  readDevOverrides = envName: let
    v = builtins.getEnv envName;
    dev = if v == "" then {} else builtins.fromJSON v;
  in if (builtins.getEnv "CI") != "true" && dev != {}
     then builtins.trace "[NIX_GO_DEV_OVERRIDE_JSON active] Local derivation hashes will differ; unset before sharing cache artifacts." dev
     else dev;
  ```

- In both `goApp` and `goLib` templates, replace the direct `devOverrides` binding with:

  ```nix
  devOverrides = readDevOverrides devOverrideEnv;
  ```

- Preserve the CI guard exactly as-is (hard fail) immediately after `devOverrides`:

  ```nix
  _ = if (builtins.getEnv "CI") == "true" && (builtins.getEnv devOverrideEnv) != ""
        then builtins.throw "Dev overrides are forbidden in CI"
        else null;
  ```

Notes:

- `builtins.trace` prints once per template instantiation when overrides are present; the message is a single concise line to minimize noise while remaining visible.
- No change to derivation structure or hashes beyond the intended effect of the overrides.

Testing plan:

- Add a zx test `tools/tests/dev/nix-dev-overrides-warning.test.ts` that:
  - Runs under the dev shell with `NIX_GO_DEV_OVERRIDE_JSON='{"example@v1.0.0":"/tmp/src"}'` and `CI=` (unset).
  - Executes a lightweight evaluation that forces the templates to evaluate, capturing stderr to assert the warning appears exactly once:
    - For example, run:
      ```bash
      nix-instantiate --eval -E '
        let pkgs = import <nixpkgs> {}; T = import ./tools/nix/lang-templates.nix { inherit pkgs; };
        (T.goLib { name = "dummy"; modulesToml = ./gomod2nix.toml; }).pname or "ok"
      '
      ```
    - Assert stderr contains `[NIX_GO_DEV_OVERRIDE_JSON active]` and exit code is 0.
  - Repeat with `CI=true` and assert that evaluation fails with the CI error message.
- Wire the test via existing zx test rule so it participates in `buck2 test`.

Acceptance criteria (expanded):

- With overrides set and `CI` unset, Nix evaluation logs exactly one concise warning line per template evaluation site and proceeds.
- With `CI=true`, evaluation/build throws with the existing message, unchanged.
- No other behavior changes; full test suite remains green.

### PR 4: Buck macros manual override escape hatch

- Goals:
  - Allow overriding provider deps in macros when necessary, without removing auto providers.
  - New kwarg: `extra_module_providers` (list of labels) appended to auto providers.
- Files:
  - `go/defs.bzl`
- Acceptance:
  - Default behavior unchanged.
  - When `extra_module_providers=["//third_party/providers:example"]` is provided, the macro includes them in deps in addition to auto_map providers.

### PR 4 — Detailed Design: Macros `extra_module_providers` escape hatch

Overview:

- Add an opt-in macro kwarg `extra_module_providers` to `nix_go_library`, `nix_go_binary`, and `nix_go_test`. When present, these labels are appended to the macro’s deps in addition to the auto providers derived from `auto_map.bzl`. Defaults to empty to keep behavior unchanged.

Exact macro changes (go/defs.bzl):

- Signatures:
  - `def nix_go_library(name, deps = [], extra_module_providers = [], **kwargs): ...`
  - `def nix_go_binary(name, deps = [], extra_module_providers = [], **kwargs): ...`
  - `def nix_go_test(name, deps = [], extra_module_providers = [], **kwargs): ...`
- Implementation details:
  - Keep `_providers_for(name)` as-is to read generated `MODULE_PROVIDERS`.
  - Add a small helper `_normalize_labels(pkg, labels)` that:
    - Accepts a list of strings; raises a readable error if a non-string is provided.
    - Converts relative labels like `":foo"` to absolute `"//{pkg}:foo"` using `native.package_name()`.
    - Returns the normalized list as given (no re-sorting).
  - Merge order for final deps is:
    1. user `deps` (preserve order)
    2. auto providers from `_providers_for(name)` (preserve order from mapping)
    3. normalized `extra_module_providers` (preserve order)
  - Deduplicate with first-wins semantics across the concatenated sequence so that if the user duplicates a label, only the first instance remains.
  - Apply the merged list to the wrapped `go_*` rule.

Validation and UX:

- If `extra_module_providers` contains any non-string, raise `fail("extra_module_providers must be a list of string labels")`.
- Do not attempt to verify target existence at macro time (keeps macros fast and avoids cross-package coupling). Buck will surface missing labels normally.
- No change to how `MODULE_PROVIDERS` is loaded; prebuild guard continues to handle missing glue cases.

Non-goals:

- No environment or global toggle; purely per-macro explicit escape hatch.
- No implicit provider injection besides those already in `auto_map.bzl`.

Testing plan:

- Add zx tests under `tools/tests/scaffolding/` (or a new small group if preferred) that:
  1. Create a temporary package with a `TARGETS` using `nix_go_library` and set `extra_module_providers = ["//third_party/providers:mod_dummy"]`.
     - Assert via `buck2 cquery "deps(//tmp:lib)"` that `//third_party/providers:mod_dummy` is present.
  2. Ensure auto providers remain: seed a minimal `MODULE_PROVIDERS` mapping for the same target, then assert both the auto provider AND the extra are present.
  3. Relative label normalization: use `extra_module_providers = [":localprov"]` in a local package and assert it resolves to `//tmp:localprov` in deps.
  4. Deduplication: include the same label via `deps` and `extra_module_providers`; assert only one instance is present in deps.
- Wire these tests in root `TARGETS` similarly to existing zx tests.

Acceptance criteria (expanded):

- Default invocation of macros behaves identically to before (no `extra_module_providers`).
- Providing one or more labels in `extra_module_providers` appends them to deps alongside auto providers, with stable ordering and deduplication.
- Relative labels are normalized to absolute using the package name.
- New tests pass under Buck2 with the project’s external timeouts.

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
