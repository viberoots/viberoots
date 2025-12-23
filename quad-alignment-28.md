## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 28

This installment follows Part 27. Part 27 finished tightening importer-scoped wiring and reduced drift in Node Nix-calling macros. In Part 28 I close the remaining gaps I still see in the repository today.

The themes in this installment are:

- Remove remaining “tooling entrypoint” compatibility layers so there is one canonical command path for provider sync and glue generation.
- Make package-local wiring (Go and C++) as hard to misuse as importer-scoped wiring (Node and Python), by providing one small helper surface and locking it down with probe and enforcement tests.
- Reduce remaining small sources of drift in TypeScript tooling by standardizing on `tools/lib/cli.ts` for flag parsing where we still hand-roll it.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Add one shared helper for package-local patching macros and refactor Go and C++ macros onto it

### Description

Importer-scoped macros (Node and Python) use `//lang:importer_wiring.bzl` as a single helper boundary for lockfile enforcement, label stamping, patch inputs, and provider edges. Go and C++ are intentionally different in patch model (package-local patches), but the macro wiring is still assembled across multiple call sites today.

This PR adds one small helper surface for “package-local patching macro wiring”. The helper is intentionally narrow. It aims to eliminate repeated macro boilerplate and make it harder to forget critical steps such as including patch files as action inputs.

Clarification: I do not need to preserve backwards compatibility yet. This PR can change macro implementation details as long as behavior and exported graph semantics remain stable.

### Scope & Changes

This PR introduces one helper and migrates the existing Go and C++ macros to use it. The helper stays in `//lang` so language macro files do not need to re-implement the same sequence.

- Add a helper in `//lang` (location: `//lang:macro_kwargs.bzl` or a new small `//lang:package_local_wiring.bzl`) that:
  - reads `local_patch_dirs` from kwargs with the existing default (`default_package_patch_dirs(lang)`)
  - reads `nixpkg_deps` from kwargs and appends normalized `nixpkg:*` labels via the existing canonical helper
  - stamps `lang:*` and `kind:*` labels via the existing canonical helper
  - includes package-local patch files as real action inputs (via `include_package_local_patches`)
  - realizes provider edges deterministically (via `realize_provider_edges`)
  - returns a small struct so call sites can keep rule-specific concerns (for example Go tuple labels, CGO wiring, and C++ output naming) outside the shared helper
- Refactor:
  - `go/defs.bzl` macros that currently perform the full sequence themselves (`nix_go_library`, `nix_go_binary`, `nix_go_test`) to use the helper
  - `cpp/defs.bzl` macros that currently perform the full sequence themselves (`_cpp_common` and wasm variants) to use the helper

Non-goals in this PR:

- No changes to the patch invalidation model (Go and C++ remain package-local).
- No changes to importer-scoped wiring.
- No changes to provider generation behavior.

### Tests (in this PR)

I will use the same style of regression guards used elsewhere in the repo. The tests should assert invariants (patch files are action inputs, labels are present, provider edges are realized deterministically) rather than exact ordering or key names beyond stable prefixes.

- Add a Starlark probe test that exercises the new helper for a representative macro call and asserts:
  - the macro’s kwargs include `lang:<id>` and `kind:<k>`
  - package-local patch files are included as real action inputs for the underlying rule
  - provider edges are realized deterministically
  - `nixpkg:*` labels are appended only via the canonical normalizer
- Add an enforcement-style TypeScript test that prevents language macro files from bypassing the helper for package-local languages:
  - `go/defs.bzl` should not call `include_package_local_patches` directly after the refactor
  - `cpp/defs.bzl` should not call `include_package_local_patches` directly after the refactor
  - the enforcement test should fail with a clear message that points authors to the helper surface

### Docs (in this PR)

I will update documentation so “how to write a package-local patching macro” points at the helper boundary, not at a checklist of primitives.

- Update `docs/handbook/adding-language.md`:
  - add a short section describing the package-local wiring helper and when to use it
  - include a minimal example for a new package-local language macro
- Update `abstractions.md`:
  - explicitly list “package-local patching macro wiring” as a contract alongside importer-scoped wiring
  - point macro authors to the helper surface and the probe test

### Acceptance Criteria

- There is one shared helper surface for package-local patching macro wiring in `//lang`.
- Go and C++ macro files use the helper and no longer duplicate the same wiring sequence.
- Tests prove patch invalidation and provider wiring are unchanged.
- Docs point at the helper as the canonical mechanism.

### Risks

Moderate. The main risk is subtle behavior changes when callers pass unexpected kwarg shapes. The helper must preserve current tolerant but deterministic behavior.

### Consequence of Not Implementing

We keep a drift surface where package-local languages have to assemble wiring primitives by hand, and new helper targets will likely re-copy that sequence.

