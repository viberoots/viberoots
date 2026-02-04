# Quad Alignment Plan - Close Remaining Valuable Abstraction Gaps (CPP / Go / PNPM / Python) - Part 42

This installment follows Part 41 and focuses on the remaining gaps that are still worth closing now.

After reviewing the codebase against the contract inventory in `abstractions.md` and the design constraints in `build-tools/docs/build-system-design.md`, the remaining valuable (non-polish) gaps are:

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

- Update the “Nix calling policy” section (prefer `build-tools/docs/build-system-design.md`) to explicitly state:
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

## PR-4: Replace temp-repo “seed repo” caching with a Nix-store working-tree seed artifact (single build per verify run, no fallbacks)

### Description

The test harness currently uses a “seed repo” caching mechanism to speed up repeated temp repo creation. It is implemented in `build-tools/tools/tests/lib/seed-temp-repo.ts` and invoked via `build-tools/tools/tests/lib/test-helpers/run-in-temp.ts` (`initTempRepoFromWorkspaceOrSeed(...)`).

This has proven to be a meaningful performance lever, but it also introduces two drift risks:

- The seed cache lives outside Nix’s content-addressed store, so invalidation must be managed explicitly (seed key/versioning).
- Multiple test workers can attempt to “ensure” the seed concurrently unless we centralize the responsibility.

This PR replaces the seed cache with a **single, working-tree-derived Nix store artifact** created once per verify run, and consumed by all `runInTemp` callers.

Policy constraints for this PR:

- **No fallbacks.** We control the dev environment with Nix; required tools (`git`, `nix`, `rsync`/copy tooling) must be present.
- The primary path must be robust: if the seed cannot be prepared, tests must fail fast with a clear, actionable error.
- Because the seed is a Nix store artifact, we no longer need a separate `SEED_VERSION` invalidation knob; the seed’s identity is content-addressed via the computed seed key and Nix’s store hash.

### Scope & Changes

- Add a verify-scoped “seed artifact” step:
  - The verify runner (`build-tools/tools/dev/verify/run-verify.ts`) prepares a single seed store path **before** starting `buck2 test` (before `spawnVerifyBuck2Tests(...)`).
  - The seed store path is exported to tests via a single environment variable: `BNX_TEST_SEED_STORE_PATH`.
  - The seed export must be part of the same verify environment that already exports other per-run state (so all Buck test workers inherit it).
  - This PR removes the existing temp-repo seed cache mechanism in `build-tools/tools/tests/lib/seed-temp-repo.ts` (and any `SEED_VERSION`/seed-key caching state associated with it).

- Define a single deterministic seed key (per verify run):
  - Key includes:
    - the workspace identity (root path)
    - the current `HEAD` commit hash
    - the list of modified/untracked paths (from `git status --porcelain=v1 -z`)
    - any seed configuration knobs that affect the filtered seed contents
  - The key must be computed without scanning the filesystem outside `git` (no repo walks).
  - Invalidation is driven by the seed key + Nix store hashing; no standalone `SEED_VERSION` bump mechanism is required.
  - Key material must be normalized (stable ordering, no locale-dependent formatting) so two processes compute the same key for the same working tree.

- Build the seed as a Nix store path (working-tree snapshot):
  - Create a dedicated flake attribute for the seed, built from a filtered working tree snapshot (exclude volatile and heavy dirs like `buck-out/`, `.buck/`, `.cache/`, `node_modules/`, coverage/profiling dirs, etc.).
  - The build must be a pure “copy filtered snapshot into `$out`” derivation (no network, no dynamic discovery).
  - The filter must match the test harness’s existing “seeded temp repo shape” (i.e., the same exclusions currently enforced by `rsyncRepoTo(...)` and `seed-temp-repo.ts`) so the change is mechanical, not semantic.
  - The filter must be an **allowlist (whitelist)** of intended roots/files (mirroring the current seeded temp repo shape). It must not be an open-ended blacklist that risks silently including new heavy/volatile directories over time.

- Prevent repeated eval/build attempts:
  - The verify process is the single authority that computes/builds the seed.
  - `runInTemp(...)` must never attempt to invoke Nix to build/ensure the seed; it only consumes `BNX_TEST_SEED_STORE_PATH` and fails fast if it is missing/invalid.

- Ensure seed survival even if GC is triggered mid-run:
  - Verify must create an explicit GC root under the repo working tree (e.g., `buck-out/tmp/verify-seed/pins/<iso>/seed -> /nix/store/...-seed`) so `nix-collect-garbage` cannot delete it during the run.
  - The “pin” is cleaned up by verify at the end of the run.
  - Forced-stop robustness:
    - verify must register cleanup handlers for normal exit and common termination signals (`SIGINT`, `SIGTERM`) so pins do not leak on typical “stop the run” paths.
    - leaked pins are still possible under hard-kill (`SIGKILL`) or machine crash; to keep the primary path robust, verify must perform a deterministic startup sweep:
      - pins are iso-scoped (`pins/<iso>/...`) and contain an ownership marker (pid + start time)
      - on verify startup, remove any pin directories whose owner pid is not alive (or that exceed a conservative TTL, e.g. 24h)
      - this sweep is required housekeeping (not a fallback path) and must be safe and deterministic.

- Concurrency safety (cross-process):
  - Use the existing verify lock to scope the seed build so concurrent verifications in the same workspace do not race and do not create redundant seeds. The lock is already acquired in `build-tools/tools/dev/verify/run-verify.ts`.
  - Write a single “current seed pointer” file (under `buck-out/tmp/verify-seed/`) atomically so readers do not observe partial state.
  - Store the seed key alongside the pointer (`current.key`) to make diagnostics and stale-pin sweeps deterministic.

