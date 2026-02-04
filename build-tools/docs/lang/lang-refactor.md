## Language architecture refactor plan

This plan reorganizes language-specific pieces (currently Go) into a plugin-style layout so that adding new languages (e.g., Rust) is straightforward, and partial clones can include only selected languages.

### Goals

- Isolate language-agnostic core (planner, exporter, scaffolding CLI, test harness)
- Move per-language code into small, well-defined modules (Nix builders, Starlark macros, provider sync, templates)
- Make language enablement explicit and discoverable, supporting partial clones
- Minimize cyclomatic complexity and maximize readability/self-documenting code throughout the refactor

### Non-goals

- Implement Rust; we focus on structure to make it easy to add later
- Change existing Go behavior (except import paths/registries), or CI semantics

---

## PR 1: Split Nix language templates and extract helpers

Intent/Impact

- Create a clean boundary for per-language build templates. Enables adding new languages by implementing a single file and registering it.

Changes

- Add `build-tools/tools/nix/lib/lang-helpers.nix` with shared helpers (patch dir scan, dev overrides, sanitize, resolve module root, cleanSource helpers)
- Move Go templates from `build-tools/tools/nix/lang-templates.nix` to `build-tools/tools/nix/templates/go.nix` importing helpers
- Make `build-tools/tools/nix/lang-templates.nix` a registry re-exporting `{ go = import ./templates/go.nix; }`

Acceptance criteria

- `nix build .#graph-generator` still succeeds for current Go repos
- No changes to Go store paths for an unchanged graph (except template import paths in logs)
- All tests pass

---

## PR 2: Pluggable planner registry in `graph-generator.nix`

Intent/Impact

- Decouple language detection/derivation creation from planner core logic. Allows enabling/disabling languages per repo or partial clone.

Changes

- Introduce `LANGS` attrset (registry). For each language provide:
  - `isTarget(n) -> bool`, `kindOf(n) -> "bin"|"lib"|null`
  - `modulesFileFor(name) -> path` (language-specific lockfile resolver)
  - `mkApp(name)`/`mkLib(name)` using `build-tools/tools/nix/lang-templates.nix.<lang>`
- Refactor current Go logic (`modulesTomlFor`, overrides, `mkGo`) into `LANGS.go`
- Update `pick()` to dispatch by:
  1. mapping.nix; else
  2. first matching `LANGS.*.isTarget`
- Keep manifest/BUCK_TARGET selection unchanged

Acceptance criteria

- Planner still builds existing Go apps/libs and emits the same bin manifest
- Partial clone safety: if Go files are absent, planner does not fail; it produces an empty graph-outputs
- All tests pass

---

## PR 3: Normalize labels and exporter thin per-language adapters

Intent/Impact

- Ensure the exporter and planner rely on consistent metadata; move language specificity into tiny adapters.

Changes

- Confirm all macros stamp `labels = ["lang:<lang>", "kind:<bin|lib|test>"]`
- Add `build-tools/tools/buck/exporter/lang/go.ts` with any Go-specific label tweaks
- Update `build-tools/tools/buck/exporter/main.ts` to call adapters based on `lang:*` label; default path stays language-agnostic

Acceptance criteria

- Exporter behavior remains the same for Go
- New file organization is in place without functional regressions
- Tests referencing exporter labels pass

---

## PR 4: Shared Starlark helpers and thinner Go macros

Intent/Impact

- Reduce duplication and encode best practices once; future languages reuse helpers.

Changes

- Add `lang/defs_common.bzl` with helpers for:
  - Label stamping (`lang`, `kind`)
  - Auto-wiring tests (pattern input, library binding)
  - Visibility and default attrs
- Refactor `build-tools/go/defs.bzl` to use common helpers; keep Go-specific patterns:
  - Lib tests: `pkg/**/*_test.go`
  - App tests: `cmd/<name>/**/*_test.go` (synth lib as needed)

Acceptance criteria

- Current auto-wiring behavior preserved for Go
- No target name/visibility regressions
- All Go tests pass

---

## PR 5: Provider sync generalization

Intent/Impact

- Centralize provider sync; allow multiple languages without duplicating entrypoints.

Changes

- Move current Go sync logic to `build-tools/tools/buck/providers/go.ts`
- Add `build-tools/tools/buck/providers/index.ts` that scans `patches/<lang>` and dispatches to language handlers
- Make `build-tools/tools/buck/sync-providers.ts` call the index; keep CLI unchanged

Acceptance criteria

- Existing provider sync for Go continues to work
- Empty or missing `patches/go` yields no-op without warnings (outside strict tests)
- Tests for single/duplicate/empty providers pass

---

## PR 6: Glue runner language registry

Intent/Impact

- Parameterize glue so only enabled languages run steps; supports partial clones and incremental language enablement.

Changes

- In `build-tools/tools/dev/install/glue.ts`, detect enabled languages by presence of `build-tools/tools/nix/templates/<lang>.nix` or a small `build-tools/tools/nix/langs.json`
- Loop per-language glue steps (provider sync, optional generators), plus universal export-graph

Acceptance criteria

- Glue runs identically for current repo (Go enabled)
- Deleting Go template from a temp copy causes glue to skip Go steps gracefully

---

## PR 7: Scaffolding language registry and per-language command wiring

Intent/Impact

- Make adding new languages to `scaf` trivial via registration and templates.

Changes

- Create a `languages` registry in `build-tools/tools/scaffolding/scaf.ts` (name, kinds, commands)
- Wire `scaf new <lang> <kind>` via registry; keep Go behavior and help text intact
- Keep per-language templates under `build-tools/tools/scaffolding/templates/<lang>`

Acceptance criteria

- `scaf new go cli/lib` and `scaf new go test` unchanged in UX
- Help/completions list only registered languages

---

## PR 8: Test harness consolidation for language fixtures

Intent/Impact

- Reduce boilerplate in zx tests and make it easy to add Rust tests later.

Changes

- Add `build-tools/tools/tests/lib/lang-fixtures.ts` exposing:
  - `scaffoldApp(lang, name)` / `scaffoldLib(lang, name)`
  - `writeTest(lang, path, name)`
  - `buckBuild(target)` / `buckTest(target)` / `nixBuildBuckTarget(target)`
- Update Go tests to use fixtures progressively

Acceptance criteria

- Test runtime equal or faster; reduced duplication in test code
- All tests pass

---

## PR 9: Documentation updates

Intent/Impact

- Provide a clear, step-by-step guide to add a new language.

Changes

- Expand `docs/handbook/adding-language.md` with:
  - Implementing `build-tools/tools/nix/templates/<lang>.nix`
  - Registering in planner registry
  - Adding Starlark macros via `lang/defs_common.bzl`
  - Provider sync handler (optional)
  - Scaffolding templates and registry entry
  - Tests (using fixtures)

Acceptance criteria

- Doc builds lint-clean; reflects the final layout and commands

---

## Rollout and risks

- Each PR keeps tests green; behavior should be preserved for Go
- Partial clone coverage validated by existing partial-clone tests; add a variant that simulates “no Go” to prove graceful no-op

## Success criteria

- Adding another language requires creating one Nix template file, one Starlark macro file, optional provider sync, templates, and registering them. No touching of planner/exporter core logic beyond registry entries.