### Downsides for Implementing

This adds one more helper surface in `//lang`. The surface must remain narrow so it does not become a macro framework.

### Recommendation

Implement.

---

## PR‑2: Add a shared contract registry for “patch model by language” and use it to tighten patch tooling UX and tests

### Description

This repo intentionally has two patch invalidation models:

- Package-local patches (Go and C++) where patch files live under the owning Buck package and are included in action inputs.
- Importer-local patches (Node and Python) where patch files live under an importer directory and provider glue is generated.

Today this distinction is described in documentation and appears in TypeScript (`tools/lib/lang-contracts.ts`), but it is not used to keep macro and patch-tool behavior honest. This PR makes the contract explicit and usable in both Starlark probes and patch tooling so the seam is less confusing and harder to misuse.

Clarification: I do not need to preserve backwards compatibility yet. This PR can change internal helper APIs used by patch tooling as long as behavior is preserved.

### Scope & Changes

This PR introduces a minimal contract registry and uses it in two places where the seam shows up in practice: patch tooling messages and regression tests.

- Add a small Starlark contract surface (location: `//lang:lang_contracts.bzl`) that exposes:
  - whether a language is package-local or importer-local for patch invalidation
  - whether applying a patch should run glue (importer-local languages) or not (package-local languages)
- Update `tools/lib/lang-contracts.ts` if needed so it is the single TS-side definition for the same mapping, and add a parity-style test that asserts Starlark and TS agree on the mapping.
- Update `tools/patch/patch-pkg.ts` (and any shared patch-tool message helper) to print a single standardized one-liner after `apply` and `reset` that states:
  - for package-local languages: “no glue refresh is required”
  - for importer-local languages: “glue pipeline will run (graph, providers, auto_map)”

Non-goals in this PR:

- No change to where patch files are stored.
- No change to provider generation behavior.
- No change to macro wiring.

### Tests (in this PR)

- Add a parity-style test that ensures the patch model mapping is consistent between Starlark and TypeScript.
- Add a focused patch-tool test that asserts the standardized message is printed for:
  - one package-local language (Go or C++)
  - one importer-local language (Node or Python)
    The test should assert on the presence of a stable message substring rather than full output formatting.

### Docs (in this PR)

- Update `docs/handbook/patching.md`:
  - document the two patch models using the same terms as the contract registry
  - include the expected `patch-pkg apply` output line so the user-facing behavior is explicit
- Update `abstractions.md`:
  - list “patch invalidation model” as an explicit contract and point at the registry

### Acceptance Criteria

- There is a single explicit mapping for patch invalidation model by language, exposed in both Starlark and TS.
- Patch tooling prints a consistent message that reflects the model.
- Tests lock down both the mapping and the tooling output.
- Docs reflect the same terms and point at the contract registry.

### Risks

Low. This is mainly “make the seam explicit” work, but the mapping must not drift across layers.

### Consequence of Not Implementing

The seam remains correct but implicit. Confusion around “why did provider glue not change when I patched Go/C++” remains a recurring source of review and onboarding friction.

### Downsides for Implementing

One more small contract surface, plus a parity test to maintain. This is acceptable if it reduces confusion and prevents drift.

### Recommendation

Implement.

---

## PR‑3: Remove provider sync back-compat wrappers and update all call sites to the unified orchestrator

### Description

The repo currently has a unified provider sync orchestrator (`tools/buck/sync-providers.ts`) and also keeps thin delegator-only wrappers (`tools/buck/sync-providers-node.ts`, `tools/buck/sync-providers-python.ts`) for compatibility and discoverability.

At this point, the wrappers are a maintenance surface: tests call them, docs reference them, and any future behavior change must be validated in multiple entrypoints. This PR removes the wrappers and makes the orchestrator the only supported entrypoint.

Clarification: I do not need to preserve backwards compatibility yet. This PR can remove these scripts and update all references in one change.

### Scope & Changes

- Delete:
  - `tools/buck/sync-providers-node.ts`
  - `tools/buck/sync-providers-python.ts`
- Update all call sites to invoke:
  - `node tools/buck/sync-providers.ts --lang node --no-glue` where the old wrappers were used in “providers-only” mode
  - `node tools/buck/sync-providers.ts --lang python --no-glue` similarly
  - or `node tools/buck/sync-providers.ts` when the full orchestrator behavior is intended
- Update and simplify tests that asserted “wrapper is delegator-only” to instead assert:
  - there are no remaining references to the deleted scripts in `tools/`, `docs/`, or scaffolding templates
  - provider sync remains idempotent and deterministic when invoked through the orchestrator with `--lang`

### Tests (in this PR)

