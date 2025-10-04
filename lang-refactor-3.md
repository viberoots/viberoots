## Language architecture refactor — Phase 3 plan

This plan builds on Phase 1–2 to further reduce per‑language ceremony and make adding new languages largely declarative. Each PR is incremental, keeps tests green, and is partial‑clone safe.

### Design goals (Phase 3)

- Lower the slope to add a new language to near “drop files + update manifest”
- Strengthen manifest validation and typed access to capabilities
- Unify provider sync contract and exporter adapter ergonomics
- Expand scaffolding and diagnostics to eliminate guesswork
- Maintain sparse‑checkout grace and deterministic outputs

---

## PR 20: Manifest‑driven auto‑discovery for adapters and planner plugins

Intent/Impact

- Eliminate manual adapter/plugin registration. Presence of files or a manifest entry is sufficient.

Changes

- Exporter: extend `tools/buck/exporter/lang/contract.ts` to automatically `glob` and import `tools/buck/exporter/lang/*.ts` (excluding `contract.ts`).
- Planner: teach `tools/nix/graph-generator.nix` to import `./planner/<lang>.nix` by enumerating language ids from `tools/nix/langs.json` when present; fallback to on‑disk existence (`builtins.pathExists`).
- Codegen: ensure `tools/dev/codegen.ts` keeps `tools/nix/langs.nix` in sync for Nix consumers.

Acceptance criteria

- Dropping a new `tools/buck/exporter/lang/rust.ts` adapter makes exporter pick it up with zero code edits.
- Adding `tools/nix/planner/rust.nix` and an entry in `tools/nix/langs.json` makes planner load it when present; in sparse checkouts without the file, planner remains inert for `rust`.
- Tests updated to verify discovery order stability and partial‑clone no‑ops.

Risks

- Dynamic import ordering could cause nondeterminism if not sorted.

If not implemented

- New languages still require touching central registration points, slowing adoption.

---

## PR 21: JSON Schema + validator for `tools/nix/langs.json`

Intent/Impact

- Prevent drift and typos in the authoritative manifest; enable CI linting.

Changes

- Add `tools/dev/validate-langs.ts` using JSON Schema (bundled) to validate:
  - required fields: `id`, `displayName`, `requiredPaths`, `kinds`, `templatesDir`
  - optional `capabilities` object (see PR 22)
  - that all `requiredPaths` are strings and not empty
- Wire a CI stage `langs-validate` (optional locally) in `tools/ci/run-stage.ts`.

Acceptance criteria

- Invalid manifest fails fast locally and in CI with actionable error messages.
- Sparse checkout does not require paths to exist; only schema validity is enforced here.

Risks

- Over‑strict schema could block iterative changes; keep `additionalProperties` permissive initially.

If not implemented

- Silent manifest errors propagate into flaky enablement and CI gating.

---

## PR 22: Stronger capability taxonomy and typed accessors

Intent/Impact

- Make CI and glue fully data‑driven; remove language‑specific branches.

Changes

- Extend capability keys in `tools/nix/langs.json`:
  - `exporterLabels` (boolean) — exporter can emit authoritative labels for this language
  - `providerSyncMode` ("patchdir" | "lockfile" | "lockfile+override" | "buildsystem-resolved" | "none")
    - patchdir: providers derived from flat `patches/<lang>/*.patch`
    - lockfile: providers derived from dependency lockfiles (e.g., `pnpm-lock.yaml`, `Cargo.lock`, `poetry.lock`)
    - lockfile+override: lockfile plus language‑native override mechanism (e.g., Cargo `[patch]`)
    - buildsystem-resolved: providers inferred from declared deps in build rules/macros (e.g., C++ `cxx_*` deps)
  - `plannerPlugin` (boolean) — planner has a `tools/nix/planner/<lang>.nix` plugin
  - `macroStamping` (boolean) — macros stamp `lang:<id>` and `kind:*` labels
  - `lockfileKinds` (string[]) — known lockfile families for this language (e.g., ["cargo", "poetry", "pdm", "pip-tools", "gradle", "maven", "nuget", "mix", "rebar", "conan", "vcpkg"])
  - `labelStrategy` ("rule-type" | "macro-stamp" | "lockfile" | "hybrid") — primary signal exporter uses to detect/classify nodes
  - `buildSystem` ("buck" | "bazel" | "gradle" | "maven" | "make" | "other") — optional hint for diagnostics/lints
- Update `tools/dev/codegen.ts` to emit typed accessors in `tools/lib/langs.ts`:
  - `getCapabilities(langId): { ... }`
  - `isEnabled(langId): boolean` (considers `enabled` and presence of `requiredPaths`)
- Refactor `tools/ci/run-stage.ts` and glue to use accessors.

Acceptance criteria

- CI stages for sync and auto‑map are gated purely by capabilities; adding a language with `providerSyncMode: "patchdir"` triggers Go‑style sync without code changes; `buildsystem-resolved` skips lockfile scanning automatically.
- Unit tests cover accessor behavior and stage gating.

