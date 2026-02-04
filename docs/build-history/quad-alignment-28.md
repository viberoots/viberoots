## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 28

This installment follows Part 27. Part 27 finished tightening importer-scoped wiring and reduced drift in Node Nix-calling macros. In Part 28 I close the remaining gaps I still see in the repository today.

The themes in this installment are:

- Remove remaining “tooling entrypoint” compatibility layers so there is one canonical command path for provider sync and glue generation.
- Make package-local wiring (Go and C++) as hard to misuse as importer-scoped wiring (Node and Python), by providing one small helper surface and locking it down with probe and enforcement tests.
- Reduce remaining small sources of drift in TypeScript tooling by standardizing on `build-tools/tools/lib/cli.ts` for flag parsing where we still hand-roll it.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Add one shared helper for package-local patching macros and refactor Go and C++ macros onto it

### Description

Importer-scoped macros (Node and Python) use `//build-tools/lang:importer_wiring.bzl` as a single helper boundary for lockfile enforcement, label stamping, patch inputs, and provider edges. Go and C++ are intentionally different in patch model (package-local patches), but the macro wiring is still assembled across multiple call sites today.

This PR adds one small helper surface for “package-local patching macro wiring”. The helper is intentionally narrow. It aims to eliminate repeated macro boilerplate and make it harder to forget critical steps such as including patch files as action inputs.

Clarification: I do not need to preserve backwards compatibility yet. This PR can change macro implementation details as long as behavior and exported graph semantics remain stable.

### Scope & Changes

This PR introduces one helper and migrates the existing Go and C++ macros to use it. The helper stays in `//build-tools/lang` so language macro files do not need to re-implement the same sequence.

- Add a helper in `//build-tools/lang` (location: `//build-tools/lang:macro_kwargs.bzl` or a new small `//build-tools/lang:package_local_wiring.bzl`) that:
  - reads `local_patch_dirs` from kwargs with the existing default (`default_package_patch_dirs(lang)`)
  - reads `nixpkg_deps` from kwargs and appends normalized `nixpkg:*` labels via the existing canonical helper
  - stamps `lang:*` and `kind:*` labels via the existing canonical helper
  - includes package-local patch files as real action inputs (via `include_package_local_patches`)
  - realizes provider edges deterministically (via `realize_provider_edges`)
  - returns a small struct so call sites can keep rule-specific concerns (for example Go tuple labels, CGO wiring, and C++ output naming) outside the shared helper
- Refactor:
  - `build-tools/go/defs.bzl` macros that currently perform the full sequence themselves (`nix_go_library`, `nix_go_binary`, `nix_go_test`) to use the helper
  - `build-tools/cpp/defs.bzl` macros that currently perform the full sequence themselves (`_cpp_common` and wasm variants) to use the helper

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
  - `build-tools/go/defs.bzl` should not call `include_package_local_patches` directly after the refactor
  - `build-tools/cpp/defs.bzl` should not call `include_package_local_patches` directly after the refactor
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

- There is one shared helper surface for package-local patching macro wiring in `//build-tools/lang`.
- Go and C++ macro files use the helper and no longer duplicate the same wiring sequence.
- Tests prove patch invalidation and provider wiring are unchanged.
- Docs point at the helper as the canonical mechanism.

### Risks

Moderate. The main risk is subtle behavior changes when callers pass unexpected kwarg shapes. The helper must preserve current tolerant but deterministic behavior.

### Consequence of Not Implementing

We keep a drift surface where package-local languages have to assemble wiring primitives by hand, and new helper targets will likely re-copy that sequence.

### Downsides for Implementing

This adds one more helper surface in `//build-tools/lang`. The surface must remain narrow so it does not become a macro framework.

### Recommendation

Implement.

---

## PR‑2: Add a shared contract registry for “patch model by language” and use it to tighten patch tooling UX and tests

### Description

This repo intentionally has two patch invalidation models:

- Package-local patches (Go and C++) where patch files live under the owning Buck package and are included in action inputs.
- Importer-local patches (Node and Python) where patch files live under an importer directory and provider glue is generated.

Today this distinction is described in documentation and appears in TypeScript (`build-tools/tools/lib/lang-contracts.ts`), but it is not used to keep macro and patch-tool behavior honest. This PR makes the contract explicit and usable in both Starlark probes and patch tooling so the seam is less confusing and harder to misuse.

Clarification: I do not need to preserve backwards compatibility yet. This PR can change internal helper APIs used by patch tooling as long as behavior is preserved.

