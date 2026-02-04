# Adding a Language

This guide explains how to add a new language to the build without touching core planner/exporter logic. The architecture is plugin-style: each language contributes a small set of files and a registry entry. Sparse checkouts are supported — existence of your language files controls enablement.

> Note (Node/PNPM): The Node Nix template at `build-tools/tools/nix/templates/node.nix` is a discoverability shim only. The authoritative Node planner logic lives in `build-tools/tools/nix/planner/node.nix`, and Node builds flow through Buck macros plus importer‑scoped providers. Do not implement build logic in `templates/node.nix`; keep logic in the planner plugin and Starlark macros.

## Macro author checklist (helpers + enforcement)

When you add or change a macro, keep the wiring table-driven through shared helpers. These are the expected helper surfaces, and the enforcement tests that guard them:

- Follow the macro call-site conventions in `docs/handbook/conventions.md`. In particular, keep a single merge point for labels and deps before calling shared wiring helpers.
- Legacy mutating helper surfaces have been removed. Any reintroduction is blocked by enforcement tests; do not add new “mutating wiring helpers” at macro boundaries.

- **Importer-scoped, non-genrule wrappers** (wrap `python_library`, `python_test`, etc.)
  - Use `prepare_language_wiring(...)` with `wiring = "non_genrule"` (or `wiring = "srcsless_rule"` when the rule shape cannot accept `srcs`).
  - Guardrails:
    - `build-tools/tools/tests/lang/importer-wiring.macros-avoid-direct-lockfile-parsing.enforcement.test.ts`
- **Importer-scoped, Nix-calling genrule-style macros** (wrap `genrule` that shells out to Nix)
  - Use `prepare_language_wiring(...)` with `wiring = "nix_calling_genrule"` (do not call `wire_global_nix_inputs(...)` at the call site).
  - Guardrails:
    - `build-tools/tools/tests/node/node.nix-calling-macros.use-shared-importer-nix-genrule-helper.enforcement.test.ts`
- **Importer-scoped, non-genrule macros that call Nix at runtime** (non-genrule wrapper + needs global Nix action inputs)
  - Use `prepare_language_wiring(...)` with `wiring = "non_genrule_nix_calling"`.
  - Guardrails:
    - `build-tools/tools/tests/node/node.defs-core.uses-non-mutating-importer-wiring.enforcement.test.ts`
    - `build-tools/tools/tests/node/node.defs-core.nix-node-test.must-not-call-wire-global-nix-inputs.enforcement.test.ts`
- **Package-local macros** (Go/C++ patch scope)
  - Use `prepare_language_wiring(...)` and pass a single `deps` list that already includes any repo-local extras.
  - Guardrails:
    - `build-tools/tools/tests/lang/package-local-wiring.enforcement.no-bypass.test.ts`
- **Planner-visible stubs** (graph node for planner discovery/invalidation)
  - Use `wire_package_local_planner_visible_stub(...)` for package-local stubs.
- **Package-local WASM macros (Go, C++)**
  - Use `prepare_language_wiring(...)` with `wasm_variant = "<variant>"`.
    - This helper is non-mutating at the call-site boundary. Do not rely on helper-side mutation ordering; use the returned prepared `kwargs` for the underlying rule.
  - For planner-visible package-local WASM stubs, use `wire_package_local_wasm_planner_visible_stub(...)`.
- **Dict-shaped `srcs`** (when wiring patches/providers/global inputs into dict-safe keys)
  - Do not hardcode reserved synthetic key prefixes. Import `PATCH_INPUTS_KEY_PREFIX`, `PROVIDER_EDGES_KEY_PREFIX`, `GLOBAL_NIX_INPUTS_KEY_PREFIX` from `//lang:defs_common.bzl`.
  - Guardrails:
    - `build-tools/tools/tests/lang/dict-inputs.synthetic-prefixes.no-literals.enforcement.test.ts`

## What you’ll implement

