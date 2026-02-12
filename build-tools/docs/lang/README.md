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

## Completion condition for language rollout docs

A language rollout doc in this directory is only complete when it includes:

- Macro inventory and route classification expectations.
- Exception policy expectations.
- Checker and test updates needed to prevent drift.
- Validation commands that contributors can run before merge.