### Scope & Changes

This PR introduces a minimal contract registry and uses it in two places where the seam shows up in practice: patch tooling messages and regression tests.

- Add a small Starlark contract surface (location: `//build-tools/lang:lang_contracts.bzl`) that exposes:
  - whether a language is package-local or importer-local for patch invalidation
  - whether applying a patch should run glue (importer-local languages) or not (package-local languages)
- Update `build-tools/tools/lib/lang-contracts.ts` if needed so it is the single TS-side definition for the same mapping, and add a parity-style test that asserts Starlark and TS agree on the mapping.
- Update `build-tools/tools/patch/patch-pkg.ts` (and any shared patch-tool message helper) to print a single standardized one-liner after `apply` and `reset` that states:
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

The repo currently has a unified provider sync orchestrator (`build-tools/tools/buck/sync-providers.ts`) and also keeps thin delegator-only wrappers for compatibility and discoverability.

At this point, the wrappers are a maintenance surface: tests call them, docs reference them, and any future behavior change must be validated in multiple entrypoints. This PR removes the wrappers and makes the orchestrator the only supported entrypoint.

Clarification: I do not need to preserve backwards compatibility yet. This PR can remove these scripts and update all references in one change.

### Scope & Changes

- Delete the Node/Python provider sync wrapper entrypoints.
- Update all call sites to invoke:
  - `node build-tools/tools/buck/sync-providers.ts --lang node --no-glue` where wrappers were previously used in “providers-only” mode
  - `node build-tools/tools/buck/sync-providers.ts --lang python --no-glue` similarly
  - or `node build-tools/tools/buck/sync-providers.ts` when the full orchestrator behavior is intended
- Update and simplify tests that asserted “wrapper is delegator-only” to instead assert:
  - there are no remaining references to the deleted scripts in `build-tools/tools/`, `docs/`, or scaffolding templates
  - provider sync remains idempotent and deterministic when invoked through the orchestrator with `--lang`

### Tests (in this PR)

- Replace wrapper-delegator tests with an enforcement test that fails if any file references the removed wrapper entrypoints.
- Update existing scaffolding and provider sync tests that currently call the wrappers to call the orchestrator with the equivalent flags.

### Docs (in this PR)

- Update all docs that reference the wrappers to describe only the orchestrator entrypoint:
  - `docs/handbook/adding-language.md`
  - `docs/handbook/provider-sync-cookbook.md`
  - `build-tools/docs/build-system-design.md`
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

Most repo tooling already uses `build-tools/tools/lib/cli.ts` so flags behave consistently whether scripts run under zx global argv or via plain Node. A small number of scripts still hand-roll `(global as any).argv` access or custom `process.argv` parsing.

This is not a functional bug, but it is a drift source. It makes scripts disagree on how flags and defaults behave, which matters in CI, in temp-repo test environments, and when tooling is invoked via `runNodeWithZx`.

Clarification: I do not need to preserve backwards compatibility for internal flag parsing behavior if it is not part of the documented public CLI. For any user-facing CLI, I will preserve behavior and document changes explicitly.

### Scope & Changes

- Identify remaining tooling scripts under `build-tools/tools/` that parse flags manually and migrate them to use `build-tools/tools/lib/cli.ts`:
  - use `getFlagStr`, `getFlagBool`, `getFlagList`, and `hasFlag` as appropriate
  - remove local `getArg` and bespoke parsing helpers where they exist
- Keep command-line interfaces stable:
  - preserve existing flag names
  - preserve defaults and “explicitly provided vs defaulted” semantics where current behavior depends on it

### Tests (in this PR)

- Add or extend a small unit test for `build-tools/tools/lib/cli.ts` to cover the parsing shapes used by the migrated scripts (presence flags, equals form, and “global argv” precedence).
- Add one focused integration-style test that runs one migrated script in a context where zx global argv is absent, to ensure the `process.argv` fallback path remains correct.

### Docs (in this PR)

- Update `docs/handbook/tooling.md` (or an existing appropriate handbook page) to state that new tooling should use `build-tools/tools/lib/cli.ts` and should not hand-roll `process.argv` parsing.
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

## PR‑5: Finish migrating remaining tool CLIs off bespoke argv parsing and add an enforcement guard

### Description

PR‑4 standardized flag parsing on `build-tools/tools/lib/cli.ts`, but there are still a few tooling scripts under `build-tools/tools/` that hand-roll `process.argv` parsing (either as a fixed-flag parser or as a small bespoke argv-to-map helper).