- Templates: `build-tools/tools/nix/templates/<lang>.nix` consumed by `build-tools/tools/nix/lang-templates.nix`
- Planner registry entry: `LANGS.<lang>` inside the planner (dispatch predicates + mkApp/mkLib)
- Macros: thin Starlark wrappers using `lang/defs_common.bzl` helpers
- Provider sync (optional): implement your generator under `build-tools/tools/buck/providers/<lang>.ts` (scans `patches/<lang>` and writes `TARGETS.<lang>.auto` deterministically). Provider sync is invoked through the unified orchestrator `build-tools/tools/buck/sync-providers.ts` (for example `node build-tools/tools/buck/sync-providers.ts --lang <lang> --no-glue`).
- Scaffolding templates: `build-tools/tools/scaffolding/templates/<lang>/...` + language registry entry
- Tests: zx tests using `build-tools/tools/tests/lib/lang-fixtures.ts`

### Language contracts and manifest

- The project defines shared TypeScript interfaces in `build-tools/tools/lib/lang-contracts.ts`:
  - `ScaffoldingLanguage` describes discovery metadata for `build-tools/tools/lib/langs.ts`
  - `LanguageProviderSync` is the provider sync adapter surface used by `build-tools/tools/buck/sync-providers.ts`
  - `PlannerLanguage` is used by TS-side helpers that enumerate planner capabilities
- The language registry is manifest‑driven via `build-tools/tools/nix/langs.json`. Discovery is partial‑clone safe:
  - Only languages whose `requiredPaths` exist are considered enabled
  - Orchestrators dynamically derive their registries from this manifest; missing languages are skipped without errors
- When adding a new language, update `build-tools/tools/nix/langs.json` and ensure your `requiredPaths` gate enablement correctly.

### Shared helpers (use these instead of rolling your own)

- Nix (`build-tools/tools/nix/lib/lang-helpers.nix`):
  - `patchesMapFromDir`, `patchesMapFromDirs` for path‑based scanning
  - `patchesMapFromDirToStore`, `patchesMapFromImporterDirToStore` for store‑materialized inputs (Python)
  - `readDevOverrides`, `guardNoDevOverridesInCI` for override parity (Go/C++/Python)

For importer-scoped ecosystems, we try hard to keep “how we find lockfiles” and “how we enumerate importer-provider index entries” fully shared so Node/Python (and future lockfile ecosystems) can’t drift.

- TypeScript (`build-tools/tools/lib/importers.ts` + `build-tools/tools/lib/provider-index.ts`):
  - `findImporterLockfiles` (use basenames like `["pnpm-lock.yaml"]` or `["uv.lock"]`) and `computeImporterLabel`
  - `findNearestLockfileForPackage` (canonical nearest-lockfile lookup; do not hand-roll upward walks)
  - `defaultImporterPatchDir`, `listImporterPatches`
  - Keeps importer‑local patch discovery and sorting consistent across Node and Python
- `readImporterProviderIndexEntriesForSingleImporterLockfileBasenames` — shared “provider index enumeration” surface for importer-scoped languages with one importer per lockfile (dirname-based), keyed by lockfile basenames
  - `build-tools/tools/lib/provider-writer.ts` — emits deterministic importer‑scoped provider TARGETS and synchronizes the curated auto‑managed section. Pass your computed `{ lockfile, importer, patchPaths }` entries plus the rule load/name.
    - Prefer the convenience wrapper `writeImporterProvidersByLang(...)`, which is table‑driven via a small registry. To add a new importer‑scoped ecosystem, extend that registry instead of adding per‑language conditionals.

- Starlark (`lang/defs_common.bzl`):

  When authoring a **package-local patching macro** (Go/C++ style), avoid re-assembling the “patch dirs + nixpkg deps + labels + providers” sequence by hand. Use the shared helper so defaults and tolerance rules don’t drift across languages.
  - `prepare_language_wiring(...)` (default for new macros)
    - Pops `local_patch_dirs` with a language default (`default_package_patch_dirs(lang)`)
    - Pops `nixpkg_deps` and appends normalized `nixpkg:` labels (canonical normalizer)
    - Stamps `lang:*` and `kind:*` labels (or you can opt out when another stamper is used)
    - Includes package-local `*.patch` files as action inputs (via `srcs`)
    - Realizes provider edges deterministically (via `MODULE_PROVIDERS`)

  Minimal example:

```python
load("@prelude//:rules.bzl", "genrule")
load("//lang:auto_map.bzl", "MODULE_PROVIDERS")
load("//lang:defs_common.bzl", "prepare_language_wiring")

def my_pkg_local_rule(name, **kwargs):
    deps = kwargs.pop("deps", [])
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kwargs,
        lang = "cpp",
        kind = "lib",
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        deps = deps,
    )
    genrule(
        name = name,
        srcs = kwargs.get("srcs", []) or [],
        out = name + ".stamp",
        cmd = ": > $OUT",
        deps = wiring.deps,
        labels = kwargs.get("labels", []) or [],
        visibility = kwargs.get("visibility", []),
    )
```

When your macro must emit a **planner-visible stub** (a graph node for planner discovery / invalidation, without producing a normal Buck-built artifact), use the shared helper instead of wiring the stub by hand:

- `wire_package_local_planner_visible_stub(...)` (preferred; non-mutating at the call-site boundary)
  - Pops `local_patch_dirs` and `nixpkg_deps` (when present) and appends normalized `nixpkg:` labels
  - Stamps exactly one `patch_scope:*` label for the language
  - Stamps `lang:*` and `kind:*` (including non-standard kinds like `carchive`)
  - Attaches package-local patch files as stub inputs
  - Strips provider targets from planner-visible `deps` **by default** (opt out via `strip_providers_from_deps = False`)
  - Optionally realizes provider edges into `deps` or **inputs** (`srcs`) via `provider_realization_mode = "deps"|"inputs"`

Rule: new package-local planner-visible stub call sites must use the non-mutating helper. Do not introduce legacy/mutating variants.
Rule: new package-local planner-visible stub call sites must use the non-mutating helper. Do not introduce legacy/mutating variants.

### Python notes

- Path invariants:
  - Patches are importer-local: `<importer>/patches/python/` (flat, no subdirectories).
  - Lockfile labeling is importer‑scoped: `lockfile:<path>#<importer>`; standard file is `uv.lock`.
  - Macros: use `nix_python_{library,binary,test}` from `python/defs.bzl` and pass `lockfile_label` explicitly.
    - Do not pass `lockfile:` labels through `labels`; importer identity is derived from `lockfile_label` and macros require exactly one lockfile label.
  - Macro wiring: importer-scoped wiring is centralized via:
    - Prefer `//lang:defs_common.bzl:prepare_language_wiring(...)` with `wiring = "non_genrule"` for `nix_python_library`, `nix_python_test`, and `nix_python_wasm_*` (non-mutating).
    - Prefer `//lang:defs_common.bzl:prepare_language_wiring(...)` with `wiring = "srcsless_rule"` for rule shapes that cannot accept `srcs` (example: prelude `python_binary`).
- Scaffolding:
  - `scaf new python lib <name>` → `libs/<name>` with `pyproject.toml`, `uv.lock`, `TARGETS` using `nix_python_library` and a sample test via `nix_python_test`.
  - `scaf new python app <name>` → `apps/<name>` with a small library and binary (`nix_python_binary`) and importer‑scoped `lockfile_label`.
- Glue:
  - Provider sync reads all `**/uv.lock` and writes `third_party/providers/TARGETS.python.auto` deterministically.
  - Python provider sync does **not** accept a global `patchDir` input; patch discovery is always importer-local under `<importer>/patches/python`.
  - `gen-auto-map.ts` already maps generic `lockfile:` labels to importer providers; no Python‑specific code required.
  - Reuse `build-tools/tools/lib/importers.ts` to compute the importer string and list importer‑local patches deterministically.

Tip for lockfile-style ecosystems (e.g., Node/PNPM):

Use the shared helpers from `lang/defs_common.bzl` so call sites do not reassemble wiring details:

- Supported importer labels are a cross-language contract surface. The importer string must be:
  - defined by `build-tools/tools/lib/importer-roots.json` (single source of truth)
  - rendered to Starlark as `lang/importer_roots.bzl`

