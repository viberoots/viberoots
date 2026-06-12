# Fast Shell Plan - Nix-Direnv Caching + Lazy DevShell Evaluation

This plan reduces shell entry latency when changing into the repository root.

Each PR includes code, tests, and documentation updates together.

Scope: adopt cached `nix-direnv` loading for `.envrc` and make flake/devShell evaluation lazy so
entering the shell does not eagerly evaluate heavy graph/node paths.

Non-goals: no standalone docs-only or tests-only PRs.

Completion criteria: entering the repo shell uses cache-aware loading, heavy flake/devShell paths
are evaluated only when needed, and each functional change is covered by tests in the same PR.

---

## PR-1: Adopt nix-direnv cached shell loading with repository guardrails

### Description

I will switch `.envrc` from stdlib `use flake` to `nix-direnv`-based loading so the shell
environment can be reused from cache between directory entries. I will keep existing Nix config
guardrails (local builders, dirty-tree warning behavior) and add explicit behavior for missing
`nix-direnv`.

### Scope & Changes

- Update `.envrc`:
  - Source `nix-direnv` when present and use `use flake`.
  - Keep current `NIX_CONFIG` controls for local builders and `warn-dirty`.
  - Add explicit failure text when `nix-direnv` is unavailable (no silent fallback to slow path).
- Add shell helper under `build-tools/tools/bin/` for local verification of shell-cache behavior.
- Update onboarding docs where shell setup is described:
  - `docs/handbook/getting-started-on-a-pr.md`
  - `docs/history/build-system/nix-gaps-prs.md`

### Tests (in this PR)

- Add tests under `build-tools/tools/tests/dev/` that:
  - Assert `.envrc` references `nix-direnv` and does not regress to plain `use flake`.
  - Assert `.envrc` preserves required `NIX_CONFIG` lines for local-only builders.
  - Assert missing `nix-direnv` path produces the expected explicit error contract.

### Docs (in this PR)

- Document required local setup for `nix-direnv` and expected shell cache behavior.
- Document how to verify cache hits and how to recover from stale caches.

### Acceptance Criteria

- `.envrc` uses `nix-direnv` loading path.
- Re-entering the repo shell does not always trigger full `nix print-dev-env` recomputation.
- Tests for `.envrc` contract and missing-dependency behavior pass.

### Risks

Developers without `nix-direnv` installed may be blocked from shell activation.

### Mitigation

Provide precise setup command(s) and explicit failure message in `.envrc`.

### Consequence of Not Implementing

Shell entry continues to pay full `print-dev-env` cost on each load.

### Downsides for Implementing

Adds a local tooling prerequisite (`nix-direnv`) for contributors.

### Recommendation

Implement.

---

## PR-2: Make devShell flake evaluation lazy for heavy Node/graph paths

### Description

I will refactor flake context construction so devShell evaluation does not eagerly import heavy
Node/graph inputs. Heavy objects (`nodeMods`, related Nix modules) will be instantiated only by
outputs that require them.

### Scope & Changes

- Refactor `build-tools/tools/nix/flake/per-system-context.nix`:
  - Split context into lightweight base values and lazy constructors for heavy values.
  - Avoid constructing `nodeMods` while producing `devShells`.
- Update call sites in flake outputs/packages:
  - `build-tools/tools/nix/flake/packages/default.nix`
  - `build-tools/tools/nix/flake/packages/graph.nix`
  - Any package path currently assuming eager `nodeMods` presence.
- Ensure behavior parity for build/package flows that need `nodeMods`.
- Update docs describing flake context responsibilities:
  - `docs/history/build-system/nix-gaps-prs.md`

### Tests (in this PR)

- Add or extend tests under `build-tools/tools/tests/node/` and `build-tools/tools/tests/dev/` that:
  - Assert devShell path does not require eager `node-modules.nix` import.
  - Assert package paths that require `nodeMods` still receive and use it.
  - Guard the shared-nodeMods contract for graph generation.

### Docs (in this PR)

- Document lazy context boundaries and which outputs force heavy Node evaluation.
- Add maintenance notes on how to add new heavy context values without regressing shell latency.

### Acceptance Criteria

- DevShell evaluation no longer eagerly instantiates heavy Node module graph state.
- Existing Node/package/graph behavior remains correct.
- New lazy-eval enforcement tests pass.

### Risks

Refactor may break implicit assumptions in package wiring that relied on eager values.

### Mitigation

Add explicit contract tests for both lazy devShell path and eager package path.

### Consequence of Not Implementing

Shell entry remains tied to heavy flake evaluation costs.

### Downsides for Implementing

Context wiring becomes more explicit and requires tighter discipline across outputs.

### Recommendation

Implement.

---

## PR-3: Defer expensive devShell shellHook work until first use

### Description

I will make shellHook runtime work lazy so entering an already-evaluated shell does minimal work.
Operations like prelude symlink resolution and node_modules linking will run on first command that
needs them instead of during shell startup.

### Scope & Changes

- Refactor `build-tools/tools/nix/devshell.nix` shellHook:
  - Keep only cheap environment setup at shell entry.
  - Move expensive setup steps behind lightweight command wrappers/guards.
- Add helper scripts under `build-tools/tools/bin/` to trigger deferred setup deterministically.
- Preserve current command UX (`b`, `v`, `i`, etc.) while making initialization demand-driven.
- Update docs for shell startup vs first-command initialization:
  - `docs/handbook/getting-started-on-a-pr.md`

### Tests (in this PR)

- Add tests under `build-tools/tools/tests/dev/` that:
  - Assert shellHook text does not perform eager expensive operations.
  - Assert deferred setup executes when expected commands run.
  - Assert repeated command runs do not redo one-time setup work unnecessarily.

### Docs (in this PR)

- Document deferred initialization behavior and expected first-run cost.
- Document troubleshooting for partial initialization state.

### Acceptance Criteria

- Shell entry path does not perform heavy setup work.
- Deferred initialization runs only when needed and remains functionally correct.
- Command workflows remain unchanged for users.

### Risks

Deferred setup bugs may shift failures from shell entry to first command execution.

### Mitigation

Add explicit tests for first-run and repeated-run behavior across core commands.

### Consequence of Not Implementing

Even with cached env loading, shell startup can remain slow due to shellHook work.

### Downsides for Implementing

Slightly more moving parts in command wrappers and initialization state handling.

### Recommendation

Implement.
