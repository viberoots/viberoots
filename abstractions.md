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
- Targets that participate in routing stamp `kind:<bin|lib|test|...>`.
- WASM variants stamp `kind:wasm` and `wasm:<variant>`.

### Canonical implementations

- **Starlark**: `lang/label_stamping.bzl` via `lang/defs_common.bzl` re-exports.
  - `stamp_labels(kwargs, lang, kind)`
  - `stamp_wasm_variant(kwargs, lang, variant)`
- **TypeScript exporter validation**: importer-scoped adapters warn when `kind:*` is missing for targets that should have it.
  - `tools/buck/exporter/lang/importer-scoped-adapter.ts`

### Regression guards

- **Lint**: `tools/dev/stamping-lint.ts` flags missing `lang:*` and invalid `kind:*`.

### Common leak patterns

These are the usual ways this leaks:

- A macro wraps a rule but forgets to stamp `lang:*` on some variants.
- A macro emits a “helper” target (stub, synthetic library) without stamping, so exporter routing becomes inconsistent.
- A macro stamps a kind label outside the accepted vocabulary, and tools silently diverge.

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

### Regression guards

- `tools/tests/labels/nix-attr-sanitize.parity.test.ts`

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

### Regression guards

- `tools/tests/labels/lockfile-label.parity.test.ts`

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

- **Package-local patching** (Go, C++):
  - Patch files live under the target’s Buck package, typically `patches/<lang>`.
  - Macros include patch files in the target’s action inputs, usually `srcs`.
  - Provider sync is not required to make patch changes invalidate builds.

- **Importer-local patching** (Node, Python):
  - Patch files live under `<importer>/patches/<lang>`.
  - Macros include importer-local patches in action inputs.
  - Provider sync and `auto_map` remain generated artifacts and are refreshed by glue tooling.

### Canonical implementations

- **Starlark package-local**: `lang/patch_inputs.bzl:include_package_local_patches` and `lang/patch_inputs.bzl:default_package_patch_dirs`.
- **Starlark importer-local**: `lang/patch_inputs.bzl:include_importer_patches_from_labels` plus `lang/importer_wiring.bzl:attach_importer_patch_inputs`.
- **TypeScript provider sync**: `tools/lib/provider-sync-driver.ts` and language adapters in `tools/buck/providers/*`.

### Regression guards

There are multiple relevant tests. The most important “contract locks” are:

- `tools/tests/providers/provider-sync-driver.patch-inclusion-policy.test.ts` (Node vs Python importer patch inclusion policy)
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
  - `lang/provider_edges.bzl:realize_provider_edges`
  - `lang/provider_edges.bzl:strip_provider_targets`
  - `lang/importer_wiring.bzl:merge_provider_edges`
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
- A planner-visible stub depends on provider targets, and hits visibility or graph-shape constraints. Use `strip_provider_targets(...)` for planner-visible stubs unless a stub explicitly needs provider deps.

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
- **TypeScript**: `tools/lib/provider-names.ts:normalizeNixAttr` (re-exported from `tools/lib/providers.ts`)
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

Importer-scoped wrappers should use a standardized wiring sequence:

- Enforce exactly one lockfile label.
- Stamp `lang:*` and `kind:*`.
- Attach importer-local patches as inputs (list and dict shapes).
- Realize provider edges into action inputs when a rule shape cannot accept `deps`.

### Canonical implementations

- **Starlark**: `lang/importer_wiring.bzl:prepare_importer_genrule_kwargs`

### Common leak patterns

These are the usual ways this leaks:

- A wrapper forgets the dict-safe branch and breaks when `srcs` is a map.
- A wrapper uses a different key prefix scheme for synthetic entries, and collisions become nondeterministic.

---

## Where abstractions are currently “thin” (known seams)

These are not necessarily bugs. They are places where the system is correct, but the abstraction boundary is easier to misuse.

### Two patch models across languages

Go/C++ are package-local. Node/Python are importer-local. That is intentional, but it means “patching” is not one uniform mental model.

### Node provider patch_paths are diagnostic

Node providers cannot list importer-local patch files as Buck `srcs` without cross-package references from `third_party/providers`. The correct invalidation path is macro-side inclusion of importer-local patches in action inputs. This is easy to misunderstand if you look only at providers.

### Some rules cannot accept `srcs`

Example: Buck prelude `python_binary` does not accept `srcs`. The macro has to carry patch inputs via a synthetic dependency. This is correct, but it is a place where “patch inputs always go in srcs” is false.

---

## Tightening improvements (recommended)

I would make these improvements next. They reduce the amount of call-site knowledge needed.

### Add a single helper for “macro calls Nix”

Today, some macros need to remember to do two things:

- Attach `global_nix_inputs()` as real inputs.
- Optionally stamp labels for observability.

I would add a single helper in `//lang` that does both in a consistent way, including dict-safe inputs.

### Add a single helper for importer-scoped non-genrule macros

We have good coverage for genrule-style macros (`prepare_importer_genrule_kwargs`). For non-genrule wrappers, the wiring is repeated across places. I would add a helper that returns:

- The derived importer string
- A wired `kwargs` (including patch inputs)
- A wired `deps` list (including provider edges)

This keeps error text, ordering, and dict-safe behavior consistent.

---

## Quick review checklist for changes

When I review a change that touches cross-language wiring, I check these items:

- Does it use `lang/defs_common.bzl` helpers instead of re-implementing logic?
- If it is importer-scoped, does it enforce exactly one `lockfile:<path>#<importer>` label?
- Are patch inputs attached in a way that matches the rule shape (list vs dict, `srcs` vs `resources`)?
- If the macro or rule calls Nix, does it attach `global_nix_inputs()` as real action inputs and avoid hardcoding `//:flake.lock`?
- If it introduces a new normalization or naming rule, is there a parity test across Starlark and TS (and Nix when applicable)?
