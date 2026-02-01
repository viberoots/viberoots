# Cross-Language Abstraction Audit (Go, C++, Node PNPM, Python uv)

This repo is intentionally multi-language. I treat the build system as one product with a small set of cross-language contracts. This document inventories those contracts, points to their canonical implementations, and describes what counts as a leak.

If you are adding a language, changing macro wiring, or changing glue generation, start here. If you change a contract, update the parity tests and the cookbook docs at the same time.

### Scope

This audit covers the cross-language “shared layer” and the places where it is consumed:

- **Starlark**: `//lang:*` helpers and language macros (`go/defs.bzl`, `cpp/defs.bzl`, `node/defs_*.bzl`, `python/defs.bzl`).
- **TypeScript tooling**: exporter, provider sync, auto-map generation, patch tooling.
- **Nix templates**: shared helpers and language templates used by the planner.

This audit does not attempt to review every language’s internal build logic in Nix. It focuses on the interfaces between Buck, Nix, and the glue scripts.

### Completion criteria

I consider this audit “done” when:

- Each cross-language contract has a single canonical implementation per layer (Starlark, TS, Nix).
- Each contract lists at least one regression test or lint that will fail when the contract breaks.
- Each contract calls out the common leak patterns, so code review has a checklist.

---

## Terminology

I use a few terms consistently:

- **Label contract**: a label string format that tools/macros interpret (examples: `lang:<id>`, `kind:<k>`, `nixpkg:<attr>`, `lockfile:<path>#<importer>`).
- **Importer-scoped ecosystem**: dependencies and patching are keyed by a lockfile and an importer directory (Node PNPM, Python uv).
- **Package-local patching**: patches live inside the Buck package that owns the target, and are included in that target’s inputs (Go, C++).
- **Provider edge**: a dependency edge from a target to a provider rule in `//third_party/providers:*`, realized via `MODULE_PROVIDERS`.
- **Glue**: generated files used to map labels to providers (graph export, provider sync outputs, `auto_map.bzl`, provider index).

---

## Contract 1: Language and kind label stamping

This contract ensures that a target’s language and kind are visible in the exported graph, and that exporter and planner routing can be table-driven.

### Contract

- Language targets stamp `lang:<id>`.
- Targets that participate in routing stamp `kind:<k>`, where `<k>` is an explicit, shared vocabulary.
- WASM variants stamp `kind:wasm` and `wasm:<variant>`.

For language macros, stamping is the macro’s responsibility. Call sites should not need to remember `lang:*` or `kind:*` labels.

- Go: `nix_go_test(...)` stamps `lang:go` and `kind:test` (auto-wired `*_test` targets do not pass a literal label list).
  - Implementation detail: `go/private/auto_tests.bzl` is the canonical implementation of Go auto-wired helper targets (called by `go/defs.bzl`).

### Canonical implementations

- **Starlark**: `lang/label_stamping.bzl` via `lang/defs_common.bzl` re-exports.
  - `stamp_labels(kwargs, lang, kind)`
  - `stamp_wasm_variant(kwargs, lang, variant)`
- **Starlark (package-local WASM macro wiring)**: `lang/wasm_package_local_wiring.bzl` via `lang/defs_common.bzl` re-exports.
  - `prepare_package_local_wasm_wiring(...)` (non-mutating at the call-site boundary; returns prepared `kwargs`; fixed ordering: wasm stamps → patch_scope → patch inputs → provider edges)
  - `wire_package_local_wasm_planner_visible_stub(...)` (preferred; non-mutating boundary, delegates to `wire_package_local_planner_visible_stub(...)`)
- **Kind vocabulary (contract)**:
  - Starlark: `lang/kind_vocabulary.bzl` (re-exported via `lang/defs_common.bzl`)
  - TypeScript: `tools/lib/kind-vocabulary.ts`
- **Nix planner kind inference (shared)**: `tools/nix/planner/lib.nix:kindOf` with per-language configs in planner plugins. Planners must not re-implement `kindOf`.
- **TypeScript exporter validation**: importer-scoped adapters warn when `kind:*` is missing for targets that should have it.
  - `tools/buck/exporter/lang/importer-scoped-adapter.ts`
- **TypeScript exporter classification registry**: shared config for looks-like rules, rule-type prefixes, labels, and guidance.
  - `tools/buck/exporter/lang/classification-registry.ts`

### Regression guards

- **Lint**: `tools/dev/stamping-lint.ts` flags missing `lang:*` and invalid `kind:*`.