Risks

- Capability semantics must remain stable to keep pipeline rules predictable.

If not implemented

- CI and glue continue to require per‑language conditionals, increasing maintenance.

---

## PR 23: Unified provider‑sync plugin contract

Intent/Impact

- Reduce per‑language code by providing a generic sync engine for common modes.

Changes

- Add `tools/buck/providers/contract.ts` exposing:
  - `syncProviders({ mode, decodeKey?, nameForKey?, listLockfiles?, lockfileKinds? }): Promise<void>`
  - Built‑in modes:
    - `patchdir`: scan flat patch dir using `tools/lib/provider-sync.ts`
    - `lockfile`: read lockfiles (`lockfileKinds`) and map to patches/providers
    - `lockfile+override`: lockfile plus language‑native override layer (e.g., Cargo `[patch]`)
    - `buildsystem-resolved`: use declared deps from build rules/macros to synthesize providers
- Refactor Go/Node providers to thin wrappers passing mode and hooks.

Acceptance criteria

- Behavior identical to current Go/Node sync; deterministic output; duplicate and collision checks preserved.
- Adding a new language with `mode: patchdir` requires only file placement and a tiny shim; `lockfile` modes accept `lockfileKinds` and built‑in parsers; `buildsystem-resolved` consumes Buck rule deps where applicable.

Risks

- Over‑generalization could obscure edge cases; keep hooks explicit.

If not implemented

- New languages must re‑implement scanning/wiring logic, increasing defects.

---

## PR 24: Exporter adapter ergonomics (detect/label helpers)

Intent/Impact

- Make writing an adapter mostly composing helpers; reduce bespoke logic.

Changes

- Extend `ExporterAdapter` to support optional hooks:
  - `detect(node)`: quick filter when `rule_type` or `labels` patterns are known
  - `labelFromLockfile(node)`: helper for lockfile‑driven ecosystems
- Provide utilities in `tools/buck/exporter/lang/helpers.ts`:
  - `hasLabel(node, "lang:<id>")`, `isRuleType(node, /^go_/)`
  - `sortedUniqueLabels(nodes)` and batch roots helpers
  - `detectByBuildSystem(node, { rulePrefixes: string[], labels?: string[] })`
  - `lockfileLabeler({ kinds, resolvers })` to attach labels using known lockfile families

Acceptance criteria

- Go adapter remains unchanged functionally and gains readability from helpers.
- Example new adapter (toy) shows detect/label scaffolding with <50 LoC.
  - Cookbook snippet demonstrates: C++ (`buildsystem-resolved`), Python (`lockfile`), Rust (`lockfile+override`), Kotlin (`lockfile`), C# (`lockfile`), Erlang (`lockfile`).

Risks

- API surface growth; keep helpers small and well‑documented.

If not implemented

- Each language adapter must re‑invent detection/label plumbing.

---

## PR 25: Macro stamping helpers and stamping lint

Intent/Impact

- Guarantee exporter preconditions via macros; proactively detect missing labels.

Changes

- Add `lang/defs_common.bzl` helpers to stamp `lang:<id>` and `kind:bin|lib` consistently.
- Add `tools/dev/stamping-lint.ts` to scan Buck targets (via `cquery`) ensuring targets that use language macros are appropriately stamped.
- Document usage in `docs/handbook/adding-language.md`.

Acceptance criteria

- Lint passes on current repo; a negative test shows a missing label is detected with clear remediation.

Risks

- Over‑linting can create noise; allow opt‑out for exceptional rules.

If not implemented

- Exporter may continue to surface early‑fail errors for mis‑stamped targets.

---

## PR 26: Planner plugin scaffolding via TS→Nix template

Intent/Impact

- Lower barrier to authoring `planner/<lang>.nix` while keeping Nix as the runtime.

Changes

- Add `tools/dev/planner-gen.ts` that converts a tiny TS config (predicates + kindOf) into a Nix file, using a stable template.
- Integrate with `lang-kit` so `scaf new lang-kit kit <id>` can optionally emit a generated planner file from TS config.

Acceptance criteria

- Generated `planner/<lang>.nix` matches hand‑written style and passes planner tests.

Risks

- Template drift between TS and Nix; maintain a single source template.

If not implemented

- Authors must write Nix by hand; slower onboarding.

---

## PR 27: Lang‑kit emits contract tests by default

Intent/Impact

- New languages start with runnable conformance tests.

Changes

- Extend `tools/scaffolding/templates/lang-kit/kit` to generate:
  - `tools/tests/<lang>/contract/*` with minimal fixtures and TARGETS
  - CI wiring based on capabilities

Acceptance criteria

- Running the generated tests passes with the stubbed provider/explorer/planner files.

Risks

- Test flakiness if fixtures rely on environment; keep fixtures minimal and hermetic.

If not implemented

- New languages ship without immediate safety nets; regressions surface late.

---

## PR 28: Diagnostics CLI for language enablement and staging

Intent/Impact

