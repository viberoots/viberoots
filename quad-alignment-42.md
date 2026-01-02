# Quad Alignment Plan - Close Remaining Valuable Abstraction Gaps (CPP / Go / PNPM / Python) - Part 42

This installment follows Part 41 and focuses on the remaining gaps that are still worth closing now.

After reviewing the codebase against the contract inventory in `abstractions.md` and the design constraints in `build-system-design.md`, the remaining valuable (non-polish) gaps are:

- A concrete abstraction leak risk in **Nix-calling rule implementations**: a small number of rules still assemble parts of their `nix build` flows “inline” (even when they partially use shared helpers). This is a drift risk for `nix build` flags, out path capture, and strict failure propagation. We also still have `|| true` patterns adjacent to these flows (often for “best-effort debug output”) that make it harder to enforce “no failure masking” consistently at the rule layer.
- A remaining authoring drift risk in **Starlark macro call sites**: we are mostly using the shared helper surface, but there are still inconsistent macro parameter conventions (especially around importer identity) and a few call-site parameters that can look meaningful while being redundant or enforced only inconsistently.
- A remaining legacy surface area risk: we have a preferred, non-mutating wiring boundary for importer-scoped macros, but it is currently named with a literal `v2` (`lang/importer_wiring_v2*.bzl`). If it’s the preferred interface, it should not be named like an alternate version. We should rename it to the canonical name and rename any older / lower-level surfaces according to what they are (primitives vs legacy), while keeping the overall naming scheme consistent.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR-1: Unify Nix-calling rule command assembly across languages and lock strict failure propagation (rules, not macros)

### Description

Node Nix-calling macros already assemble `nix build` flows via the shared helper surface (`//lang:nix_shell.bzl`, `//lang:nix_action_runner.bzl`).

Some **rule implementations** still carry their own variations of:

- `nix build` command assembly (flags, `--impure`, `--accept-flake-config`, out-path capture)
- graph-export prerequisites and “workspace root” bootstrapping
- log capture and error reporting conventions
- best-effort “debug” sub-commands (`|| true`) adjacent to the core build flow

This PR standardizes those rule implementations on the same shared helper surface and tightens the policy so that:

- out path capture is deterministic and policy-compliant (`--no-link --print-out-paths`, no out-links)
- failures are propagated strictly (no masking of `nix build` failure)
- “best-effort debug” remains possible, but is structured so enforcement can clearly distinguish debug-only from build-only logic

### Scope & Changes

- Refactor Nix-calling rule implementations to route through shared helpers:
  - `cpp/private/nix_build.bzl`:
    - Ensure out path capture is assembled only via `//lang:nix_shell.bzl` (`nix_build_out_path_cmd(...)`) and rule-layer workspace setup is via `//lang:nix_action_runner.bzl`.
    - Remove any duplicated “out path capture” patterns and ensure all required env variables remain part of the contract (`BUCK_TARGET`, `BUCK_TEST_SRC`, `BUCK_GRAPH_JSON`).
    - Restructure best-effort debug output so it cannot be misconstrued as failure masking in enforcement tests.
  - `go/private/nix_build_wasm.bzl`:
    - Remove `|| true` patterns in the failure path that are adjacent to build failure handling (for example log printing).
    - Use the same shared helper structure for out path capture and failure handling in both the preferred and fallback path.

Non-goals in this PR:

- No changes to which flake attributes exist or how planner selection works.
- No changes to patch invalidation behavior.
- No changes to provider mapping or lockfile label semantics.

### Tests (in this PR)

- Add or extend command-shape enforcement tests that assert the key invariants for Nix-calling rules:
  - no failure masking patterns adjacent to `nix build` in rule implementations (explicitly guard against `|| true` on build/capture lines)
  - out path capture uses `--no-link --print-out-paths` (through the shared helper surface)
  - build failure propagation is strict (non-zero status does not get masked)
- Extend one representative “can execute the rule” smoke test for:
  - a C++ Nix-built artifact rule
  - a Go wasm Nix-built artifact rule

### Docs (in this PR)

- Update the “Nix calling policy” section (prefer `build-system-design.md`) to explicitly state:
  - rule implementations must not hand-roll `nix build` out path capture logic
  - rule implementations must not mask failures
  - the shared helper surface is the intended source of truth for command assembly and out path capture

### Acceptance Criteria

- C++ and Go Nix-calling rule implementations do not contain duplicated, in-line Nix out path capture logic.
- Rule-layer Nix build failure propagation is strict and enforced by tests.
- Tests fail if failure masking or command-shape drift is reintroduced.

