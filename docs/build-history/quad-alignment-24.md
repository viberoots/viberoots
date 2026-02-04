## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 24

This installment follows Part 23. Part 23 established most of the shared helper surfaces I want to rely on going forward:

- `//lang:nix_calling_macros.bzl:wire_global_nix_inputs(...)` for “macro calls Nix” global inputs wiring.
- `//lang:importer_wiring.bzl:prepare_importer_genrule_kwargs(...)` and `prepare_importer_non_genrule_wiring(...)` for importer-scoped wiring.
- `//lang:defs_common.bzl:wire_planner_visible_stub(...)` and `wire_planner_visible_inputs(...)` for planner-visible stubs and “providers into srcs” shims.

In Part 24 I focus on the remaining seams I still see in the codebase after parity work:

- Node macros that call Nix still hand-assemble importer-scoped wiring (lockfile enforcement, importer derivation) in `build-tools/node/defs_nix.bzl` instead of using the shared helper surface.
- Node macros that call Nix still hand-assemble the “bootstrap + timeout + nix build out-path” command prefix sequence. The primitives exist in `//lang:nix_shell.bzl`, but the final “compose a safe cmd string” pattern is still duplicated.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Refactor Node Nix-calling macros to use shared importer-scoped non-genrule wiring

### Description

Node has a small set of macros that shell out to Nix or invoke Nix-adjacent tooling. These macros need importer-scoped behavior:

- exactly one `lockfile:<path>#<importer>` label
- deterministic importer derivation
- importer-local patch inputs attached to the action inputs
- provider edges merged deterministically

The repo already has a shared helper for the “non-genrule” path (`prepare_importer_non_genrule_wiring(...)`). `build-tools/node/defs_nix.bzl` still repeats parts of this sequence (for example it calls `ensure_single_lockfile_label(...)` and `importer_from_labels(...)` directly).

This PR removes that duplication and makes `build-tools/node/defs_nix.bzl` depend on the same shared helper that other importer-scoped macros use.

### Scope & Changes

This PR changes Node macro wiring only. The goal is behavior stability and contract consolidation.

- Refactor `build-tools/node/defs_nix.bzl:node_webapp` to:
  - delegate lockfile enforcement and importer derivation to `prepare_importer_non_genrule_wiring(...)`
  - attach importer-local patches through the helper surface (not by re-deriving importer manually)
  - keep existing `wire_global_nix_inputs(...)` usage for global inputs
- Refactor `build-tools/node/defs_nix.bzl:nix_node_cli_bin(bundle=True)` to:
  - delegate lockfile enforcement and importer derivation to `prepare_importer_non_genrule_wiring(...)`
  - keep dict-shaped `srcs` wiring, but attach importer patch inputs and provider edges via the helper rather than ad-hoc logic
  - keep the existing entry contract (`entry == "src/index.ts"`) unchanged
- Keep `build-tools/node/defs_core.bzl` unchanged unless it becomes a net reduction in duplication (this PR is intentionally narrow to `build-tools/node/defs_nix.bzl`).

### Tests (in this PR)

I will update the existing Node macro tests to prove behavior did not change and to catch partial-wiring regressions:

- Extend the `build-tools/tools/tests/node/*lockfile*` tests to assert:
  - both `node_webapp` and bundled `nix_node_cli_bin` fail with the same deterministic error text when the lockfile label is missing or malformed
  - importer derivation remains stable for `lockfile:././apps/web/pnpm-lock.yaml#apps/web`
- Extend the `build-tools/tools/tests/node/*global-inputs*` tests to keep asserting global inputs are real action inputs after the refactor (list-shaped and dict-shaped cases).
- Add one focused macro expansion test (cquery shape test) proving importer-local patches are present as action inputs for:
  - `node_webapp` (list-shaped `srcs`)
  - bundled `nix_node_cli_bin` (dict-shaped `srcs`)

### Docs (in this PR)

I will update the docs where users are pointed at the Node Nix macros so they reflect the shared helper surfaces:

- `docs/handbook/node-macros.md`:
  - note that `build-tools/node/defs_nix.bzl` uses the shared importer wiring helper (non-genrule path)
  - point at `//lang:importer_wiring.bzl` for the canonical contract text and error behavior
- `docs/handbook/macro-stamping-cookbook.md`:
  - add a short section under Node describing that Nix-calling macros still use importer-scoped wiring helpers (and that lockfile label enforcement is not optional)

### Acceptance Criteria

- `build-tools/node/defs_nix.bzl` no longer directly calls `ensure_single_lockfile_label(...)` / `importer_from_labels(...)` for primary wiring.
- Node Nix-calling macros enforce the lockfile label contract via `prepare_importer_non_genrule_wiring(...)`.
- Existing Node macro tests pass and continue to prove:
  - global Nix inputs are real action inputs
  - dict-shaped `srcs` remain correct
  - lockfile contract failures remain deterministic