This is not a functional bug, but it is a drift surface. These scripts can disagree on precedence (`global argv` vs `process.argv`), accepted forms (`--flag value` vs `--flag=value`), and how unknown flags are handled. This matters in temp-repo test environments and when tooling is invoked via `runNodeWithZx`.

Clarification: This PR is about removing drift in **repo tooling**. It does not change any public build-system contracts or provider glue formats. It aims to make “how tooling parses CLI flags” uniform and enforceable.

### Scope & Changes

This PR identifies and migrates the remaining tooling scripts under `build-tools/tools/` that parse flags manually:

- Migrate fixed-flag tooling entrypoints to use `build-tools/tools/lib/cli.ts`:
  - `build-tools/tools/dev/planner-gen.ts` (currently parses `--lang`, `--all`, `--check`)
  - `build-tools/tools/dev/buck-watchdog.ts` (currently parses `--parent`, `--iso`, `--patterns`)
  - `build-tools/tools/dev/install/deps-main.ts` (currently parses `--force`, `--dry-run`, `--verbose/-v`, `--skip-glue`, `--glue-only`, `--skip-go-tidy`)
  - `build-tools/tools/scaffolding/new-pnpm-project.ts` (currently parses `--kind`, `--name`, `--importer`, `--yes`, `--run-setup`)
  - `build-tools/tools/scaffolding/validate.ts` (currently uses `process.argv` directly for positionals)

- Migrate the remaining “small bespoke CLI” surfaces that still strip flags manually:
  - `build-tools/tools/dev/dev-build/run-dev-build.ts` and `build-tools/tools/dev/dev-build/args.ts`
    - Stop parsing `process.argv.slice(2)` with bespoke logic for `--impure` and `--no-materialize`.
    - Use `build-tools/tools/lib/cli.ts` helpers to read those flags and derive the remaining positional Buck arguments consistently across zx and plain Node invocation.

- For tooling that intentionally needs a “flags map” (arbitrary `--key[=value]` surface), add one small shared helper surface instead of re-implementing it:
  - Add `parseFlagMap(argv?: string[]) -> { positionals: string[], flags: Record<string, string> }` to `build-tools/tools/lib/cli.ts` (or a small sibling module under `build-tools/tools/lib/`) that:
    - supports `--key=value` and `--key` presence flags (value defaults to `"true"`)
    - preserves caller ordering for positionals
    - does not attempt to be a full CLI framework
  - Refactor:
    - `build-tools/tools/scaffolding/scaf/argv.ts` to use the shared helper (it is the canonical “needs a flags map” example)

  - Refactor the `scaf` entrypoint to route argv handling through the shared helper:
    - `build-tools/tools/scaffolding/scaf/main.ts` should avoid direct `process.argv.slice(2)` in the entrypoint and instead call the shared parsing surface.

- Optional (recommended): tighten patch tooling parsing drift in helper libraries:
  - `build-tools/tools/patch/lib/apply.ts` contains a small argv-array parser (`parseApplyFlags(...)`) for `--target`, `--patch-dir`, `--force`.
  - If we keep this pattern (parsing a provided argv list for programmatic/test use), it should use the same shared parsing helpers as CLIs (for example a `parseFlagMap(argv)`-based implementation) so behavior does not drift.

- Keep command-line interfaces stable:
  - preserve existing flag names
  - preserve defaults and “explicitly provided vs defaulted” semantics where current behavior depends on it (for example `sync-providers.ts` uses `hasFlag("out")` to preserve Node default out path behavior)
  - retain any legacy aliases in the callsite when they are intentionally supported (for example `-v` in install tooling) without reintroducing bespoke argv parsing

Non-goals in this PR:

- No changes to provider generation behavior or outputs.
- No changes to patch invalidation models or glue pipeline ordering.
- No introduction of a new CLI parsing dependency (no yargs/commander/minimist).

### Tests (in this PR)

- Add an enforcement-style TypeScript test that fails if bespoke argv parsing patterns reappear in tool entrypoints:
  - Scan `build-tools/tools/**/*.ts` (excluding `build-tools/tools/tests/**`, scaffolding templates, and the canonical implementation file(s) for CLI helpers).
  - Fail on common “roll your own argv parsing” patterns, for example:
    - `process.argv.indexOf("--`
    - `process.argv.findIndex((a) => a === "--`
    - local `parseArg(` / `parseFlags(` helpers that exist only to parse CLI flags
  - The failure message should point authors to `build-tools/tools/lib/cli.ts` as the canonical mechanism.

