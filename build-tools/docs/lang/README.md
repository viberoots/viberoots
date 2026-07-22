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
   - Scaffolded languages remain disabled with `hermetic.status = "scaffold"`. Graduate them only
     after every hermetic contract field is proven and `reproducibilityMatrixIds` names the
     mandatory independent-builder evidence cases.

6. Define command ownership and tool authority:
   - `u` is the intended owner for deterministic tracked language metadata repair. `b` and
     `install-deps --glue-only` are read-only for tracked language metadata; do not add mutation to
     either path.
   - `i`, post-clone, and devshell entry validate tracked metadata without rewriting it; stale state
     names `u` as the repair command. None of these paths may invoke reconciliation or dependency
     upgrade.
   - Register the language with the canonical project-language consistency registry. Reuse that
     entry for read-only checks and `u --upgrade` support detection rather than adding parallel
     language-specific orchestration.
   - Add its exhaustive typed update handler. Conservative repair and bounded upgrade implementations
     use canonical Nix-store tools, the shared managed-command timeout and process-group shutdown,
     and byte-exact rollback for every tracked metadata file the ecosystem command can alter.
   - If the ecosystem supports dependency upgrades, implement that operation behind `u --upgrade`;
     do not use reconciliation-only as a placeholder for missing upgrade plumbing. A
     reconciliation-only handler is valid only when no upgradeable dependency authority exists.
   - Toolchain, update/install, startup, and runnable executables resolve from `/nix/store` through
     the shared tool-path authority or an explicit Nix-emitted path. Do not add host fallbacks.

7. Cover execution boundaries and resource guardrails:
   - Add hostile-`PATH`, Buck toolchain, runnable-manifest, and temp-consumer tests where applicable.
   - Add a bounded production-launcher fixture that proves `u` repair and either bounded upgrade or
     reconciliation-only `u --upgrade` behavior without changing viberoots gitlinks, flake pins, or
     source-mode metadata.
   - For an upgradeable language, assert the exact ecosystem upgrade argv and a failure case that
     restores prior file bytes and prior file presence or absence. Also prove successful upgrade
     moves the intended dependency authority. For reconciliation-only behavior, prove the ecosystem
     has no upgradeable dependency authority.
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
- A graduated `langs.json` contract covering source roles, dependency reconciliation, immutable
  bundle inputs, store-qualified tools, selector transport, sandbox/network policy, remote
  execution, publication admission, and reproducibility matrix IDs.

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