### Risks

Moderate. These rules are high-impact and small command changes can affect behavior in sandboxed or temp-workspace runs.

Mitigation:

- Keep changes limited to reusing existing helper functions and preserving existing env variables.
- Add command-shape tests to detect accidental drift.

### Consequence of Not Implementing

We keep accumulating duplicated Nix invocation logic in rule implementations. Small policy changes will land in one place but not others.

### Downsides for Implementing

Some churn in rule implementations and new tests that need to be maintained, but they encode policy we already rely on.

### Recommendation

Implement.

---

## PR-2: Standardize macro parameter conventions across languages and remove/validate misleading or redundant parameters at call sites

### Description

The shared wiring helpers are doing most of the work, so most remaining drift happens at macro surfaces:

- parameters that “look meaningful” but are redundant or only partially honored
- inconsistent naming/ordering conventions (`deps`, `labels`, escape hatches like `extra_module_providers`)
- importer identity ambiguity for importer-scoped macros (explicit `importer` arg vs `lockfile_label` suffix)

This PR standardizes macro parameter conventions across Node and Python (importer-scoped) and across Go and C++ (package-local), and removes or enforces any parameters that look meaningful but are not actually authoritative.

### Scope & Changes

- Importer-scoped macros (Node, Python):
  - Standardize on `lockfile_label` as the only source of importer identity.
  - If a macro accepts an `importer` argument:
    - either remove it, or
    - validate it matches the importer suffix of the lockfile label and fail fast on mismatch (single, consistent error message format across macros).
  - Ensure each importer-scoped macro:
    - enforces exactly one lockfile label
    - derives importer from the label via shared helpers
    - does not allow silent disagreement between `importer` and the label
  - Standardize the “single labels merge point” and “single deps merge point” convention in macro bodies so wiring order is deterministic and easy to review.

- Package-local macros (Go, C++):
  - Standardize the naming and semantics of macro-local escape hatches across Go/C++:
    - `extra_module_providers` stays normalized at a single merge point (package name + label normalization).
    - `nixpkg_deps` is always consumed through the shared package-local wiring helper surface (no call-site parsing).
  - Ensure both languages follow the same merge-point conventions:
    - one place where `labels` are merged/deduped
    - one place where `deps` are merged (including `extra_module_providers` and any repo-specific extras like CGO deps)

Non-goals in this PR:

- No changes to label formats or importer support rules.
- No changes to provider mapping logic.
- No changes to patch invalidation behavior.

### Tests (in this PR)

- Add or extend one fail-fast test per affected importer-scoped macro surface:
  - Node: passing an explicit `importer` that disagrees with `lockfile_label` fails with a clear message (or confirm the parameter is removed and call sites are updated).
  - Python: same mismatch case fails fast (or confirm the parameter is removed and call sites are updated).
- Extend an outcome-based cquery/probe test to confirm:
  - importer still derives from lockfile label
  - importer-local patches remain action inputs (list-shaped and dict-shaped attachment where applicable)
- Add an enforcement test that prevents reintroducing “multi-merge-point” macro bodies for `deps`/`labels` in the touched macro files (pattern-based, narrow scope).

### Docs (in this PR)

- Update the macro cookbook / handbook pages so the conventions are explicit:
  - `lockfile_label` is authoritative for importer identity
  - do not pass `importer` unless the macro explicitly requires it and validates it
  - macros should follow “single labels merge point” and “single deps merge point”

### Acceptance Criteria

- Macro call sites can no longer silently pass inconsistent importer identity.
- Macro entrypoints across languages follow consistent conventions and remain routed through shared helpers.
- Tests lock the fail-fast behavior so future changes do not reintroduce silent mismatch.

### Risks

Low to moderate. This is mostly macro surface cleanup, but it can break call sites if any were relying on the redundant parameter.

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

## PR-3: Rename preferred “v2” wiring surfaces to canonical names, and rename older surfaces by what they are (primitives vs legacy)

### Description

If a wiring surface is the preferred macro boundary, it should not be named with a literal `v2`.

Today we have:

- a preferred, non-mutating importer wiring surface named `lang/importer_wiring_v2*.bzl`
- a lower-level importer wiring surface named `lang/importer_wiring.bzl` that provides primitives used by the v2 boundary

This is a long-term drift risk:

- new call sites can pick the wrong import path
- docs/tests can “teach” new code to use the wrong surface
- “v2” naming becomes sticky even when it is the only intended interface

This PR renames the preferred surface to the canonical name and renames the older / lower-level surfaces according to how they are different. We keep things consistent across the repo and tighten enforcement so the intended boundaries remain hard to bypass.