- Add or extend unit tests for `build-tools/tools/lib/cli.ts` to cover any parsing shapes required by the migrated scripts:
  - presence flags and equals-form parsing
  - “global argv” precedence over `process.argv`
  - the shared `parseFlagMap(...)` helper (if introduced)

### Docs (in this PR)

- Add a handbook page `docs/handbook/tooling.md` (or update the existing best-fit handbook page if one already exists) stating:
  - new tooling must use `build-tools/tools/lib/cli.ts` (no bespoke `process.argv` parsing)
  - when one tool invokes another zx script, use `build-tools/tools/lib/node-run.ts:runNodeWithZx`
  - `parseFlagMap(...)` is the only supported way to build a free-form flags map (used by `scaf`), and call sites must not copy/paste bespoke variants
- Update `getting-started-on-a-pr.md` to point at the canonical tooling handbook page so guidance lives in one place.

### Acceptance Criteria

- The remaining tooling scripts no longer hand-roll flag parsing and instead use shared helpers:
  - `build-tools/tools/dev/planner-gen.ts`
  - `build-tools/tools/dev/buck-watchdog.ts`
  - `build-tools/tools/dev/install/deps-main.ts`
  - `build-tools/tools/dev/dev-build/run-dev-build.ts` and `build-tools/tools/dev/dev-build/args.ts`
  - `build-tools/tools/scaffolding/new-pnpm-project.ts`
  - `build-tools/tools/scaffolding/validate.ts`
  - `build-tools/tools/scaffolding/scaf/argv.ts` uses the shared `parseFlagMap(...)` helper (if introduced)
- `build-tools/tools/scaffolding/scaf/main.ts` does not bypass the shared parsing surface for argv handling
- Any remaining argv parsing in patch tooling helper libraries (for example `build-tools/tools/patch/lib/apply.ts`) either:
  - uses the same shared parsing helpers as CLIs, or
  - is explicitly documented as an intentional exception with a regression test that locks down its behavior
- Tests prevent reintroduction of bespoke argv parsing patterns.
- Documentation clearly states the canonical CLI parsing policy and points at the shared helpers.

### Risks

Low to moderate. The main risk is subtle differences in how “presence flags” are interpreted (`--flag` vs `--flag=false`) and in how legacy short aliases are handled. Tests should cover the specific shapes used by the migrated scripts.

### Consequence of Not Implementing

We keep a small but persistent source of divergence in how tooling behaves across invocation contexts, and we rely on review to catch bespoke parsing reintroductions.

### Downsides for Implementing

Some churn in scripts that are otherwise correct. The benefit is lower drift risk and fewer one-off parsing inconsistencies.

### Recommendation

Implement.

---

## PR‑6: Ensure `nix_cpp_test` planner-visible stubs include package-local patch files as action inputs

### Description

Package-local patching depends on a simple invariant: patch files live under the owning Buck package and are included as real action inputs so edits invalidate precisely. Most package-local macros already compose this via shared helpers, but the `nix_cpp_test` shape is special: it creates a planner-visible stub target (for exporter/planner routing) and a separate executed runner test.

Today the `nix_cpp_test` planner-visible stub is not clearly wired to include `patches/cpp/*.patch` as inputs, which risks patch edits not invalidating the planner-visible boundary for C++ tests.

Clarification: I do not need to preserve backwards compatibility yet. This PR can change macro implementation details as long as behavior and exported graph semantics remain stable.

### Scope & Changes

- Update `build-tools/cpp/defs.bzl:nix_cpp_test` so the planner-visible stub (`<name>__planner`) includes package-local patch files as action inputs:
  - Wire patch inputs through the canonical planner-visible helper path (`wire_planner_visible_stub(lang = "cpp", local_patch_dirs = ...)`) so `planner_stub_with_package_local_patches(...)` is used.
  - Preserve existing behavior where provider targets are stripped from planner-visible deps (to avoid visibility and graph shape issues).
  - Keep labels stable (`lang:cpp`, `kind:test`, plus any `nixpkg:` labels derived from call-site `nixpkg_deps`) so exporter/planner routing does not drift.

Non-goals in this PR:

- No changes to the patch invalidation model (C++ remains package-local).
- No changes to provider generation behavior.
- No changes to how `cpp_nix_test` executes the built binary (runner remains external-runner style).

### Tests (in this PR)

