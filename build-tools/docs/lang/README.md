# Language Design Docs - Enforcement Requirements

This directory holds language-specific design docs. When I add a new language, I must extend the
repository enforcement contract, not only planner/macros/providers.

## Required enforcement updates for every new language

1. Update migration inventory docs:
   - Add all public macros to `docs/handbook/nix-gaps.md`.
   - Classify each macro route as:
     - `Nix build`
     - `Buck build`
     - `Stub (artifact expected)`
     - `Probe-only exception`

2. Keep policy sources aligned:
   - If any macro is intentionally non-build, add it to
     `docs/handbook/nix-gaps-exceptions.json` with:
     - `macro`
     - `kind` set to `probe-only`
     - `justification`
   - Keep `artifactRouteAllowlist` explicit and temporary only.

3. Extend checker coverage when needed:
   - Ensure `build-tools/tools/dev/nix-gaps-inventory-check.ts` validates the new language's
     inventory and policy expectations.
   - If the new language introduces route-shape contracts, add implementation-aware checks for those
     contracts.

4. Add tests with the code change:
   - Add or extend tests under `build-tools/tools/tests/dev/` so drift fails deterministically.
   - Include both positive and negative assertions where route regressions are possible.

5. Keep verify and CI gate behavior in scope:
   - New language rollout is not complete until the enforcement checks are part of required repo
     validation flow.

6. Define command ownership and tool authority:
   - `u` is the intended owner for deterministic tracked language metadata repair. Do not extend the
     legacy `b` → `install-deps --glue-only` path, which can still refresh some Go/glue metadata while
     that boundary is migrated to read-only behavior.
   - `i` and post-clone validate tracked metadata without rewriting it; stale state names `u` as the
     repair command.
   - Toolchain, update/install, startup, and runnable executables resolve from `/nix/store` through
     the shared tool-path authority or an explicit Nix-emitted path. Do not add host fallbacks.

7. Cover execution boundaries and resource guardrails:
   - Add hostile-`PATH`, Buck toolchain, runnable-manifest, and temp-consumer tests where applicable.
   - Measure focused elapsed time and named disk paths according to
     `docs/handbook/getting-started-on-a-pr.md`; do not broaden snapshots or shared-cache copies to
     satisfy fixtures.

## Completion condition for language rollout docs

A language rollout doc in this directory is only complete when it includes:

- Macro inventory and route classification expectations.
- Exception policy expectations.
- Checker and test updates needed to prevent drift.
- Validation commands that contributors can run before merge.
- Explicit `u`/`i`/post-clone ownership, Nix-store tool authority, and runnable/toolchain wiring.
- Focused temp-repo, manifest, execution-time, and disk-growth evidence appropriate to the language.

## Canonical helper baseline

Language design docs should describe shared helper usage, not bespoke implementations, for common
cross-language contracts.

- For macro wiring, point to `prepare_language_wiring(...)` from
  `//build-tools/lang:defs_common.bzl` and the relevant `wiring` modes.
- For patch map + dev override behavior in Nix examples, prefer:
  - `H = import ../lib/lang-helpers.nix { inherit pkgs; };`
  - `H.patchesMapFromDir patchDir`
  - `H.readDevOverrides devOverrideEnv`
  - `H.guardNoDevOverridesInCI devOverrideEnv`
- Keep path examples aligned with repository conventions:
  - language docs under `build-tools/docs/lang/`
  - language patch dirs under `patches/<lang>/` unless a design explicitly requires importer-local
    package paths.
