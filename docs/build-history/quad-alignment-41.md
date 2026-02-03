# Quad Alignment Plan - Close Remaining Valuable Abstraction Gaps (CPP / Go / PNPM / Python) - Part 41

This installment follows Part 40 and focuses on the remaining gaps that are still worth closing now.

After reviewing the codebase against the contract inventory in `abstractions.md` and the design constraints in `build-tools/docs/build-system-design.md`, the remaining valuable (non-polish) gaps are:

- A concrete abstraction leak risk in Nix-calling rule implementations: some rules assemble `nix build` command flows in-line instead of routing through the shared helper surface. One path also masks failures (`|| true`), which makes behavior harder to reason about and can hide regressions.
- A remaining authoring drift risk in Starlark macro call sites: we are mostly using the shared helper surface, but there are still inconsistent macro parameter conventions (and at least one unused parameter that looks meaningful to call sites).
- A remaining legacy surface area risk: importer wiring and package-local wiring have both v2 and legacy implementations in the repo. The v2 boundary is in use, but the legacy internals remain and can still be imported accidentally unless we remove or quarantine them.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR-1: Unify Nix-calling rule command assembly across languages and remove failure masking from rule implementations

### Description

Node macros that call Nix already assemble their `nix build` flows via the shared helper surface (`//lang:nix_shell.bzl` and `//lang:nix_action_runner.bzl`).

Some lower-level rules still build command strings in-line. This is a contract duplication risk. It can drift on:

- `nix build` flags (`--no-link`, `--print-out-paths`, `--accept-flake-config`, `--impure`)
- out path capture and validation
- failure propagation and logging
- shared environment bootstrap behavior (WORKSPACE_ROOT / FLK_ROOT / graph export requirements)

This PR standardizes these Nix-calling rule implementations on the same shared helper surface and removes the one place that currently masks failure with `|| true`.

### Scope & Changes

- Refactor Nix-calling rule implementations to route through shared helpers:
  - `cpp/private/nix_build.bzl`:
    - Use a shared helper for selected-target out path capture and failure handling (do not hand-roll `OUT_PATH=$(...)` flows).
    - Ensure `nix build` out path capture uses a consistent structure (no out-links, deterministic capture, strict failure propagation).
  - `go/private/nix_build_wasm.bzl`:
    - Remove `|| true` from the preferred selected-wasm build attempt.
    - Use the same shared helper structure for out path capture and failure handling as the fallback path.

- Keep behavior identical where possible:
  - Preserve existing environment variables that are part of the contract (`BUCK_TARGET`, `BUCK_TEST_SRC`, `BUCK_GRAPH_JSON`).
  - Preserve existing “expected artifact path” checks and error messages unless they are currently misleading.

Non-goals in this PR:

- No changes to which flake attributes exist or how planner selection works.
- No changes to patch invalidation behavior.
- No changes to provider mapping or lockfile label semantics.

### Tests (in this PR)

- Add or extend command-shape tests that assert the key invariants for Nix-calling rules:
  - no `|| true` in Nix build capture flows in rule implementations
  - out path capture uses `--no-link --print-out-paths` where applicable
  - failure propagation is strict (non-zero status does not get masked)
- Extend one representative “can run the rule” smoke test for:
  - a C++ Nix-built artifact rule
  - a Go wasm Nix-built artifact rule

### Docs (in this PR)

- Update `build-tools/docs/build-system-design.md` (or the closest existing “Nix calling policy” section) to state:
  - rule implementations must not hand-roll `nix build` out path capture logic
  - rule implementations must not mask failures
  - the shared helper surface is the intended source of truth for command assembly

### Acceptance Criteria

- C++ and Go Nix-calling rule implementations do not contain in-line, duplicated Nix out path capture logic.
- The Go wasm rule no longer masks Nix build failure with `|| true`.
- Tests fail if failure masking or command-shape drift is reintroduced.

### Risks

Moderate. These rules are high-impact and small command changes can affect behavior in sandboxed or temp-workspace runs.

Mitigation:

- Keep changes limited to reusing existing helper functions and preserving existing env variables.
- Add command-shape tests to detect accidental drift.

### Consequence of Not Implementing

We keep accumulating duplicated Nix invocation logic. Small policy changes will land in one place but not others.

### Downsides for Implementing

Some churn in rule implementations and new tests that need to be maintained, but they encode the policy we already rely on.

### Recommendation

Implement.

---

## PR-2: Standardize macro parameter conventions across languages and remove or validate unused parameters at call sites

### Description

The shared wiring helpers are doing most of the work. The remaining authoring drift tends to happen at the macro surface.

When a macro accepts a parameter that looks meaningful but is unused (or overridden by label-derived behavior), call sites can silently become incorrect. This is a correctness and debuggability problem.

This PR standardizes macro parameter conventions across Node and Python (importer-scoped) and across Go and C++ (package-local), and removes or enforces any parameters that look meaningful but are not actually honored.

### Scope & Changes

- Importer-scoped macros (Node, Python):
  - Standardize on `lockfile_label` as the only source of importer identity.
  - If a macro accepts an `importer` argument:
    - either remove it, or
    - validate it matches the importer suffix of the lockfile label and fail fast on mismatch
  - Ensure each importer-scoped macro:
    - enforces exactly one lockfile label
    - derives importer from the label via shared helpers
    - does not allow silent disagreement between `importer` and the label