### Risks

Moderate. The main risk is changing the shape of `srcs` (list vs dict) or moving provider edges into the wrong attribute. Tests must assert the final cquery-visible inputs and keep the command strings stable enough for existing tests.

### Consequence of Not Implementing

Node’s importer-scoped contract stays duplicated across macro files. This increases drift risk and makes future lockfile-label tightening costlier.

### Downsides for Implementing

Small macro churn and test updates. The payoff is fewer call sites that can “almost” follow the contract.

### Recommendation

Implement.

---

## PR‑2: Consolidate Nix command string assembly for macros that call Nix (reduce call-site footguns)

### Description

`//lang:nix_shell.bzl` provides primitives (bootstrap env, timeout wrapper, command-substitution escaping, and `nix build --no-link --print-out-paths` capture). Today, each macro that shells out to Nix still composes these primitives manually into a `cmd` string.

This is correct, but it is easy to partially apply. I can forget to:

- escape `$(...)` to `$$(...)` (Buck parsing)
- include `nix_timeout_wrapper_var(...)`
- include the right bootstrap (core vs pnpm store)
- keep the “no out-link” invariant

This PR introduces a small helper surface in Starlark that returns a safe, reusable `cmd` prefix and a “build attr and capture outPath” snippet so call sites become hard to get wrong.

### Scope & Changes

- Add a small helper (new file under `//lang`, or extend `//lang:nix_shell.bzl`) that:
  - provides a canonical “prefix” for Nix-calling macros:
    - bootstraps `WORKSPACE_ROOT` / `FLK_ROOT` deterministically
    - optionally bootstraps unified PNPM store env
    - installs the timeout wrapper variable
    - applies `escape_buck_cmd_subst(...)` where required
  - provides a canonical snippet to resolve a flake attr to `outPath` using:
    - `nix build --no-link --print-out-paths | tail -n1`
- Refactor `build-tools/node/defs_nix.bzl:node_webapp` to use the helper for cmd assembly.
- Refactor bundled `nix_node_cli_bin(bundle=True)` only where it reduces duplication without obscuring the debugging flow. If bundling remains intentionally bespoke, keep it bespoke but use the helper for the common bootstrap + timeout prefix.

### Tests (in this PR)

I will extend the existing Node macro command-string tests to lock down that the helper preserves key invariants:

- Existing tests that assert “timeout and bootstrap cmd prefix” remain valid (update expected text if it changes, but keep assertions focused on invariants rather than full string equality).
- Add one focused test that fails if the generated cmd contains:
  - `nix build` with `--out-link` (forbidden)
  - unescaped `$(...)` command substitutions (Buck parsing hazard)

### Docs (in this PR)

- `docs/handbook/macro-stamping-cookbook.md`:
  - document the new helper as the canonical way to build Nix command strings
  - include one concrete example for a list-shaped `srcs` macro (webapp)
  - include one concrete example for a dict-shaped `srcs` macro (bundled CLI)
- `build-tools/docs/build-system-design.md`:
  - reinforce the “no out-link” rule at the macro layer and point at the helper as the implementation surface

### Acceptance Criteria

- Node Nix-calling macros assemble their cmd strings using the shared helper surface.
- Tests prove the invariants that tend to drift (timeout wrapper, escaping, and “no out-link”).
- No behavior change in produced outputs (only the cmd assembly path is consolidated).

### Risks

Low to moderate. The main risk is changing cmd strings in a way that breaks quoting or environment behavior in Buck sandboxes. The tests must validate the safety invariants, and the existing integration tests should remain green.

### Consequence of Not Implementing

We keep duplicating cmd assembly patterns. Each new Nix-calling macro has to relearn the same pitfalls, and drift becomes more likely.

### Downsides for Implementing

Some churn in `build-tools/node/defs_nix.bzl` and test expectations. The benefit is a smaller surface area for subtle command bugs.

### Recommendation

Implement.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and by how isolated the changes are:

1. PR‑1 first. It is primarily wiring refactor and keeps the current cmd assembly intact.
2. PR‑2 next. It consolidates cmd assembly and relies on PR‑1’s wiring consistency to keep tests simpler.

---

## Verification & Backout Strategy

Each PR includes:

- at least one focused test that asserts the relevant macro contract behavior
- a doc update that points at the canonical helper surface and describes the contract in the same language used by tests

Backout strategy:

- Each PR is independently revertible.
- If I find that PR‑2 destabilizes command quoting, I will revert PR‑2 and keep PR‑1. PR‑1 reduces drift risk without changing runtime command behavior.