### Common leak patterns

These are the usual ways this leaks:

- A macro wraps a rule but forgets to stamp `lang:*` on some variants.
- A macro emits a “helper” target (stub, synthetic library) without stamping, so exporter routing becomes inconsistent.
- A macro stamps a kind label outside the accepted vocabulary, and tools silently diverge.

---

## Contract 1.1: Unified language wiring entrypoint (non-mutating)

Language macros attach patch inputs and realize provider edges via a single shared wiring entrypoint that routes by language contract.

### Contract

- Language macros should use `prepare_language_wiring(...)` from `lang/defs_common.bzl`.
- The entrypoint must not mutate the caller’s kwargs dict. It returns a prepared `kwargs` dict for the underlying rule call, plus any derived patch dirs, nixpkgs deps, and/or importer info depending on the language contract.
- Per-model helpers remain internal implementation details; macro call sites must not select patch scope directly.

### Canonical implementations

- **Starlark**: `lang/language_wiring.bzl:prepare_language_wiring`
- **Starlark (internal)**: `lang/package_local_wiring.bzl:prepare_package_local_wiring`
- **Starlark (internal)**: `lang/importer_wiring*.bzl:prepare_importer_*`

### Regression guards

- `tools/tests/lang/language-wiring.non-mutating.probe.test.ts`
- `tools/tests/lang/language-wiring.unified.parity.test.ts`

### Common leak patterns

- A macro depends on helper-side mutation ordering (for example, it must pre-capture values before wiring pops keys).
- A macro branches on package-local vs importer-local instead of delegating to the contract-driven entrypoint.

---

## Contract 2: Sanitization parity for names and artifacts

This contract is the “lowest-level” parity rule. If it drifts, outputs and keys drift across Starlark, TS tooling, and Nix templates.

### Contract

The canonical sanitizer is the 4-step replacement:

- Replace `//` with empty string
- Replace `:` with `-`
- Replace `/` with `-`
- Replace space with `-`

No other transformations are part of this contract.

### Canonical implementations

- **Starlark**: `lang/sanitize.bzl:sanitize_name`
- **TypeScript**: `tools/lib/sanitize.ts:sanitizeName`
- **Nix**: `tools/nix/lib/lang-helpers.nix:sanitizeName`

### Regression guards

- `tools/tests/lang/sanitize-name.parity.test.ts` (Starlark `sanitize_name` vs TS sanitizer)
- `tools/tests/cpp/sanitize-name.parity.test.ts` (C++ bin-name sanitizer vs TS sanitizer)

### Common leak patterns

These are the usual ways this leaks:

- A tool or macro re-implements sanitization (often with extra replacements), and names start to diverge.
- A macro introduces a new place where sanitization matters (dict-safe keys, artifact names) but uses an ad-hoc scheme.

---

## Contract 3: Target label normalization and Nix attribute suffix derivation

Some tooling needs a stable mapping from a Buck target label to a Nix attribute suffix. This is a separate contract from “sanitizeName”.

### Contract

- Normalize target labels by:
  - Dropping any config suffix after `" ("`.
  - Dropping cell prefixes like `root//` and keeping `//...`.
- Derive a Nix-safe attribute suffix by:
  - Lowercasing.
  - Replacing non `[a-z0-9_]` with `_`.
  - Prefixing with `t`.

### Canonical implementations

- **TypeScript**: `tools/lib/labels.ts`
  - `normalizeTargetLabel`
  - `sanitizeAttrNameFromLabel`
- **Starlark**: `lang/nix_attr.bzl`
  - `normalize_target_label`
  - `sanitize_nix_attr_from_target_label`
- **Nix**: `tools/nix/lib/lang-helpers.nix`
  - `normalizeTargetLabel`
  - `packagePathFromTargetLabel`
  - `sanitizeAttrNameFromTargetLabel`

The Nix planner (`tools/nix/graph-generator.nix`) must not re-implement:

- Target label normalization (config suffix + cell prefix stripping)
- Package path derivation from target labels
- Nix attribute suffix derivation from target labels

It must route these transforms through `tools/nix/lib/lang-helpers.nix` so planner keying, selection (`BUCK_TARGET`), and package path behavior stay drift-free.

### Regression guards

- `tools/tests/labels/nix-attr-sanitize.parity.test.ts`
- `tools/tests/labels/nix-attr-sanitize.nix-ts.parity.test.ts`
- `tools/tests/labels/label-normalization-parity.test.ts`
- `tools/tests/planner/planner.flat-attrset-keying.stability.test.ts`