- Package-local macros (Go, C++):
  - Standardize the naming of macro-local escape hatches and keep them uniform:
    - `extra_module_providers` usage stays consistent and normalized at a single merge point
    - `nixpkg_deps` is always consumed through the shared package-local wiring helper surface
  - Standardize the “single labels merge point” and “single deps merge point” conventions across macro entrypoints.

Non-goals in this PR:

- No changes to label formats or importer support rules.
- No changes to provider mapping logic.
- No changes to patch invalidation behavior.

### Tests (in this PR)

- Add or extend one fail-fast test per affected macro surface:
  - Node: passing an explicit `importer` that disagrees with `lockfile_label` fails with a clear message (or confirm the parameter is removed and call sites are updated).
  - Python: same mismatch case fails fast.
- Extend an outcome-based cquery/probe test to confirm:
  - importer still derives from lockfile label
  - importer-local patches remain action inputs

### Docs (in this PR)

- Update the macro cookbook or handbook pages so the conventions are explicit:
  - `lockfile_label` is authoritative for importer identity
  - do not pass an `importer` argument unless the macro explicitly requires it and validates it
  - macros should follow “single labels merge point” and “single deps merge point”

### Acceptance Criteria

- Macro call sites can no longer silently pass inconsistent importer identity.
- Macro entrypoints across languages follow the same conventions and remain routed through shared helpers.
- Tests lock the fail-fast behavior so future changes do not reintroduce silent mismatch.

### Risks

Low to moderate. This is mostly macro surface cleanup, but it can break call sites if any were relying on the unused parameter.

Mitigation:

- Prefer validation over removal if there is any uncertainty about existing call site usage.
- Keep error messages specific and actionable.

### Consequence of Not Implementing

Call sites can keep carrying “looks meaningful” parameters that do not actually change behavior, leading to confusion and hard-to-debug reports.

### Downsides for Implementing

Call site churn and a small number of fail-fast tests that enforce conventions.

### Recommendation

Implement.

---

## PR-3: Remove legacy wiring implementations once enforcement proves they are unused, and tighten enforcement to prevent reintroduction

### Description

We have v2 non-mutating wiring surfaces in `lang/*` that are the intended macro boundary. Legacy mutating implementations still exist and can be imported accidentally.

This PR removes (or quarantines) the legacy wiring internals after tightening enforcement so we can prove they are unused in non-`//lang/*` call sites.

This reduces surface area and makes it harder to introduce new abstraction leaks by copy-pasting older patterns.

### Scope & Changes

- Tighten enforcement tests:
  - forbid `_legacy_mutating` usage outside `//lang/*`
  - forbid direct lockfile parsing helpers in macro entrypoints when a shared wiring helper exists
  - forbid direct use of low-level package-local kwarg pop helpers at macro boundaries when `prepare_package_local_wiring(...)` exists

- Remove or quarantine legacy wiring implementations:
  - importer wiring legacy mutation helpers
  - package-local wiring legacy mutation helpers
  - keep test-only probes as needed, but keep them routed through the v2 boundary

Non-goals in this PR:

- No semantic changes to patch models or provider wiring.
- No changes to exporter behavior.

### Tests (in this PR)

- Extend enforcement tests so they fail if any non-`//lang/*` Starlark code imports legacy wiring helpers.
- Keep at least one outcome-based probe test that asserts v2 wiring is non-mutating at the macro boundary.

### Docs (in this PR)

- Update `abstractions.md` to explicitly list the intended wiring surfaces:
  - importer-scoped: v2 only
  - package-local: non-mutating helper surface only
  - legacy surfaces are internal-only or removed
- Link to the enforcement tests as the guardrail.

### Acceptance Criteria

- Legacy wiring helpers are not available to macro call sites (or are explicitly internal-only and unreachable).
- Enforcement blocks reintroduction of legacy wiring patterns.
- Outcome-based tests prove wiring invariants are unchanged.

### Risks

Moderate. Removing legacy internals can break any hidden or out-of-tree call sites that relied on them.

Mitigation:

- Tighten enforcement first and run it across the repo.
- If needed, quarantine legacy helpers behind an explicit internal-only filename and do not re-export them from `lang/defs_common.bzl`.

### Consequence of Not Implementing

We keep two ways to do the same thing. This increases drift risk and increases review burden.

### Downsides for Implementing

Some churn in `lang/*` and enforcement tests. The benefit is lower long-term drift.

### Recommendation

Implement.

---

## Rollout and Sequencing

These PRs are ordered by dependency chain and to keep each PR revertible:

1. PR-1 first: unify Nix-calling rule command assembly and remove failure masking. This reduces cross-language drift at a high-impact boundary.
2. PR-2 next: macro parameter convention standardization and fail-fast validation to prevent silent mismatch.
3. PR-3 last: legacy wiring removal after enforcement proves it is unused.

---

## Verification and Backout Strategy

Each PR includes:

- at least one focused outcome-based test that asserts action-input and stamping invariants
- a documentation update that uses the shared contract vocabulary (`patch_scope:*`, `lockfile:*`, `nixpkg:*`, `lang:*`, `kind:*`, `kind:wasm`, `wasm:<variant>`)

Backout strategy:

- PR-1 can be reverted independently by restoring the previous in-line command assembly while keeping the new tests as detectors for future drift.
- PR-2 can be reverted independently by reverting macro signature changes and relaxing mismatch validation, but keep the test coverage for importer identity as the future guardrail.
- PR-3 can be reverted independently by reintroducing legacy internals temporarily if a hidden dependency is discovered, but do not re-export them from `lang/defs_common.bzl` without updating enforcement.