If you need to change supported importer roots, update `build-tools/tools/lib/importer-roots.json` and re-run glue generation (for example via `i` or `node build-tools/tools/buck/glue-pipeline.ts`). The parity/enforcement tests will fail if the generated Starlark view is stale.

- `ensure_single_lockfile_label(kwargs, lockfile_label)` enforces exactly one importer-scoped label (`lockfile:<path>#<importer>`) with stable dedupe and canonical error text.
- `include_importer_patches_from_labels(kwargs, lang, into = "srcs")` derives the importer and includes importer-local patches deterministically into a supported input attribute (commonly `srcs` or `resources` depending on the rule shape).
- For importer-scoped, **Nix-calling genrule-style** macros, use:
- `prepare_language_wiring(...)` with `wiring = "nix_calling_genrule"`
  - It composes lockfile enforcement, label stamping, importer patch inputs, provider edge realization into `srcs`, optional `build-tools/tools/buck/workspace-root.env` injection for dict-shaped `srcs`, and global Nix inputs as real action inputs (optional stamp).
  - When you need dict-safe synthetic keys, do not hardcode any reserved prefixes. Import:
    - `PATCH_INPUTS_KEY_PREFIX`
    - `PROVIDER_EDGES_KEY_PREFIX`
    - `GLOBAL_NIX_INPUTS_KEY_PREFIX`
      from `//lang:defs_common.bzl`.

Minimal example (dict-shaped `srcs`):

```python
load("@prelude//:rules.bzl", "genrule")
load("//lang:defs_common.bzl", "prepare_language_wiring")

def my_importer_nix_genrule(name, lockfile_label = None):
    # Dict-shaped srcs: preserve caller mapping, and allow shared helper to attach
    # synthetic dict keys for patch inputs / provider edges / global inputs.
    srcs = {
        "package.json": "package.json",
    }
    wiring = prepare_language_wiring(
        name = name,
        kwargs = {},
        srcs = srcs,
        deps = [],
        lang = "node",
        kind = "gen",
        lockfile_label = lockfile_label,
        inject_workspace_root_env = True,
        global_inputs_into = "srcs",
        global_inputs_stamp = True,
        wiring = "nix_calling_genrule",
    )
    kw = wiring.kwargs
    kw["out"] = name + ".stamp"
    kw["cmd"] = "echo importer=%s > $OUT" % wiring.importer  # example only
    genrule(**kw)
```

Importer-local patch invalidation (package boundary):

Importer-local patch attachment uses `native.glob(...)`, which cannot reach across Buck package boundaries. For any importer-scoped ecosystem that relies on importer-local patches (Node, Python), **targets that include importer-local patches must be defined in the importer’s Buck package** (or in repo root for importer `"."`). Subpackage call sites must fail fast so patch edits never silently stop invalidating targets.

## Path invariants (must-follow)

- Patches live under `patches/<lang>/` (flat directory).
- Nix templates live under `build-tools/tools/nix/templates/<lang>.nix` and are imported by `build-tools/tools/nix/lang-templates.nix`.
- Language macros live under `<lang>/defs.bzl` and load provider mappings via the stable `//lang:auto_map.bzl` re-export.
- Provider rules live under `//third_party/providers/**` and are generated, not hand-edited.

## Step-by-step

1. Nix template

- Create `build-tools/tools/nix/templates/<lang>.nix` implementing two functions analogous to Go’s `goApp`/`goLib` (names are up to you):
  - Inputs: `name`, lockfile path (or equivalent), `patchDir`, and optional `devOverrideEnv`.
  - Apply patches deterministically by scanning `patchDir` at evaluation time.
  - Honor `NIX_*_DEV_OVERRIDE_JSON` if you support dev overrides; warn locally and fail in CI.

2. Register in planner

- In the planner’s registry (see `graph-generator.nix`/`LANGS`), add:
  - `isTarget(n) -> bool` to detect language targets (via `rule_type` or `labels`)
  - `kindOf(n) -> "bin"|"lib"|null`
  - `modulesFileFor(name) -> path` to locate your lockfile
  - `mkApp(name)`, `mkLib(name)` that call your Nix template via `build-tools/tools/nix/lang-templates.nix`.