### Common leak patterns

These are the usual ways this leaks:

- A new tool parses Buck output and forgets to drop config suffixes.
- A new tool uses its own “cell stripping” logic and disagrees with the Starlark/Nix view.

---

## Contract 4: Importer-scoped lockfile label format and validation

Node and Python use importer-scoped lockfile labels. This label is a public interface. Many layers depend on it.

### Contract

The label format is:

- `lockfile:<path>#<importer>`

The validation rules are:

- The string must contain exactly one `#`.
- The lockfile path may include repeated leading `./` segments. These are stripped for canonicalization.
- The importer must match `dirname(<path>)`, except:
  - `importer == "."` is allowed only when `dirname(<path>) == "."` (repo-root lockfiles).
- Supported importer labels are:
  - `.`
  - `apps/*`
  - `libs/*`

### Canonical implementations

- **Starlark**: `lang/lockfile_labels.bzl`
  - `ensure_single_lockfile_label`
  - `importer_from_labels`
- **TypeScript**: `tools/lib/labels.ts`
  - `parseLockfileLabelParts`
  - `parseLockfileLabel`
- **TypeScript**: `tools/lib/importers.ts`
  - `isSupportedImporterLabel`
  - `findNearestLockfileForPackage` (canonical “walk upward to repo root” helper for importer-scoped tooling)
  - `findNearestPnpmLockForPackage`, `findNearestUvLockForPackage` (thin wrappers for common basenames)

### Regression guards

These tests are the guardrails for this cross-language contract. If you change importer support rules or label parsing behavior, update the matrix and keep these passing.

- `tools/tests/labels/lockfile-label.parity.test.ts`
- `tools/tests/lib/importer-support.parity.test.ts`

### Common leak patterns

These are the usual ways this leaks:

- A macro accepts `lockfile_label` but does not enforce exactly one label.
- A tool parses the label but does not enforce the importer-dir rule, so it accepts labels that Starlark rejects.
- A new importer root is introduced (for example `services/*`) but only TS is updated. Starlark then fails at macro evaluation time.

---

## Contract 5: Patch invalidation models

This repo supports two patch invalidation strategies. They are intentionally different. The abstraction boundary is that call sites should not mix models accidentally.

### Contract

I treat patch invalidation as two explicit models:

- **Graph-visible patch scope labels**:
  - All Go/C++/Node/Python targets are stamped with exactly one patch scope label derived from the language contract:
    - `patch_scope:package-local`
    - `patch_scope:importer-local`
- Stamping happens only at the shared wiring helper boundaries:
  - Canonical entrypoint: `lang/language_wiring.bzl:prepare_language_wiring`
  - Package-local planner-visible stubs: `lang/planner_visible_wiring.bzl:wire_package_local_planner_visible_stub`
  - Per-model helpers are internal (`lang/package_local_wiring.bzl`, `lang/importer_wiring*.bzl`).

- **Package-local patching** (Go, C++):
  - Patch files live under the target’s Buck package, typically `patches/<lang>`.
  - Macros include patch files in the target’s action inputs, usually `srcs`.
  - Provider sync is not required to make patch changes invalidate builds.
  - Planner-visible stubs for package-local languages still carry package-local patch files as real inputs, and must stamp `patch_scope:package-local`:
    - `nix_cpp_test`’s `<name>__planner` uses the canonical package-local planner-visible stub helper (`wire_package_local_planner_visible_stub(...)`) so patch edits invalidate the planner-visible boundary.
    - `nix_go_carchive` uses the canonical package-local planner-visible stub helper (`wire_package_local_planner_visible_stub(...)`) with provider edges realized into **inputs** (`provider_realization_mode = "inputs"`) so the stub remains a minimal graph node while still carrying the correct invalidation inputs.
    - `nix_cpp_wasm_emscripten_lib` uses `wire_package_local_wasm_planner_visible_stub(...)` so WASM stamping, patch scope stamping, patch inputs, provider handling, and planner-visible defaults stay consistent.
    - Package-local WASM macros use the shared WASM wiring helpers so ordering-sensitive steps (WASM stamping, patch scope, patch inputs, provider edges) cannot drift.

- **Importer-local patching** (Node, Python):
  - Patch files live under `<importer>/patches/<lang>`.
  - Macros include importer-local patches in action inputs.
  - Provider sync and `auto_map` remain generated artifacts and are refreshed by glue tooling.

