## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 26

This installment follows Part 25. Part 25 focused on consolidating importer-scoped wiring and tightening Nix-calling macro behavior. In Part 26 I close the remaining gaps that still leak implementation constraints into call sites, or leave policy choices implicit.

The themes in this installment are:

- Make “rule shape constraints” a first-class part of the importer-scoped wiring abstraction, so call sites do not hand-roll special cases.
- Make importer-scoped provider patch inclusion policy explicit at the shared driver boundary, so new ecosystems cannot silently inherit the wrong behavior.
- Reduce bespoke bootstrapping and command assembly for Node macros that call Nix by standardizing the “find workspace root + find flake root + unified store” flow.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Generalize “importer-scoped patches for rules that cannot accept `srcs`” and refactor Python `nix_python_binary` to use it

### Description

Importer-scoped macros are intended to use one canonical helper surface: `//lang:importer_wiring.bzl`. That helper surface already handles lockfile label enforcement, label stamping, importer derivation, patch inputs, and provider edges.

There is one recurring leakage point. Some underlying Buck rule shapes cannot accept `srcs` (or cannot accept the attribute we would prefer to use for action inputs). Python `python_binary` is the current example. Today the macro compensates by creating a synthetic dep that carries patch inputs. This is correct but it is call-site knowledge that will be easy to duplicate incorrectly if we add a second “srcs-less” macro later.

This PR makes that “srcs-less rule shape” pattern a first-class helper in `//lang:importer_wiring.bzl`, and then refactors `python/defs.bzl:nix_python_binary` to use the shared helper.

Clarification: We do not need to preserve backwards compatibility yet. This PR can change macro call paths and helper surfaces directly, with no intermediate migration steps, no compatibility shims, and no legacy-argument linting.

### Scope & Changes

This PR changes wiring only. The goal is behavior stability and reduced drift risk.

- Add a new helper in `//lang:importer_wiring.bzl` that:
  - enforces exactly one importer-scoped lockfile label (delegating to `//lang:lockfile_labels.bzl` via the existing wrapper)
  - derives the importer
  - creates a synthetic dep that carries importer-local patch inputs as real action inputs
  - returns a struct that includes:
    - the importer string
    - the synthetic dep (label and rule kwargs)
    - a helper for merging provider edges deterministically into the caller’s deps
- Refactor `python/defs.bzl:nix_python_binary` to use that helper instead of hand-assembling the synthetic dep logic.
- Keep `python/defs.bzl:nix_python_library`, `nix_python_test`, and `nix_python_wasm_*` unchanged in this PR. They already route through `prepare_importer_non_genrule_wiring(...)` and can carry patch inputs directly when the rule shape allows it.

### Tests (in this PR)

I will extend the probe-style tests so the invariant is locked down in terms of action inputs and provider edges.

- Add a probe test that proves the synthetic dep created for a srcs-less rule:
  - is deterministic in its name (derived via the canonical sanitizer)
  - contains importer-local patch files as real action inputs (in a stable attribute such as `resources`)
  - is reachable from the parent macro target (so patch edits invalidate reverse deps deterministically)
- Add a test that verifies the lockfile label contract failures remain deterministic for `nix_python_binary` (missing, malformed, unsupported importer).

### Docs (in this PR)

I will update documentation so the exception case is described in terms of the shared helper, not in terms of “Python does something special.”

- Update `docs/handbook/adding-language.md`:
  - add a section describing the srcs-less rule shape helper and when to use it
  - include a short example for Python binaries
- Update `abstractions.md`:
  - describe srcs-less rule shapes as an explicit part of the importer-scoped contract and point at the helper surface

### Acceptance Criteria

- `nix_python_binary` no longer hand-assembles importer patch invalidation logic.
- The srcs-less rule shape helper exists in `//lang:importer_wiring.bzl` and is used by `nix_python_binary`.
- Tests prove importer-local patch invalidation is preserved and lockfile contract failures remain deterministic.

### Risks

Moderate. The main risk is shifting which attribute carries the patch inputs for the synthetic dep. The test should assert the invariant (patch inputs are real action inputs) rather than exact formatting.

### Consequence of Not Implementing

We keep a known leak. The next srcs-less macro will likely re-implement the synthetic dep pattern and drift on naming, enforcement, or inputs.

### Downsides for Implementing

This adds one more helper surface. The payoff is fewer macro call sites carrying rule-shape-specific logic.

### Recommendation

Implement.

---

## PR‑2: Make importer-scoped provider patch inclusion policy explicit and mandatory in `provider-sync-driver`

### Description

Importer-scoped provider generation is shared across ecosystems via `tools/lib/provider-sync-driver.ts`. The driver already supports the two intentional policies:

- Node: include all importer-local patch files (even if not in the lockfile effective set).
- Python: include only importer-local patches that match the lockfile effective set.

Today the driver has a default when the policy is not provided. This is convenient, but it makes it easy for a future ecosystem (or a refactor) to silently inherit the wrong policy.

This PR makes the policy explicit at the shared driver boundary by requiring `importerPatchInclusionPolicy` to be provided, and then updates Node and Python provider generators accordingly.

Clarification: We do not need to preserve backwards compatibility yet. This PR can be a breaking change to internal TypeScript tooling APIs, with no migration period and no adapter/wrapper layer for older call sites.

### Scope & Changes

This PR is focused on TypeScript tooling only. It does not change macro behavior and it does not change the label contract.

- Change `tools/lib/provider-sync-driver.ts` so `importerPatchInclusionPolicy` is required (no default).
- Update:
  - `tools/buck/providers/node.ts` to pass `"all"` explicitly (already does today, but the call becomes required).
  - `tools/buck/providers/python.ts` to pass `"effective-set-only"` explicitly (already does today, but the call becomes required).
- Add a small assertion or error message in the driver that fails fast if an unknown policy is provided (defensive, not user-facing).

### Tests (in this PR)

I will keep the tests focused on the policy outcome, not implementation details.

- Keep and extend the existing test that asserts:
  - Node includes all importer-local patches
  - Python filters importer-local patches to the effective set
- Add one test that ensures a call site cannot “forget” the policy:
  - This can be expressed as a compile-time TypeScript check (preferred), and also as a runtime assertion in a direct unit test that exercises the driver with a missing policy (if the type-level change is not enough to prevent regressions in build output).

### Docs (in this PR)

I will update docs where provider generation is described so the policy is explicit and tied to the shared driver.

- Update `docs/handbook/patching.md`:
  - document the two patch inclusion policies and why they differ between Node and Python
  - point at `tools/lib/provider-sync-driver.ts` as the implementation surface

### Acceptance Criteria

- The driver requires a patch inclusion policy and does not silently default.
- Node and Python provider generation keep their existing behavior, with tests proving it.
- Docs describe the policy choice explicitly and point at the shared driver.

### Risks

Low. This is mostly a hardening change. The main risk is missing a call site that uses the driver indirectly.

### Consequence of Not Implementing

We keep an implicit default that can be inherited accidentally by new ecosystems or refactors.

### Downsides for Implementing

Small churn across provider generator call sites.

### Recommendation

Implement.

---

## PR‑3: Standardize Node Nix-calling macro bootstrapping and command assembly for workspace-root and flake-root detection

### Description

Node has a small set of macros that “call Nix” via a genrule-style shell command (for example webapp builds and CLI bundling). These macros correctly use `//lang:nix_shell.bzl` for the core bootstrapping, but they still contain bespoke logic for:

- sourcing a workspace root environment file (for tests and temp repos)
- deciding whether to skip unified PNPM store requirements
- assembling a consistent “nix build and capture out path” command prefix

This is correct but it concentrates complexity in Node macro files and makes it harder to keep behavior consistent as we evolve the bootstrap contract.

This PR introduces one small helper surface in `//lang:nix_shell.bzl` that standardizes the “workspace-root + flake-root bootstrap” flow used by Node Nix-calling macros, and then refactors the Node macros to use it.

Clarification: We do not need to preserve backwards compatibility yet. This PR should do a direct cutover of the Node macro implementations (no staged rollout, no dual-path code, no transitional flags).

### Scope & Changes

This PR is macro wiring and shell command assembly only. It does not change provider generation and it does not change label contracts.

- Add a helper in `//lang:nix_shell.bzl` that:
  - optionally sources `tools/buck/workspace-root.env`
  - standardizes how `WORKSPACE_ROOT`, `REPO_ROOT`, and `FLK_ROOT` are derived in a genrule sandbox
  - optionally disables unified store enforcement when the macro’s contract requires it (for example bundling scenarios)
  - composes with `nix_cmd_prefix(...)` and `nix_build_out_path_cmd(...)` so call sites do not assemble partial variants
- Refactor:
  - `node/defs_nix.bzl:node_webapp`
  - `node/defs_nix.bzl:nix_node_cli_bin(bundle=True)`
    to use the helper, reducing bespoke pre-env logic.
- Keep existing debug logging behavior, but gate it behind an explicit env flag so default builds stay quiet.

### Tests (in this PR)

I will prefer tests that validate invariants rather than asserting exact command strings.