Non-goals in this PR:

- No semantic changes to patch/provider wiring, exporter behavior, or macro surfaces.
- No best-effort behavior: no `|| true` adjacent to the seed preparation path.

### Tests (in this PR)

- Add a focused test that asserts **verify exports a seed store path** and `runInTemp` consumes it without invoking Nix:
  - enforce that `runInTemp` does not call `nix build` for seeding when `BNX_TEST_SEED_STORE_PATH` is set
  - enforce that missing `BNX_TEST_SEED_STORE_PATH` is a **hard failure** in verify mode (no silent fallback)

- Add a test that simulates “seed missing” mid-run and asserts the failure mode is strict and actionable:
  - when `BNX_TEST_SEED_STORE_PATH` points at a missing path, `runInTemp` fails fast with a message that includes the missing path and guidance (“rerun verify”).

- Add a test for the GC-root pinning contract:
  - verify creates the pin path and it points at the seed store path
  - pin is removed at the end of verify (or on failure cleanup path)
  - verify startup performs a stale-pin sweep (removes orphaned/expired pins deterministically)

### Implementation Notes (so another engineer can implement without guessing)

- Proposed exported environment variables:
  - `BNX_TEST_SEED_STORE_PATH`: absolute `/nix/store/...-seed` path to the prepared seed artifact
  - `BNX_TEST_SEED_KEY`: the computed seed key string (for diagnostics and lock scoping)
  - `BNX_TEST_SEED_PIN_DIR`: absolute path to the per-run pin dir (e.g., `buck-out/tmp/verify-seed/pins/<iso>`)

- Proposed verify-owned state directory layout:
  - `buck-out/tmp/verify-seed/`
    - `current` (text file, seed store path)
    - `current.key` (text file, seed key)
    - `pins/<iso>/seed` (symlink to store path; GC root)
    - `pins/<iso>/owner.json` (pid + startedAt + seedKey; used for stale sweep)

- Proposed locking:
  - Use the existing verify lock infrastructure to avoid inventing new locking semantics.
  - Lock key example: `verify-seed:${seedKey}` (repo-identity scoped, cross-process).

- Proposed consumption in `runInTemp`:
  - If `BNX_TEST_SEED_STORE_PATH` is set, temp repo init must copy from it (no Nix calls).
  - Copy mechanism should reuse existing utilities (`copyTree(...)` / clone-aware copy) currently used in `seed-temp-repo.ts`.
  - If the path does not exist, fail fast with a message that includes:
    - missing path
    - seed key (if available)
    - a single actionable remediation (“rerun v”).

- Required cleanup:
  - verify must remove its own pin dir at the end of the run.
  - verify startup must sweep stale pin dirs (pid dead or TTL exceeded) deterministically.

### Docs (in this PR)

- Update `build-tools/docs/build-system-design.md` (or a dedicated test-harness section) to describe:
  - the verify-scoped seed artifact contract
  - the seed key composition rules
  - the “no fallbacks / fail fast” policy for seed preparation

### Acceptance Criteria

- A full `v` run builds the seed artifact **at most once** per verify run and shares it across all temp repos.
- Tests do not attempt seed preparation; they only consume the exported store path.
- If the seed store path is missing or invalid, tests fail fast with a clear message (no silent rebuilds).
- The seed store path cannot be GC’d during the verify run due to explicit pinning.

### Risks

Moderate. This changes the test harness architecture and introduces a new verify-stage artifact that must be correct across macOS/Linux environments.

Mitigation:

- Keep seed contents strictly filtered and minimal.
- Make failure mode strict and high-signal (no fallbacks).
- Add tests that lock the contract (single build, pinning, no per-test Nix calls).

### Consequence of Not Implementing

We keep paying the complexity cost of an out-of-store seed cache (manual invalidation/versioning) and remain exposed to run-to-run variance and concurrency edge cases.

### Downsides for Implementing

- Additional Nix attribute and verify orchestration work.
- Tighter coupling between verify and test harness setup (by design).

### Recommendation

Implement.

---

## Rollout and Sequencing

These PRs are ordered by dependency chain and to keep each PR revertible:

1. PR-1 first: unify Nix-calling rule command assembly and lock strict failure propagation at the rule layer.
2. PR-2 next: macro parameter convention standardization and fail-fast validation to prevent silent mismatch and call-site drift.
3. PR-3 next: rename preferred “v2” wiring surfaces to canonical names and quarantine primitives behind consistent naming + enforcement.
4. PR-4 last: move temp repo seeding to a verify-scoped Nix store artifact with strict failure semantics (no fallbacks).

---

## Verification and Backout Strategy

Each PR includes:

- at least one focused outcome-based test that asserts action-input and stamping invariants
- a documentation update that uses the shared contract vocabulary (`patch_scope:*`, `lockfile:*`, `nixpkg:*`, `lang:*`, `kind:*`, `kind:wasm`, `wasm:<variant>`)

Backout strategy:

- PR-1 can be reverted independently by restoring the previous rule command assembly while keeping the new tests as detectors for future drift.
- PR-2 can be reverted independently by reverting macro signature changes and relaxing mismatch validation, but keep the test coverage for importer identity as the future guardrail.
- PR-3 can be reverted independently by restoring old filenames temporarily if a hidden dependency is discovered, but keep the enforcement changes that prevent new call sites from importing primitives directly.