### Diagnostics (how to answer “what invalidates what?”)

When debugging invalidation, it is easy to misread the surface area by looking only at provider files under `third_party/providers/`. The canonical answers are designed to be available without reading macro or generator code:

- `node tools/buck/prebuild-guard.ts` prints short, canonical one-liners that explain where invalidation comes from, using the contract vocabulary (`package-local` / `importer-local`).
- `tools/buck/invalidation-report.txt` is the canonical per-target report. It answers “what invalidates this target?” using the shared contract vocabulary and separates **real action inputs** from **diagnostic stamps**:
  - `patch_scope` and whether patch inputs are expected to be real action inputs (based on the patch model contract).
  - Where patch inputs are observed (list-shaped `srcs`, dict-shaped `srcs` under `__patch_inputs__/...`, or synthetic deps like `*__patch_inputs`). Dict-shaped `__patch_inputs__/...` observations are classified according to the target’s `patch_scope` (package-local vs importer-local).
  - Where global Nix inputs are observed as action inputs (`srcs` and/or `nix_inputs`). Label stamps are observability-only (`global_nix_inputs_labels_stamped`) and must not be treated as the source of truth for invalidation.
  - Realized provider edges are included as a debugging aid only. They are not the invalidation source of truth.
  - Regenerate (preferred): `node tools/buck/glue-pipeline.ts`
  - Regenerate (report-only): `node tools/buck/invalidation-report.ts`
- `third_party/providers/provider_index.json` is a single, stable report that maps provider targets to their origin key and includes additive patch-model metadata (`patch_scope`, `languages`, and where patch inputs are expected to be carried).

Rule: treat provider `patch_paths` as diagnostic/observability data for importer-scoped ecosystems. Invalidation is driven by real action inputs attached by macro wiring.

Regression guard for this diagnostic surface:

- `tools/tests/buck/invalidation-report.classifies-and-orders.test.ts` (fixture-level invariants: stable ordering, patch model classification, and action-input observation categories)
- `tools/tests/node/node.webapp.nix-calling.wiring.global-inputs-and-importer-patches-and-stamps.cquery.test.ts` (importer-local: importer patches are real action inputs for a representative dict-safe macro shape)
- `tools/tests/cpp/cpp.macros.library.package-local-patch-inputs-and-labels.cquery.test.ts` (package-local: package patches are real action inputs for a representative C++ macro)

### Canonical implementations

- **Patch model registry (Starlark)**: `//lang:lang_contracts.bzl`
- **Patch model registry (TypeScript)**: `tools/lib/lang-contracts.ts`
- **Starlark wiring entrypoint**:
  - `lang/language_wiring.bzl:prepare_language_wiring` (preferred macro-side helper that composes kwarg normalization, label stamping, patch input inclusion, and provider-edge realization deterministically without mutating call-site dicts).
- **Starlark package-local internals**:
  - `lang/patch_inputs.bzl:include_package_local_patches` and `lang/patch_inputs.bzl:default_package_patch_dirs`.
  - `lang/package_local_wiring.bzl:prepare_package_local_wiring`.
- **Starlark importer-local internals**: `lang/patch_inputs.bzl:include_importer_patches_from_labels` plus `lang/importer_wiring_primitives.bzl:attach_importer_patch_inputs`.

For importer-scoped ecosystems, there is an additional provider contract surface that is still part of the “patch model”, because it directly determines invalidation behavior and glue content.

- **Importer-scoped provider contract (TypeScript)**: `tools/lib/lang-contracts.ts`
  - `importerScopedProviderContractForLang(lang)` defines:
    - importer patch inclusion policy (`all` vs `effective-set-only`)
    - optional global patch dir inputs (for Node: `patches/node`, effective-set matches only)
    - lockfile label auto-attach requirement (`requires-kind-stamp`)
    - provider sync strictness support (Python supports strict parsing; default is non-strict)
- **TypeScript provider sync driver**: `tools/lib/provider-sync-driver.ts` (takes the contract values as explicit options; does not silently default)
- **Language adapters**: `tools/buck/providers/*` (read the contract and pass policy into the driver)
- **Effective set patch selection (TypeScript)**: `tools/lib/effective-set-patch-selection.ts` (scan flat patch dirs into a canonical key map; select global patch paths by importer effective set with stable ordering)

### Patch filename decoding (flat patch dirs)