- Add a focused C++ macro regression test that asserts the `nix_cpp_test` planner-visible stub includes package-local patch files as action inputs:
  - Create a temp repo with `apps/demo/patches/cpp/*.patch`.
  - Declare a `nix_cpp_test(name = "demo_test", ...)`.
  - `buck2 cquery` the planner-visible stub target (`//apps/demo:demo_test__planner`) and assert `srcs` includes `apps/demo/patches/cpp/<file>.patch`.
- Extend or reuse the existing test that asserts provider deps are stripped from planner-visible deps for `nix_cpp_test` so the combined behavior remains locked down (patch inputs present; provider deps still excluded).

### Docs (in this PR)

- Update `docs/handbook/patching.md` and/or `abstractions.md` to explicitly call out that `nix_cpp_test` uses a planner-visible stub and that the stub carries package-local patch inputs (so patch invalidation remains precise).

### Acceptance Criteria

- `nix_cpp_test` planner-visible stub includes package-local patch files as real action inputs.
- A regression test fails if patch inputs are not present on the planner-visible stub.
- Exporter/planner routing and `nix_cpp_test` execution behavior remain stable aside from the intended tightening.

### Risks

Moderate. `nix_cpp_test` is a split shape (planner-visible stub + executed runner). The main risk is accidentally changing labels/deps in a way that affects exporter routing or planner selection. The new test should detect this drift early.

### Consequence of Not Implementing

C++ test patch invalidation remains easier to accidentally break than other package-local macro shapes, and the planner-visible seam can stay ambiguous.

### Downsides for Implementing

Slight churn in `build-tools/cpp/defs.bzl` and one additional regression test.

### Recommendation

Implement.

---

## PR‑7: Standardize C++ wasm emscripten macro wiring on the package-local helper surface

### Description

PR‑1 introduced `prepare_package_local_wiring(...)` to eliminate repeated macro boilerplate for package-local languages and to make it hard to forget patch inputs, label stamping, and deterministic provider-edge realization. Most C++ macro shapes now use the helper surface, but one wasm-oriented macro path still assembles parts of the wiring sequence manually.

This PR removes that remaining bypass and makes the emscripten wasm macro follow the same helper boundary as other package-local macros.

Clarification: I do not need to preserve backwards compatibility yet. This PR can change macro implementation details as long as behavior and exported graph semantics remain stable.

### Scope & Changes

- Refactor `build-tools/cpp/defs.bzl:nix_cpp_wasm_emscripten_lib` to use the same shared package-local wiring helper surface used by `_cpp_common` and wasm static lib:
  - Use `prepare_package_local_wiring(...)` (or a thin wrapper around it) to centralize:
    - `local_patch_dirs` defaulting
    - `nixpkg_deps` normalization and `nixpkg:` label append
    - deterministic provider-edge realization
  - Preserve wasm labeling via the existing canonical stamper (`stamp_wasm_variant(...)`) so `kind:wasm` and `wasm:emscripten` remain uniform.
  - Keep the macro producing a planner-visible stub (stamp output) with the same graph semantics.

Non-goals in this PR:

- No changes to the wasm artifact model (emscripten remains a planner-visible stub shape).
- No changes to the patch invalidation model (C++ remains package-local).

### Tests (in this PR)

- Add a focused regression test for `nix_cpp_wasm_emscripten_lib` that asserts:
  - wasm labels are present (`kind:wasm` and `wasm:emscripten`).
  - package-local patch files under `<pkg>/patches/cpp/*.patch` are present as action inputs on the stub (via `srcs`).
  - provider edges are realized deterministically when `MODULE_PROVIDERS` maps the target to a provider.
- Add (or extend) an enforcement-style test that prevents `build-tools/cpp/defs.bzl` from reintroducing direct calls to lower-level primitives for this macro path (e.g., bypassing the helper boundary).

### Docs (in this PR)

- Update `docs/handbook/adding-language.md` and/or `abstractions.md` to include `nix_cpp_wasm_emscripten_lib` as an explicit example of a planner-visible stub that still uses the shared package-local wiring helper.

### Acceptance Criteria

- `nix_cpp_wasm_emscripten_lib` uses the shared package-local wiring helper surface and does not duplicate the same wiring sequence.
- Tests lock down wasm labels, package-local patch inputs, and provider-edge realization for the emscripten stub.
- Exported graph semantics remain stable.

### Risks

Low to moderate. The main risk is changing how labels or deps are assembled (ordering/dedupe), which can cause exporter deltas. Tests should assert invariants rather than brittle ordering.