3. Exporter labels

- Ensure the exporter marks your targets with deterministic labels that identify invalidation inputs. Examples:
  - Per-module style: `module:<import>@<version>`
  - Lockfile style: `lockfile:<path>#<importer>`
- Keep label strings stable; `gen-auto-map.ts` will map these to provider names.

4. Provider sync (optional/when patches exist)

- Add a provider sync driver under `build-tools/tools/buck/providers/<lang>.ts` which:
  - Scans `patches/<lang>/*.patch` (flat), validates shapes, and writes `third_party/providers/TARGETS.<lang>.auto` deterministically
  - Uses helpers from `build-tools/tools/lib/providers.ts` for naming (stable, hashed suffix)
  - Enforces one-patch-per-key and no subdirectories (warn in non-strict, fail in strict)
- Wire the driver into the unified orchestrator `build-tools/tools/buck/sync-providers.ts` so users run:
  - Providers only: `node build-tools/tools/buck/sync-providers.ts --lang <lang> --no-glue`
  - Full glue (when appropriate): `node build-tools/tools/buck/sync-providers.ts --lang <lang>`

5. Auto-map integration

- Extend `build-tools/tools/buck/gen-auto-map.ts` (if needed) to translate your labels to provider names using `build-tools/tools/lib/providers.ts` helpers.
- Ensure per-target providers are sorted and deduplicated.

6. Macros

- Add `<lang>/defs.bzl` using `lang/defs_common.bzl` helpers to:
  - Stamp labels (`lang:<id>`, `kind:<bin|lib|test>`) on primary targets
  - Auto-wire tests per your language conventions
  - Append providers from `MODULE_PROVIDERS` loaded via `//lang:auto_map.bzl` (do not load `//third_party/providers:auto_map.bzl` directly)

Stamping belongs in the macro. If your macro synthesizes helper targets (for example `*_test`), keep stamping in the macro implementation rather than repeating `labels = ["lang:<id>", "kind:<kind>"]` at call sites.

7. Scaffolding

- Add templates under `build-tools/tools/scaffolding/templates/<lang>`.
- Register the language in `build-tools/tools/lib/langs.ts` (id, display name, requiredPaths, kinds, templatesDir).
- `scaf` will discover your language automatically and expose `scaf new <lang> <kind>`.

8. Tests

- Use `build-tools/tools/tests/lib/lang-fixtures.ts` to scaffold a minimal repo, generate glue, and build/test.
- Add targeted zx tests that prove:
  - Provider sync determinism and duplicate detection
  - Auto-map wiring correctness for your labels
  - Macros stamp labels and auto-wire tests correctly
  - Importer-scoped macros do not bypass shared wiring helpers (enforcement tests should fail if a macro directly parses lockfile labels instead of routing through `//lang:importer_wiring.bzl`)

## CI and glue

- Glue (export-graph → sync providers → gen auto_map) is generated by zx scripts and not committed.
- `build-tools/tools/dev/install/glue.ts` detects enabled languages from file presence or `build-tools/tools/nix/langs.json` and runs only relevant steps (partial clone friendly).

## Sparse checkout expectations

- If your language’s `requiredPaths` are missing, the repo remains fully usable for other languages. Scaffolding and glue skip missing languages gracefully.

## Example references

- Go implementation in this repo:
  - `build-tools/tools/nix/templates/go.nix`
  - `go/defs.bzl`, `go/private/auto_tests.bzl`, and `lang/defs_common.bzl`
  - `build-tools/tools/buck/providers/go.ts` and `build-tools/tools/buck/providers/index.ts`
  - Node provider generator: `build-tools/tools/buck/providers/node.ts` (invoked by `build-tools/tools/buck/sync-providers.ts`)
  - `build-tools/tools/buck/gen-auto-map.ts`
  - `build-tools/tools/lib/langs.ts` and `build-tools/tools/scaffolding/registry.ts`
  - `build-tools/tools/tests/**` (scaffolding, provider sync, auto_map, planner, exporter)