Several layers scan a flat `patches/<lang>/*.patch` directory and need to agree on how a filename maps to a canonical key. This is a cross-language contract. Tooling and templates must not hand-roll `split("@")` or `__ -> /` decoding logic at call sites.

- **Contract**:
  - Patch filenames are decoded using the **last** `@` as the version separator.
  - The name portion is decoded with `__` -> `/` (PNPM-style).
  - The canonical key is lowercased and formatted as `importPath@version`.
  - Version normalization is explicit at the call site for languages that require it (Python strips suffix after `-`).
- **Canonical implementations**:
  - **TypeScript**: `tools/lib/providers.ts:decodeNameVersionFromPatch`
  - **Nix**: `tools/nix/lib/lang-helpers.nix:decodePatchFilename`
- **Nix (builders)**: `tools/nix/lib/lang-helpers.nix:patchesMapFromDirsWith` (canonical surface with optional `normalizeVersion` and store materialization)
- **Nix (builders, wrappers)**: `patchesMapFromDir`, `patchesMapFromDirs`, `patchesMapFromDirToStore`, `patchesMapFromImporterDirToStore`
- **Nix (builders, Python defaults)**: `tools/nix/lib/lang-helpers.nix:pythonPatchesMapFromDirs`
- **Loose decoding (lint-only)**:
  - **TypeScript**: `tools/lib/providers.ts:decodeNameVersionFromPatchLoose`
  - The loose variant is for `patches-lint` duplicate detection on case-insensitive filesystems only. It is not part of the cross-language contract and must not be used in build or planner paths.
- **Regression guards**:
  - `tools/tests/lib/parity.ts_nix_patch_key_parity.test.ts` (TS scan vs Nix `patchesMapFromDir` key set)
  - `tools/tests/nix/patch-filename-decoding.nix-ts.parity.test.ts` (TS decode vs Nix decode, including Python-style version normalization)

### Dev overrides (environment variable names)

Dev override environment variable names are treated as a cross-language contract. The names are data, not hardcoded strings, to avoid drift across Nix and TypeScript tooling.

- **Manifest (source of truth)**: `tools/lib/dev-override-envs.json`
- **TypeScript consumer**: `tools/lib/dev-override-envs.ts`
- **Nix consumer (planner mapping)**: `tools/nix/planner/overrides.nix` reads the JSON manifest
- **Nix consumer (template defaults)**: `tools/nix/lib/dev-override-envs.nix` reads the JSON manifest and templates use `envNameForLang(...)` instead of hardcoded strings

Rule: tooling must not hardcode `NIX_*_DEV_OVERRIDE_JSON` names. Resolve env var names from the manifest instead.

### Regression guards

There are multiple relevant tests. The most important “contract locks” are:

- `tools/tests/lang/lang-contracts.patch-model.parity.test.ts` (Starlark ↔ TS registry parity)
- `tools/tests/providers/provider-sync-driver.patch-inclusion-policy.test.ts` (Node vs Python importer patch inclusion policy)
- `tools/tests/lib/lang-contracts.importer-scoped-provider-contract.test.ts` (contract values are explicit and stable)
- Any macro tests that assert importer-local patches are included as inputs for Node/Python targets.

### Common leak patterns

These are the usual ways this leaks:

- A macro forgets to include patch files in action inputs, so patch edits do not invalidate anything.
- A rule uses dict-shaped `srcs`, and patch inputs are not attached dict-safely.
- A macro uses importer-local patches but fails to enforce the lockfile label contract, so importer derivation is ambiguous.

---

## Contract 6: Provider edges and auto-map wiring

Providers are how we attach “shared dependency state” to build targets without adding bespoke attributes across languages.

### Contract

- `third_party/providers/auto_map.bzl` is generated and provides `MODULE_PROVIDERS`.
- Language macros load providers through the stable re-export `lang/auto_map.bzl`.
- Macros realize provider edges deterministically using shared helpers. They do not hand-roll mapping logic.

### Canonical implementations

- **Starlark**:
  - `lang/provider_edges.bzl:merge_provider_edges` is the canonical macro wiring helper. It supports list inputs and dict-safe attachment via `dict_safe = True`.
  - `lang/provider_edges.bzl:realize_provider_edges` is the lower-level helper used by `merge_provider_edges` for list and kwargs bases.
  - `lang/provider_edges.bzl:strip_provider_targets`
- **TypeScript**:
  - `tools/buck/gen-auto-map.ts` (generator)
  - `tools/lib/labels.ts:providersForLabels` (mapping labels to provider targets)
