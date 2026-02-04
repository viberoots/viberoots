## Quad Alignment Plan — Cross-Language Parity Tightening (CPP / Go / PNPM / Python) — Part 8

This installment focuses on small, surgical refactors to eliminate residual duplication, strengthen cross‑language consistency, and harden ergonomics around Nix integration. Each PR includes targeted tests and documentation updates within the same change. No functional behavior changes are intended for unchanged inputs; all changes are refactors or guardrails that preserve existing artifacts, labels, and mapping behavior.

---

## PR‑1: Shared‑layer hygiene — genericize `normalize_labels(...)` error text

### Description

Make the `normalize_labels(...)` error messaging argument‑agnostic so it applies beyond the historical `extra_module_providers` use‑case, improving reusability and clarity for macro authors.

### Scope & Changes

- `lang/defs_common.bzl`:
  - Adjust error strings in `normalize_labels(...)` to refer generically to “labels list” rather than a specific macro argument name.
  - No semantic change to normalization behavior.

#### Tests (in this PR)

- Negative tests expecting the stable error text for bad inputs (type/shape), updated to the new wording.

#### Docs (in this PR)

- Brief note: `normalize_labels(...)` is argument‑agnostic; macro authors should wrap with context if they need parameter naming in error messages.

### Acceptance Criteria

- All existing macro call‑sites continue to work; tests rely on stable error text only where asserted.

### Risks

- Low: message‑only change; tests updated accordingly.

### Consequence of Not Implementing

- Slight confusion/leak of a historical parameter name in a shared helper.

### Downsides for Implementing

- Adjust a couple of tests that assert on exact error text.

### Recommendation

Implement.

---

## PR‑2: Introduce `include_package_local_patches(...)` for package‑local patch dirs (Go/C++)

### Description

Create a tiny shared helper to attach package‑local patch dirs for non‑importer languages (Go/C++) to reduce small macro duplication and align call‑sites.

### Scope & Changes

- `lang/defs_common.bzl`:
  - Add `include_package_local_patches(kwargs, lang, default_dirs)` that delegates to `append_patch_srcs(...)` and dedupes.
- `build-tools/go/defs.bzl`, `build-tools/cpp/defs.bzl`:
  - Replace direct `append_patch_srcs(kwargs, ["patches/<lang>"])` with the new helper.
  - Defaults preserved (`patches/go`, `patches/cpp`); no behavior change.

#### Tests (in this PR)

- Label/input parity: representative Go and C++ targets keep identical `srcs` sets (patch files) and labels.

#### Docs (in this PR)

- Macro authoring note: prefer `include_package_local_patches(...)` for languages that use package‑local patch dirs (Go/C++).

### Acceptance Criteria

- Identical invalidation behavior when touching package‑local `*.patch` files.

### Risks

- Low: helper extraction only.

### Consequence of Not Implementing

- Minor duplication remains across Go/C++ macros.

### Downsides for Implementing

- Small code churn only.

### Recommendation

Implement.

---

## PR‑3: Standardize Nix shell bootstrap and timeouts in Node macros that call Nix

### Description

Adopt the shared `//lang:nix_shell.bzl` helpers in Node macros that shell out to Nix so these rules have uniform bootstrap and timeout handling across environments. This eliminates bespoke command assembly and aligns with our reliability goals.

### Scope & Changes

- `build-tools/node/defs.bzl`:
  - `node_webapp(...)`: prepend `nix_bootstrap_env()` and `nix_timeout_wrapper_var()` into `cmd`; preserve existing `global_nix_inputs()` stamping and importer derivation via `ensure_single_lockfile_label(...)` + `importer_from_labels(...)`.
  - `nix_node_cli_bin(bundle=True)`: same treatment as above for the bundled path.
- No behavior change for outputs; only command bootstrap/timeout wrapping is standardized.

#### Tests (in this PR)

- Smoke build on a sample importer for both `node_webapp` and bundled `nix_node_cli_bin` to verify success with timeouts active.
- Probe test: ensure `global_nix_inputs()` stamping persists (unchanged) and that importers are still derived via the shared helpers.

#### Docs (in this PR)