### Consequence of Not Implementing

We keep a small drift surface in C++ macro wiring and a precedent for bypassing the shared helper in new planner-visible stub macros.

### Downsides for Implementing

Some churn in `build-tools/cpp/defs.bzl` for an otherwise-correct macro. The payoff is reduced drift risk and a cleaner “one boundary” story for package-local macros.

### Recommendation

Implement.

---

## PR‑8: Extend wrapper-reference enforcement to the full repo and remove stale wrapper mentions from non-handbook docs

### Description

PR‑3 removes provider sync wrapper scripts and updates the handbook-style docs to reference only the unified orchestrator entrypoint. However, older root-level and design-history markdown files can still mention the removed wrapper paths. This is not a functional bug, but it is a recurring source of confusion and review churn (“which command is canonical?”).

This PR makes “no wrapper references remain” true at the repository level, not just under `docs/` and `build-tools/tools/`, and it updates the remaining stale mentions.

Clarification: I do not need to preserve backwards compatibility yet. This PR can tighten enforcement and update documentation references in one change.

### Scope & Changes

- Tighten the existing wrapper-reference enforcement test (added in PR‑3) to scan:
  - repo root `*.md` files (excluding large log/output directories already excluded elsewhere like `test-logs/`, `buck-out/`, `coverage/`, etc.)
  - `build-tools/docs/build-tools/lang/**` and other design-doc locations if present
- Update any remaining markdown references to:
  - the removed Node/Python provider sync wrapper entrypoints,
    replacing them with the canonical orchestrator commands:
  - `node build-tools/tools/buck/sync-providers.ts --lang <lang> --no-glue`
  - `node build-tools/tools/buck/sync-providers.ts`

Non-goals in this PR:

- No behavior changes to provider sync itself.
- No changes to glue pipeline ordering.

### Tests (in this PR)

- Extend the existing enforcement test so it fails if any scanned file references the removed wrapper entrypoints.
- Keep the failure message actionable by pointing to the orchestrator command and the specific files containing stale references.

### Docs (in this PR)

- Update the stale markdown references discovered by the expanded enforcement scan to use only the orchestrator entrypoint.

### Acceptance Criteria

- The wrapper-reference enforcement test scans the full intended doc surface (not just `build-tools/tools/` and `docs/`) and passes.
- No markdown in the scanned set references the removed wrapper entrypoints.
- Documentation consistently presents one canonical command path for provider sync.

### Risks

Low. The main risk is false positives in generated logs or caches; the enforcement test must exclude those directories deterministically.

### Consequence of Not Implementing

Stale docs continue to reintroduce ambiguity around canonical command paths, even after PR‑3 removed the wrappers.

### Downsides for Implementing

Some documentation churn and slightly broader enforcement scope. This is acceptable to keep the “single entrypoint” contract true across the repo.

### Recommendation

Implement.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and by the goal of keeping each PR revertible:

1. PR‑1 first. It introduces the package-local wiring helper and migrates Go and C++ macros to use it.
2. PR‑2 next. It makes the patch invalidation seam explicit and testable, and updates patch tooling UX.
3. PR‑3 next. It removes provider sync wrapper entrypoints and updates all call sites.
4. PR‑4 last. It standardizes remaining tooling flag parsing and removes bespoke argv parsing.
5. PR‑5 last. It finishes migrating remaining tool CLIs off bespoke argv parsing and adds an enforcement guard so drift does not return.
6. PR‑6 next. It tightens C++ `nix_cpp_test` to carry package-local patch files as action inputs at the planner-visible stub boundary.
7. PR‑7 next. It standardizes the remaining C++ wasm emscripten macro wiring onto the package-local helper surface and locks it down with targeted tests.
8. PR‑8 last. It broadens wrapper-reference enforcement to the full repo docs surface and removes remaining stale wrapper mentions.

---

## Verification & Backout Strategy

Each PR includes:

- at least one focused test that asserts the relevant contract behavior
- a doc update that points at the canonical helper surface and uses the same terms used by the tests

Backout strategy:

- Each PR is independently revertible.
- If PR‑1 exposes an unexpected macro shape edge case, I will revert only the language macro migrations and keep the helper surface behind tests until the behavior is stable.
- If PR‑3 breaks an external workflow that still calls a wrapper script, I will reintroduce a single thin wrapper with an explicit deprecation notice and a test that ensures it remains delegator-only. I will not reintroduce multiple wrappers.