- **Glue orchestrator**:
  - `tools/buck/glue-pipeline.ts` (ensure graph, sync providers, provider index, auto-map)

### Regression guards

- `tools/tests/normalization.nixpkg-providers-for-labels.wiring.test.ts` (ensures `providersForLabels` maps `nixpkg:*` correctly)
- Provider sync golden tests (Node and Python) that assert deterministic outputs.

### Common leak patterns

These are the usual ways this leaks:

- A macro loads `third_party/providers/auto_map.bzl` directly instead of using `lang/auto_map.bzl`.
- A macro merges provider edges by concatenating lists without stable dedupe, so order changes unexpectedly.
- A planner-visible stub depends on provider targets, and hits visibility or graph-shape constraints. Prefer `wire_*planner_visible*_stub(...)` helpers, which **strip provider targets from planner-visible `deps` by default**; only opt out when a stub explicitly needs provider deps.

---

## Contract 7: nixpkgs attribute normalization and `nixpkg:` labels

This is a cross-language public interface. The planner, provider naming, and auto-map depend on stable normalization.

### Contract

Normalization rules for a nixpkgs attribute string:

- Trim and lowercase.
- Ensure a `pkgs.` prefix.
- Apply alias mapping.
- Preserve historical compatibility for `pkgs.gtest` by mapping it to `pkgs.googletest`.

The label string is:

- `nixpkg:<normalized_attr>`

### Canonical implementations

- **Starlark**: `lang/nixpkg_labels.bzl:normalize_nix_attr` and `append_nixpkg_labels`
- Macro guidance: prefer `lang/defs_common.bzl:prepare_language_wiring(...)` so language macro files do not re-implement `nixpkg_deps` parsing/defaulting or patch-dir handling.
- **TypeScript**: `tools/lib/providers.ts:normalizeNixAttr` (canonical import path; implementation lives in `tools/lib/provider-names.ts`)
- **Nix**: `tools/nix/lib/lang-helpers.nix:normalizeNixAttr`

### Regression guards

- `tools/tests/normalization-parity.test.ts` (Starlark vs TS vs Nix)
- `tools/tests/provider-names/nix-attr-normalization.test.ts` (TS behavior)

### Common leak patterns

These are the usual ways this leaks:

- A macro appends `nixpkg:` labels without normalizing, and mapping logic has to guess.
- A new alias is added in one layer only, and the parity test starts failing.

---

## Contract 8: Global Nix inputs

Some rules and macros call Nix. Those actions must be invalidated by a small set of repo-global inputs. We treat these as real action inputs, not just labels.

### Contract

- The canonical list is returned by `global_nix_inputs()`.
- Call sites do not hardcode `//:flake.lock`.
- If a macro or rule calls Nix, it should attach global inputs as real action inputs, and may also stamp a label for observability.

### Canonical implementations

- **Starlark**: `lang/global_inputs.bzl`
  - `global_nix_inputs`
  - `attach_global_nix_inputs`
- **Starlark label stamp**: `lang/label_stamping.bzl:stamp_global_nix_inputs` (used only when justified)
- **Lint**: `tools/dev/lint-global-stamping.ts` (fails on direct `//:flake.lock` stamping)

### Regression guards

There are targeted tests for Node and rule-level shims that assert `//:flake.lock` is present via the helper surface.

### Common leak patterns

These are the usual ways this leaks:

- A macro shells out to Nix but only stamps labels, and forgets to attach `global_nix_inputs()` into action inputs.
- A macro hardcodes `//:flake.lock`, and then drifts when the policy changes.

---

## Contract 9: Importer-scoped macro wiring for genrule-style wrappers

Node uses genrule-style wrappers heavily, and some of them use dict-shaped `srcs`. This needs a shared wiring path to avoid drift.

### Contract

Importer-scoped wrappers should use a standardized wiring sequence. When a wrapper also invokes Nix, it should attach global Nix inputs as real action inputs and standardize workspace-root env injection.

- Enforce exactly one lockfile label.
- Stamp `lang:*` and `kind:*`.
- Attach importer-local patches as inputs (list and dict shapes).
- Realize provider edges into action inputs when a rule shape cannot accept `deps`.
- When invoking Nix, attach `global_nix_inputs()` as real action inputs (list and dict shapes) and optionally stamp the label for observability.
- When a genrule command needs a stable repo root in sandboxed/temp-repo environments, inject `tools/buck/workspace-root.env` into dict-shaped `srcs` in a standardized way.