- Build‑system design note: macros that call Nix should prepend `nix_bootstrap_env()` and `nix_timeout_wrapper_var()` from `//lang:nix_shell.bzl`.

### Acceptance Criteria

- Identical artifacts for unchanged inputs; timeout/bootstrapping visible in the generated `cmd` for affected macros.
- Invalidation unchanged (still bound to `flake.lock` and importer‑local patches as before).

### Risks

- Low: command assembly refactor only.

### Consequence of Not Implementing

- Minor drift risk and inconsistent behavior around timeouts across environments.

### Downsides for Implementing

- Small churn to cmd strings and tests.

### Recommendation

Implement.

---

## PR‑3.5: Eliminate Nix out‑links and clean `buck-out/tmp` to prevent GC roots/store bloat

### Description

Standardize our Nix invocation patterns to avoid creating persistent GC roots and stale out‑links during builds/tests, and add a lightweight cleanup step for ephemeral Buck temp artifacts. This reduces unbounded growth of the Nix store caused by `--out-link` usage and `buck-out/tmp/buck-impure-*` leftovers.

### Scope & Changes

- `//lang:nix_shell.bzl`:
  - Guidance: from macro‑assembled shell `cmd`s, use `nix build --no-link --print-out-paths` and capture the output path via a shell variable instead of creating named out‑links with `--out-link`.
  - Optional follow‑up: provide a tiny helper snippet (as a Starlark string fragment) to capture the last printed out path into a variable, e.g. `OUT_PATH="$($TIMEOUT nix build ... --no-link --print-out-paths | tail -n1)"`.

- `build-tools/node/defs.bzl` (no output changes):
  - `node_webapp(...)`:
    - Replace `--out-link "$tmp/out"; outPath=$(readlink -f "$tmp/out")` with:
      - `outPath=$($TIMEOUT nix build .#node-webapp.<importer> --accept-flake-config --no-link --print-out-paths | tail -n1)`
      - Copy `"$outPath/dist"` to `$OUT` as before.
  - `nix_node_cli_bin(bundle=True)`:
    - Ensure the bundled artifact path is obtained without out‑links:
      - Either have the macro capture the printed out path directly (as above), or
      - Ensure `build-tools/tools/buck/node-cli-bundle.ts` uses `--no-link --print-out-paths` and prints the path for the macro to consume.
  - Preserve `global_nix_inputs()` stamping and importer derivation from PR‑3; only out‑link removal is new.

- Node bundler shim:
  - If `build-tools/tools/buck/node-cli-bundle.ts` shells to Nix, switch to `--no-link --print-out-paths` and print the absolute path via stdout; avoid creating named out‑links.

- Test scaffolding and examples:
  - Replace any remaining `nix build ... --out-link <path>` in zx tests with `--no-link --print-out-paths` and local capture.
  - Add a small zx test that asserts macro‑generated `cmd` strings contain no `--out-link` (via `buck2 cquery --output-attributes cmd`).

- Lightweight cleanup for Buck temp artifacts:
  - Add `build-tools/tools/dev/clean-temp-outs.ts`:
    - Removes stale `buck-out/tmp/buck-impure-*` (older than N minutes, default 30).
    - Optionally prunes temporary `result` symlinks under known temp roots if any remain from external tooling.
  - CI (`build-tools/tools/ci/run-stage.ts`): invoke `clean-temp-outs.ts` after each stage (best‑effort, non‑fatal). Provide a dev command to run it locally.

### Tests (in this PR)

- Node macro command checks:
  - `node_webapp` and bundled `nix_node_cli_bin` cquery `cmd` payloads do not contain `--out-link`.
  - Commands still include `nix_bootstrap_env()` and `nix_timeout_wrapper_var()` (from PR‑3).
- Functional smoke:
  - Webapp and bundled CLI still build successfully; artifacts are unchanged for identical inputs.
- Store/GC‑root probes (best‑effort):
  - Before/after a representative temp run, `nix-store --gc --print-roots | grep -E "nix-shell\\.|buck-impure-"` is reduced/empty after switching to `--no-link` and running the cleanup step.

### Docs (in this PR)

- `build-tools/docs/build-system-design.md`: add a “No out‑links” note for macros that call Nix; reference the cleanup helper and where it runs (dev + CI).