- Provide fast answers to “why isn’t my language active?” and “what stages will run?”.

Changes

- Add `tools/dev/langs-diagnose.ts`:
  - Prints enabled languages, missing `requiredPaths`, detected exporter adapters and planner plugins
  - Shows which CI stages would run given current capabilities

Acceptance criteria

- In a sparse checkout, command exits 0 and clearly shows disabled languages with missing paths.

Risks

- Output may become verbose; add `--json` and `--lang=<id>` filters.

If not implemented

- Onboarding and debugging take longer; more support burden.

---

## PR 29: Error policy wrapper for zx scripts

Intent/Impact

- Standardize user‑friendly skip/fail messages across scripts (PR‑17 UX).

Changes

- Add `tools/lib/cli-wrap.ts` exposing `runMain(fn)` that catches known errors and renders `printSkip`/exit codes consistently.
- Adopt in `scaf`, prebuild guard, provider sync, and diagnostics CLI.

Acceptance criteria

- Consistent messages and exit codes across commands; local non‑strict flows exit 0 on skips.

Risks

- Over‑catching exceptions might hide real failures; restrict to known types.

If not implemented

- UX inconsistency persists; higher cognitive load for users.

---

## PR 30: One‑shot “new language” workflow

Intent/Impact

- Cut setup to a single command for prototyping a new language.

Changes

- Extend `scaf new lang-kit kit <id>` to optionally:
  - append entry to `tools/nix/langs.json`
  - run `node tools/dev/codegen.ts`
  - create planner/provider/exporter stubs
  - open follow‑up TODOs in output (printed)

Acceptance criteria

- Running the command yields a minimal but compilable setup; diagnostics CLI shows the new language status.

Risks

- Accidental edits to manifest in shared branches; add `--no-manifest` opt‑out and confirmation prompts.

If not implemented

- New language bring‑up remains multi‑step and error‑prone.

---

## PR 31: Golden fixtures library for tests

Intent/Impact

- Speed up writing adapter tests and avoid duplication.

Changes

- Add `tools/tests/lib/fixtures/<lang>` with helpers and tiny lockfiles/source trees.
- Provide param helpers to point tools at temp paths created per test.

Acceptance criteria

- Existing exporter/provider tests refactored to use fixtures with no behavior changes.

Risks

- Fixture brittleness; keep fixtures tiny and version them alongside tests.

If not implemented

- Tests remain verbose and harder to maintain; higher barrier to new language tests.

---

## PR 32: Docs — plugin cookbook per surface

Intent/Impact

- Make each plugin surface approachable with copy‑paste snippets.

Changes

- Add short guides under `docs/handbook/`:
  - `exporter-adapter-cookbook.md`
  - `provider-sync-cookbook.md`
  - `planner-plugin-cookbook.md`
  - `macro-stamping-cookbook.md`

Acceptance criteria

- A teammate can add labels/providers/planner/macro for a toy language in <60 minutes using the cookbooks + lang‑kit.

Risks

- Docs drift; add links to source types and keep examples tested where feasible.

If not implemented

- Knowledge remains tribal; slower onboarding.

---

### Quality bar across Phase 3

- Deterministic outputs; sorted order where applicable
- Partial‑clone grace; never crash on missing languages
- Strong typing and small, well‑named functions; keep cyclomatic complexity low
- Tests stay green after each PR; add targeted tests for new behavior

---

### Appendix: Capability taxonomy mapping per language (reference)

- C++
  - `providerSyncMode`: "buildsystem-resolved"
  - `labelStrategy`: "rule-type" (e.g., `cxx_*`) with macro stamping fallback
  - `lockfileKinds`: ["conan", "vcpkg"] (optional if used)
  - `exporterLabels`: true | false (repo‑dependent)
  - Notes: providers come from declared deps; patchdir possible for vendored flows but uncommon

- Python
  - `providerSyncMode`: "lockfile"
  - `lockfileKinds`: ["poetry", "pdm", "pip-tools"]
  - `labelStrategy`: "lockfile" | "macro-stamp"
  - `exporterLabels`: true (if adapter adds) | false

- Kotlin/Java
  - `providerSyncMode`: "lockfile"
  - `lockfileKinds`: ["gradle", "maven"]
  - `labelStrategy`: "lockfile" | "macro-stamp" | "rule-type"
  - `exporterLabels`: true | false

- Rust
  - `providerSyncMode`: "lockfile+override"
  - `lockfileKinds`: ["cargo"]
  - `labelStrategy`: "lockfile" | "macro-stamp"
  - `exporterLabels`: true

- C# (.NET)
  - `providerSyncMode`: "lockfile"
  - `lockfileKinds`: ["nuget"]
  - `labelStrategy`: "lockfile" | "macro-stamp"
  - `exporterLabels`: true | false

- Erlang/Elixir
  - `providerSyncMode`: "lockfile"
  - `lockfileKinds`: ["rebar", "mix"]
  - `labelStrategy`: "lockfile" | "macro-stamp"
  - `exporterLabels`: true | false