### Canonical implementations

- **Starlark**: `lang/defs_common.bzl:prepare_language_wiring(...)` with `wiring = "nix_calling_genrule"`
- **Starlark (command assembly)**: `lang/nix_shell.bzl`
  - `nix_calling_genrule_bootstrap(...)` (root derivation + optional `workspace-root.env` sourcing)
  - `nix_calling_genrule_nix_build_out_path_prefix(...)` (canonical `nix build --no-link --print-out-paths` outPath capture)
  - `nix_calling_env_export_buck_graph_json(...)` and `nix_calling_env_export_nix_pnpm_fetch_timeout(...)` (standard env exports used by Node Nix-calling macros)

### Common leak patterns

These are the usual ways this leaks:

- A wrapper forgets the dict-safe branch and breaks when `srcs` is a map.
- A wrapper uses a different key prefix scheme for synthetic entries, and collisions become nondeterministic.
- A wrapper shells out to Nix but forgets to attach global inputs as real action inputs, so changes to global inputs do not invalidate.
- A Node macro hand-rolls `nix build ... --no-link --print-out-paths` command assembly or drifts on env exports. Use the `lang/nix_shell.bzl` helpers so `node_webapp` and bundled `nix_node_cli_bin` stay consistent.

### Dict-safe synthetic key prefixes

Dict-shaped attributes that carry synthetic attachments (for example importer-local patches and provider edges) use two reserved key prefixes:

- `__patch_inputs__/...`
- `__provider_edges__/...`
- `__global_nix_inputs__/...`

These prefixes are a shared contract. Do not hardcode these strings. Import the canonical constants:

- `//lang:defs_common.bzl` (`PATCH_INPUTS_KEY_PREFIX`, `PROVIDER_EDGES_KEY_PREFIX`, `GLOBAL_NIX_INPUTS_KEY_PREFIX`)
- Source of truth: `//lang:dict_inputs.bzl`

### Enforcement

The contract is guarded by probe and enforcement tests. If a new macro bypasses the shared helper surface, these should fail:

- `tools/tests/lang/importer-wiring.attach-patches-and-providers.probe.test.ts`: proves list and dict `srcs` shapes both receive importer-local patch inputs and provider edges.
- `tools/tests/lang/importer-wiring.macros-avoid-direct-lockfile-parsing.enforcement.test.ts`: prevents importer-scoped macro implementations from directly loading `//lang:lockfile_labels.bzl` instead of delegating to shared wiring.
- `tools/tests/lang/importer-nix-calling-genrule-wiring.attach-patches-providers-global-inputs.probe.test.ts`: proves list and dict `srcs` shapes receive importer-local patch inputs, provider edges, global Nix inputs, and standardized workspace-root env injection.
- `tools/tests/node/node.nix-calling-macros.use-shared-importer-nix-genrule-helper.enforcement.test.ts`: prevents Node Nix-calling macro implementations from bypassing the shared helper.
- `tools/tests/node/node.defs-core.uses-non-mutating-importer-wiring.enforcement.test.ts`: prevents Node macros from falling back to the mutating importer wiring helpers.
- `tools/tests/lang/starlark.no-legacy-mutating-outside-lang.enforcement.test.ts`: prevents reintroduction of legacy mutating wiring helpers outside `//lang/*`.

---

## Contract 10: Importer-scoped macro wiring for non-genrule wrappers

Some importer-scoped macros wrap real rules directly (for example `python_library`, `python_test`) and do not follow the genrule-style path. These call sites still need consistent lockfile enforcement, importer derivation, patch-input attachment, and provider-edge realization.

### Contract

Importer-scoped non-genrule wrappers should:

- Enforce exactly one lockfile label (`lockfile:<path>#<importer>`).
- Stamp `lang:*` and `kind:*`.
- Derive the importer string from the lockfile label deterministically.
- Attach importer-local patch files as real action inputs (list and dict shapes, depending on the rule attribute).
- Merge provider edges deterministically (usually into `deps`, or into an input attribute when a rule shape cannot accept deps).

### Canonical implementations