### Acceptance Criteria

- No `--out-link` appears in macro‑assembled `cmd` strings.
- Webapp and bundled CLI artifacts remain byte‑identical for unchanged inputs.
- Running representative builds/tests creates no persistent GC roots from out‑links; `buck-out/tmp` does not accumulate stale `buck-impure-*` across CI runs (post‑stage cleanup active).

### Risks

- Low: shell changes are minimal; incorrect path capture would break copy steps (covered by smoke tests).
- Very low performance impact; printed paths are as discoverable as out‑links for debugging.

### Consequence of Not Implementing

- Continued Nix store growth due to lingering out‑links and stale Buck temp directories.
- More frequent manual GC and store optimization needed by developers and CI.

### Downsides for Implementing

- Minor churn to `cmd` assembly in 1‑2 macro paths and a couple of tests.

### Recommendation

Implement.

---

## PR‑4: Consolidate provider TARGETS boilerplate per‑language

### Description

Reduce duplication in Node/Python provider writers by centralizing header/banner and auto‑section sentinels based on `lang`. Keep a single authoritative place to render standardized `TARGETS.*.auto` files.

### Scope & Changes

- `build-tools/tools/lib/provider-writer.ts`:
  - Add `writeImporterProvidersByLang(lang, providers, opts?)` that derives header, `load(...)` line, and auto‑section sentinels from `lang` when not explicitly provided.
  - Preserve stable formatting and collision detection logic.
- `build-tools/tools/buck/providers/{node,python}.ts`:
  - Switch to `writeImporterProvidersByLang(...)` to drop repeated header/sentinel wiring.
  - No change to provider content or ordering; logic remains identical.

#### Tests (in this PR)

- Golden output test for Node and Python `TARGETS.*.auto` to prove no textual diff in generated files vs prior version.
- Collision test remains in place to ensure name stability.

#### Docs (in this PR)

- Short contributor note: use `writeImporterProvidersByLang(...)` instead of per‑file boilerplate and language‑specific sentinels.

### Acceptance Criteria

- Byte‑for‑byte identical generated provider files for unchanged inputs.

### Risks

- Low: indirection consolidation only.

### Consequence of Not Implementing

- Continued boilerplate drift across languages.

### Downsides for Implementing

- Minor refactor churn; clearer API surface.

### Recommendation

Implement.

---

## PR‑5: Unified provider‑sync driver for importer‑scoped ecosystems (Node/Python)

### Description

Factor the common scaffolding in Node/Python provider sync into a generic “importer provider sync” driver that accepts pluggable lockfile discovery/parsing and effective‑set computation. Keep language‑specific parsing (pnpm/uv) behind the plugin boundary. Centralize workspace importer filtering (`apps/*` or `libs/*`).

### Scope & Changes

- `build-tools/tools/lib/importers.ts`:
  - Add `isWorkspaceImporterPath(path: string): boolean` for consistent filtering of supported importers.
  - Keep existing helpers (`computeImporterLabel`, `listImporterPatches`, etc.).
- `build-tools/tools/lib/provider-sync-driver.ts` (new):
  - Export `syncImporterProviders({ lang, discoverLockfiles, parseEffectiveSet, listImporterPatchesFor, decodePatchKey })` producing `ImporterProvider[]` and delegating to `writeImporterProvidersByLang(...)`.
- `build-tools/tools/buck/providers/{node,python}.ts`:
  - Switch to the shared driver with language‑specific plugins:
    - Node: `findImporterLockfiles` + `parsePnpmLock/effectiveSetForImporter` + `decodeNameVersionFromPatch`.
    - Python: `findUvLockfiles` + `parseUvLockKeys` + `decodeNameVersionFromPatch`.

#### Tests (in this PR)

- Golden outputs for Node/Python providers unchanged.
- Effective‑set spot checks continue to pass (Importer‑local patches matched to used keys only).

#### Docs (in this PR)

- Contributor note: when adding another importer‑scoped ecosystem, implement the plugin interface and reuse the driver.

### Acceptance Criteria

- No changes to provider names, contents, or ordering for unchanged inputs.

### Risks