- Add or extend a probe test that:
  - builds a Node Nix-calling macro in a temp repo scenario where `WORKSPACE_ROOT` must be derived via `tools/buck/workspace-root.env`
  - asserts the macro can find `flake.nix` deterministically and proceeds far enough to execute the planned command prefix
- Add a focused test that ensures the macro still wires global Nix inputs as real action inputs when `stamp=True`, and does not stamp when the macro contract says `stamp=False`.

### Docs (in this PR)

I will document the new helper surface as the canonical path for Node macros that call Nix via shell commands.

- Update `docs/handbook/node-macros.md`:
  - document the standardized bootstrap helper, with one minimal example for a Nix-calling genrule macro
- Update `build-system-design.md`:
  - reference the helper as the implementation surface for consistent workspace-root and flake-root detection for Nix-calling macros

### Acceptance Criteria

- Node Nix-calling macros no longer hand-assemble workspace-root and flake-root bootstrapping logic.
- Tests prove the standardized flow works in the temp repo / workspace-root injection scenario.
- Documentation points at the helper surface as the canonical approach.

### Risks

Moderate. These macros are sensitive to subtle environment differences. The test must cover the known failure mode: “flake root not found in sandboxed genrule execution.”

### Consequence of Not Implementing

We keep bespoke bootstrapping in Node macros. Future changes to workspace-root discovery will require multiple coordinated edits and are likely to drift.

### Downsides for Implementing

Some macro churn and test complexity for sandboxed behavior.

### Recommendation

Implement.

---

## PR‑4: Consolidate provider-sync entrypoints and documentation on the unified orchestrator surface

### Description

We already have a unified provider sync entrypoint in `tools/buck/sync-providers.ts`, and we also keep thin wrappers (`sync-providers-node.ts`, `sync-providers-python.ts`) for compatibility and discoverability.

This is acceptable, but it can become a source of drift if the wrappers gain behavior, or if documentation references multiple “canonical” entrypoints.

This PR keeps the wrappers only as strict delegators (or removes them if they are not needed), and updates documentation to consistently reference the unified orchestrator.

Clarification: We do not need to preserve backwards compatibility yet. If wrapper entrypoints are not required internally, remove them rather than keeping legacy surfaces; no migration shims or deprecation window is necessary.

### Scope & Changes

This PR is tooling surface consolidation only.

- Ensure the wrapper entrypoints:
  - contain no substantive logic
  - delegate directly to the canonical provider sync implementations
- If wrappers are unused, remove them and update any call sites accordingly.
- Ensure docs point to the orchestrator entrypoint (`tools/buck/sync-providers.ts`) as canonical.

### Tests (in this PR)

I will keep tests stable and focused on behavior.

- Add a test that asserts wrapper scripts are delegators only:
  - the wrappers must not import provider-sync internals directly beyond the canonical entrypoint they delegate to
  - the wrappers must not implement their own flag parsing or output routing
- Keep existing provider golden tests unchanged.

### Docs (in this PR)

- Update `docs/handbook/patching.md` and `docs/handbook/adding-language.md`:
  - document only the orchestrator entrypoint as canonical
  - mention wrappers only as backwards-compat aliases if they remain

### Acceptance Criteria

- There is one documented canonical provider sync entrypoint.
- Wrapper scripts cannot drift because tests enforce their “delegator only” role (or wrappers are removed).

### Risks

Low. The main risk is breaking a workflow that calls a wrapper directly. If that risk is real, wrappers should remain but be locked down as delegators.

### Consequence of Not Implementing

We keep multiple entrypoints with ambiguous “which one is canonical,” which increases review friction and drift risk.

### Downsides for Implementing

Small churn in tooling and docs. Minimal functional benefit, but it reduces confusion.

### Recommendation

Implement if wrappers are actively used. Otherwise, remove them and keep the unified orchestrator only.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and by how isolated the changes are:

1. PR‑1 first. It adds the missing shared helper for srcs-less rule shapes and refactors the one known call site (Python binary).
2. PR‑2 next. It hardens provider generation policy at the shared driver boundary with low blast radius.
3. PR‑3 next. It reduces bespoke Node macro bootstrapping by introducing a standardized helper surface and migrating call sites.
4. PR‑4 last. It is tooling surface cleanup and should be last so earlier PRs do not need to reconcile entrypoint churn.

---

## Verification & Backout Strategy

Each PR includes:

- at least one focused test that asserts the relevant macro or tooling contract behavior
- a doc update that points at the canonical helper surface and describes the contract using the same terms used by the tests

Backout strategy:

- Each PR is independently revertible.
- If PR‑3 exposes a missing edge case in sandbox bootstrapping, I will keep the helper surface but revert only the macro migrations and iterate on the helper until the invariant is stable.