- Replace wrapper-delegator tests with an enforcement test that fails if any file references the removed wrapper entrypoints.
- Update existing scaffolding and provider sync tests that currently call the wrappers to call the orchestrator with the equivalent flags.

### Docs (in this PR)

- Update all docs that reference the wrappers to describe only the orchestrator entrypoint:
  - `docs/handbook/adding-language.md`
  - `docs/handbook/provider-sync-cookbook.md`
  - `build-system-design.md`
  - any PNPM design docs that mention the wrappers
- Ensure documentation uses one canonical command example and does not mention the removed files.

### Acceptance Criteria

- The wrapper scripts are removed from the repo.
- There are no remaining references to the wrapper entrypoints.
- Provider sync behavior remains unchanged when invoked through the orchestrator.
- Tests and docs consistently reference only the orchestrator entrypoint.

### Risks

Low. The main risk is missing an indirect reference in tests or scaffolding templates. The enforcement test should prevent that from landing.

### Consequence of Not Implementing

We keep an unnecessary multiplicity of entrypoints. That increases ongoing drift and review burden for tooling changes.

### Downsides for Implementing

This removes a discoverability alias. The trade is acceptable if docs and tooling output clearly point to the orchestrator.

### Recommendation

Implement.

---

## PR‑4: Standardize flag parsing in remaining tooling scripts and remove hand-rolled argv parsing

### Description

Most repo tooling already uses `tools/lib/cli.ts` so flags behave consistently whether scripts run under zx global argv or via plain Node. A small number of scripts still hand-roll `(global as any).argv` access or custom `process.argv` parsing.

This is not a functional bug, but it is a drift source. It makes scripts disagree on how flags and defaults behave, which matters in CI, in temp-repo test environments, and when tooling is invoked via `runNodeWithZx`.

Clarification: I do not need to preserve backwards compatibility for internal flag parsing behavior if it is not part of the documented public CLI. For any user-facing CLI, I will preserve behavior and document changes explicitly.

### Scope & Changes

- Identify remaining tooling scripts under `tools/` that parse flags manually and migrate them to use `tools/lib/cli.ts`:
  - use `getFlagStr`, `getFlagBool`, `getFlagList`, and `hasFlag` as appropriate
  - remove local `getArg` and bespoke parsing helpers where they exist
- Keep command-line interfaces stable:
  - preserve existing flag names
  - preserve defaults and “explicitly provided vs defaulted” semantics where current behavior depends on it

### Tests (in this PR)

- Add or extend a small unit test for `tools/lib/cli.ts` to cover the parsing shapes used by the migrated scripts (presence flags, equals form, and “global argv” precedence).
- Add one focused integration-style test that runs one migrated script in a context where zx global argv is absent, to ensure the `process.argv` fallback path remains correct.

### Docs (in this PR)

- Update `docs/handbook/tooling.md` (or an existing appropriate handbook page) to state that new tooling should use `tools/lib/cli.ts` and should not hand-roll `process.argv` parsing.
- Update any per-script docs that previously described flags in a way that depends on the old parsing quirks (only when applicable).

### Acceptance Criteria

- Targeted scripts no longer hand-roll flag parsing.
- Flag behavior remains stable for user-facing scripts.
- Tests cover the relevant parsing behavior and prevent reintroduction of bespoke parsing.

### Risks

Low to moderate. The main risk is subtle differences in how “presence flags” are interpreted (`--flag` vs `--flag=false`). Tests should cover the specific shapes used by affected scripts.

### Consequence of Not Implementing

We keep a small but persistent source of divergence in how tooling behaves across invocation contexts.

### Downsides for Implementing

Some churn in scripts that are otherwise correct. The benefit is lower drift risk and fewer one-off parsing bugs.

### Recommendation

Implement.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and by the goal of keeping each PR revertible:

1. PR‑1 first. It introduces the package-local wiring helper and migrates Go and C++ macros to use it.
2. PR‑2 next. It makes the patch invalidation seam explicit and testable, and updates patch tooling UX.
3. PR‑3 next. It removes provider sync wrapper entrypoints and updates all call sites.
4. PR‑4 last. It standardizes remaining tooling flag parsing and removes bespoke argv parsing.

---

## Verification & Backout Strategy

Each PR includes:

- at least one focused test that asserts the relevant contract behavior
- a doc update that points at the canonical helper surface and uses the same terms used by the tests

Backout strategy:

- Each PR is independently revertible.
- If PR‑1 exposes an unexpected macro shape edge case, I will revert only the language macro migrations and keep the helper surface behind tests until the behavior is stable.
- If PR‑3 breaks an external workflow that still calls a wrapper script, I will reintroduce a single thin wrapper with an explicit deprecation notice and a test that ensures it remains delegator-only. I will not reintroduce multiple wrappers.