- Low: extraction to a single driver with existing helpers.

### Consequence of Not Implementing

- Ongoing duplication and greater drift risk between Node and Python flows.

### Downsides for Implementing

- One small new library file; straightforward adoption at call‑sites.

### Recommendation

Implement.

---

## PR‑6: Consistency lint — label stamping and provider‑edge realization

### Description

Add a small, repository‑local lint/test suite that validates macro usage patterns for:

1. Presence of `lang:*` and appropriate `kind:*` (or `wasm:*`) stamps, and
2. Use of `realize_provider_edges(...)` (merging into `deps` for build/test rules, `srcs` for genrules).

### Scope & Changes

- `build-tools/tools/tests/`:
  - Add zx tests that instantiate minimal representative macros per language and assert:
    - Labels contain `lang:*` and the expected `kind:*`/`wasm:*` shape.
    - Provider edges realized in the correct attribute by inspecting cquery output attributes (`deps` or `srcs` materialization as applicable).

#### Tests (in this PR)

- The lint suite itself is the test artifact; it runs on CI and locally.

#### Docs (in this PR)

- Maintenance note: extending the lint with new macros requires adding one small test fixture per macro.

### Acceptance Criteria

- The lint passes across all existing macros; failures yield actionable guidance.

### Risks

- Low: read‑only validation; may surface latent inconsistencies which we fix in place.

### Consequence of Not Implementing

- Greater risk of subtle cross‑language drift over time.

### Downsides for Implementing

- Slightly longer CI/test time (minimal).

### Recommendation

Implement.

---

## Rollout & Sequencing

1. PR‑1 (Shared‑layer hygiene): message‑only change; unblocks other refactors with cleaner shared APIs.
2. PR‑2 (Package‑local patch helper): trivial extraction; reduces duplication in Go/C++ macros.
3. PR‑3 (Nix bootstrap/timeout standardization): improves reliability of Node macros that call Nix.
   3.5. PR‑3.5 (Out‑link elimination & tmp cleanup): remove `--out-link` usage and add lightweight cleanup for Buck temp outputs.
4. PR‑4 (Provider TARGETS boilerplate consolidation): centralize per‑language generation boilerplate.
5. PR‑5 (Importer provider‑sync driver): factor shared skeleton; adopt in Node/Python.
6. PR‑6 (Consistency lint): codify guarantees to prevent future drift.

---

## Verification & Backout Strategy

- PR‑1
  - Verification: unit tests asserting error text adjusted; no behavior changes to builds.
  - Backout: revert message change in `normalize_labels(...)`.
- PR‑2
  - Verification: `srcs` parity on Go/C++ targets; identical invalidation on patch edits.
  - Backout: inline `append_patch_srcs(...)` in macros as before.
- PR‑3
  - Verification: Node `webapp`/bundled CLI smoke builds pass; identical artifacts; timeouts applied.
  - Backout: drop bootstrap/timeout fragments from `cmd` assembly.
- PR‑3.5
  - Verification: cquery `cmd` shows no `--out-link`; smoke builds succeed; cleanup removes stale `buck-impure-*`; store roots from out‑links do not accumulate across runs.
  - Backout: revert the `--no-link` changes and skip the cleanup helper.
- PR‑4
  - Verification: golden provider files unchanged; name collision test still enforced.
  - Backout: restore explicit header/sentinels per file.
- PR‑5
  - Verification: golden provider outputs identical; effective‑set spot checks pass.
  - Backout: keep plugins, bypass shared driver and call existing per‑lang paths.
- PR‑6
  - Verification: lint passes on representative macros across languages.
  - Backout: remove lint suite; no data migration.

---

## Summary of Expected Impact

- **Reliability**: Nix bootstrap/timeout consistency in Node macros that call Nix.
- **Resource hygiene**: Reduced Nix store bloat by eliminating out‑links and cleaning stale Buck temp outputs.
- **Consistency**: Centralized provider TARGETS boilerplate and importer‑sync scaffolding.
- **Maintainability**: Less duplication in Go/C++ patch wiring; unified importer filtering; cleaner shared error messages.
- **Drift prevention**: A small, fast lint codifies label stamping and provider‑edge realization patterns across languages.