- **Starlark (preferred)**: `lang/defs_common.bzl:prepare_language_wiring(...)` with `wiring = "non_genrule"`
- **Starlark (Nix-calling, preferred)**: `lang/defs_common.bzl:prepare_language_wiring(...)` with `wiring = "non_genrule_nix_calling"` (composes non-genrule importer wiring plus `global_nix_inputs()` as real action inputs, without mutating caller dicts)
- **Genrule-style (preferred)**: `lang/defs_common.bzl:prepare_language_wiring(...)` with `wiring = "genrule"`
- **Python macro usage**: `python/defs.bzl` (`nix_python_library`, `nix_python_test`, `nix_python_wasm_*`)
- **Srcs-less rule shapes (preferred)**: `lang/defs_common.bzl:prepare_language_wiring(...)` with `wiring = "srcsless_rule"` (creates a synthetic dep carrying importer-local patches as action inputs)
  - Python macro usage: `python/defs.bzl` (`nix_python_binary`)

### Common leak patterns

- A wrapper calls `ensure_single_lockfile_label(...)` / `importer_from_labels(...)` directly and drifts on error text or future policy changes.
- A wrapper attaches importer-local patches but not as real action inputs (so patch edits do not invalidate).
- A wrapper merges provider edges by hand and loses stable ordering/dedupe.

### Enforcement

These tests serve as the regression suite for the non-genrule importer-scoped wiring contract:

- `tools/tests/python/python.importer-patches.srcs-inclusion.cquery.test.ts`: verifies Python macros include importer-local patches as real action inputs.
- `tools/tests/node/node.webapp-and-cli.importer-patches-action-inputs.srcs.test.ts` and `tools/tests/node/node.nix-test.importer-patches-action-inputs.srcs.test.ts`: verify Node importer-local patches are real action inputs across representative macro shapes.
- `tools/tests/lang/importer-wiring.macros-avoid-direct-lockfile-parsing.enforcement.test.ts`: ensures macro implementations route lockfile parsing/enforcement through `//lang:importer_wiring.bzl`.

---

## Where abstractions are currently “thin” (known seams)

These are not necessarily bugs. They are places where the system is correct, but the abstraction boundary is easier to misuse.

### Two patch models across languages

Go/C++ are package-local. Node/Python are importer-local. That is intentional, but it means “patching” is not one uniform mental model.

### Node provider patch_paths are diagnostic

Node providers cannot list importer-local patch files as Buck `srcs` without cross-package references from `third_party/providers`. The correct invalidation path is macro-side inclusion of importer-local patches in action inputs. This is easy to misunderstand if you look only at providers.

### Some rules cannot accept `srcs`

Example: Buck prelude `python_binary` does not accept `srcs`. `nix_python_binary` carries importer-local patch inputs via a synthetic dependency created by `prepare_language_wiring(...)` with `wiring = "srcsless_rule"`.

---

## Tightening improvements (recommended)

I would make these improvements next. They reduce the amount of call-site knowledge needed.

### Add a single helper for “macro calls Nix”

Today, some macros need to remember to do two things:

- Attach `global_nix_inputs()` as real inputs.
- Optionally stamp labels for observability.

Implemented in two layers, depending on the macro shape:

- **Generic “call Nix” helper**: `lang/nix_calling_macros.bzl:wire_global_nix_inputs(...)` (re-exported from `lang/defs_common.bzl`)
- **Importer-scoped, genrule-style helper**: `lang/defs_common.bzl:prepare_language_wiring(...)` with `wiring = "nix_calling_genrule"` (composes importer wiring plus global inputs and workspace-root env injection without mutating caller dicts)
- **Importer-scoped, non-genrule helper**: `lang/defs_common.bzl:prepare_language_wiring(...)` with `wiring = "non_genrule_nix_calling"` (composes importer wiring plus global inputs without mutating caller dicts)

### Add a single helper for importer-scoped non-genrule macros

Implemented: `lang/defs_common.bzl:prepare_language_wiring(...)` with `wiring = "non_genrule"` centralizes lockfile enforcement, importer derivation, patch input wiring, and provider-edge realization for non-genrule importer-scoped macros without mutating caller kwargs.

---

## Quick review checklist for changes

When I review a change that touches cross-language wiring, I check these items:

- Does it use `lang/defs_common.bzl` helpers instead of re-implementing logic?
- If it is importer-scoped, does it enforce exactly one `lockfile:<path>#<importer>` label?
- Are patch inputs attached in a way that matches the rule shape (list vs dict, `srcs` vs `resources`)?
- If the macro or rule calls Nix, does it attach `global_nix_inputs()` as real action inputs and avoid hardcoding `//:flake.lock`?
- If it introduces a new normalization or naming rule, is there a parity test across Starlark and TS (and Nix when applicable)?