### Scope & Changes

- Rename importer wiring surfaces (naming policy):
  - Preferred interface gets the simple name:
    - `lang/importer_wiring_v2.bzl` → `lang/importer_wiring.bzl`
  - Lower-level primitives are explicitly named as such:
    - current `lang/importer_wiring.bzl` → `lang/importer_wiring_primitives.bzl`
  - Nix-calling helper wrapper follows the same scheme:
    - `lang/importer_wiring_v2_nix_calling.bzl` → `lang/importer_wiring_nix_calling.bzl`
  - Probe helpers follow the same scheme:
    - `lang/importer_wiring_v2_probe.bzl` → `lang/importer_wiring_probe.bzl`

- Update all Starlark load sites and re-exports:
  - `lang/defs_common.bzl` continues to re-export only the preferred, canonical entrypoints for macro authorship.
  - Non-preferred surfaces (primitives) are either:
    - not re-exported from `defs_common.bzl`, or
    - re-exported only with clearly “internal/primitives” names (only if needed inside `//lang/*`).

- Tighten enforcement:
  - forbid non-`//lang/*` Starlark code from importing importer wiring primitives directly
  - require importer-scoped macro entrypoints to route through the preferred importer wiring boundary (directly or via `defs_common.bzl`)

Non-goals in this PR:

- No semantic changes to patch models or provider wiring.
- No changes to exporter behavior.

### Tests (in this PR)

- Extend enforcement tests so they fail if any non-`//lang/*` Starlark code imports the primitives surface (`importer_wiring_primitives.bzl`).
- Keep (and rename) the non-mutation probe test so it asserts the canonical importer wiring boundary does not mutate its input dict at the call-site boundary.
- Extend doc/reference tests (or small grep-based tests) to ensure no “v2” import paths remain in the repository for preferred wiring surfaces.

### Docs (in this PR)

- Update `abstractions.md` to list the intended wiring surfaces with the new canonical names:
  - importer-scoped: canonical importer wiring boundary (no “v2” naming)
  - importer wiring primitives: internal-only (or explicitly “primitives”)
- Update handbook pages that mention the importer wiring file paths to use the renamed, canonical paths.

### Acceptance Criteria

- Preferred wiring surfaces do not contain literal `v2` in filenames or import paths.
- Lower-level wiring helpers are named consistently as `*_primitives` (or, where truly necessary, `*_legacy`) and are not reachable from non-`//lang/*` macro call sites.
- Enforcement blocks reintroduction of legacy/v2 wiring patterns.
- Outcome-based tests prove wiring invariants are unchanged.

### Risks

Moderate. Renames have wide blast radius across Starlark and tests, and can break any hidden/out-of-tree call sites.

Mitigation:

- Tighten enforcement first (in the PR), then apply mechanical renames and update all call sites in one batch.
- Keep `defs_common.bzl` as the stable, discoverable surface for macro authorship.

### Consequence of Not Implementing

We keep two “public-feeling” ways to do the same thing, and the preferred one keeps advertising itself as optional/alternate (“v2”), increasing drift risk and review burden.

### Downsides for Implementing

Churn in filenames and import paths, plus some enforcement work. The benefit is lower long-term drift and more discoverable, consistent naming.

### Recommendation

Implement.

---

## Rollout and Sequencing

These PRs are ordered by dependency chain and to keep each PR revertible:

1. PR-1 first: unify Nix-calling rule command assembly and lock strict failure propagation at the rule layer.
2. PR-2 next: macro parameter convention standardization and fail-fast validation to prevent silent mismatch and call-site drift.
3. PR-3 last: rename preferred “v2” wiring surfaces to canonical names and quarantine primitives behind consistent naming + enforcement.

---

## Verification and Backout Strategy

Each PR includes:

- at least one focused outcome-based test that asserts action-input and stamping invariants
- a documentation update that uses the shared contract vocabulary (`patch_scope:*`, `lockfile:*`, `nixpkg:*`, `lang:*`, `kind:*`, `kind:wasm`, `wasm:<variant>`)

Backout strategy:

- PR-1 can be reverted independently by restoring the previous rule command assembly while keeping the new tests as detectors for future drift.
- PR-2 can be reverted independently by reverting macro signature changes and relaxing mismatch validation, but keep the test coverage for importer identity as the future guardrail.
- PR-3 can be reverted independently by restoring old filenames temporarily if a hidden dependency is discovered, but keep the enforcement changes that prevent new call sites from importing primitives directly.
