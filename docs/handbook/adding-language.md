# Adding a Language

This guide explains how to add a new language to the build without touching core planner/exporter logic. The architecture is plugin-style: each language contributes a small set of files and a registry entry. Sparse checkouts are supported — existence of your language files controls enablement.

> Note (Node/PNPM): The Node Nix template at `tools/nix/templates/node.nix` is a discoverability shim only. The authoritative Node planner logic lives in `tools/nix/planner/node.nix`, and Node builds flow through Buck macros plus importer‑scoped providers. Do not implement build logic in `templates/node.nix`; keep logic in the planner plugin and Starlark macros.

## What you’ll implement

- Templates: `tools/nix/templates/<lang>.nix` consumed by `tools/nix/lang-templates.nix`
- Planner registry entry: `LANGS.<lang>` inside the planner (dispatch predicates + mkApp/mkLib)
- Macros: thin Starlark wrappers using `lang/defs_common.bzl` helpers
- Provider sync (optional): implement your generator under `tools/buck/providers/<lang>.ts` (scans `patches/<lang>` and writes `TARGETS.<lang>.auto` deterministically). Optionally expose a thin wrapper `tools/buck/sync-providers-<lang>.ts` for back-compat; wrappers must be delegator-only and should invoke the orchestrator (`tools/buck/sync-providers.ts`) with `--lang <lang> --no-glue` rather than importing provider internals.
- Scaffolding templates: `tools/scaffolding/templates/<lang>/...` + language registry entry
- Tests: zx tests using `tools/tests/lib/lang-fixtures.ts`

### Language contracts and manifest

- The project defines shared TypeScript interfaces in `tools/lib/lang-contracts.ts`:
  - `ScaffoldingLanguage` describes discovery metadata for `tools/lib/langs.ts`
  - `LanguageProviderSync` is the provider sync adapter surface used by `tools/buck/sync-providers.ts`
  - `PlannerLanguage` is used by TS-side helpers that enumerate planner capabilities
- The language registry is manifest‑driven via `tools/nix/langs.json`. Discovery is partial‑clone safe:
  - Only languages whose `requiredPaths` exist are considered enabled
  - Orchestrators dynamically derive their registries from this manifest; missing languages are skipped without errors
- When adding a new language, update `tools/nix/langs.json` and ensure your `requiredPaths` gate enablement correctly.

### Shared helpers (use these instead of rolling your own)

- Nix (`tools/nix/lib/lang-helpers.nix`):
  - `patchesMapFromDir`, `patchesMapFromDirs` for path‑based scanning
  - `patchesMapFromDirToStore`, `patchesMapFromImporterDirToStore` for store‑materialized inputs (Python)
  - `readDevOverrides`, `guardNoDevOverridesInCI` for override parity (Go/C++/Python)
- TypeScript (`tools/lib/importers.ts`):
  - `findImporterLockfiles`, `computeImporterLabel`
  - `defaultImporterPatchDir`, `listImporterPatches`
  - Keeps importer‑local patch discovery and sorting consistent across Node and Python
  - `tools/lib/provider-writer.ts` — emits deterministic importer‑scoped provider TARGETS and synchronizes the curated auto‑managed section. Pass your computed `{ lockfile, importer, patchPaths }` entries plus the rule load/name.
    - Prefer the convenience wrapper `writeImporterProvidersByLang(...)`, which is table‑driven via a small registry. To add a new importer‑scoped ecosystem, extend that registry instead of adding per‑language conditionals.

- Starlark (`lang/defs_common.bzl`):

  When authoring a **package-local patching macro** (Go/C++ style), avoid re-assembling the “patch dirs + nixpkg deps + labels + providers” sequence by hand. Use the shared helper so defaults and tolerance rules don’t drift across languages.
  - `prepare_package_local_wiring(...)`
    - Pops `local_patch_dirs` with a language default (`default_package_patch_dirs(lang)`)
    - Pops `nixpkg_deps` and appends normalized `nixpkg:` labels (canonical normalizer)
    - Stamps `lang:*` and `kind:*` labels (or you can opt out when another stamper is used)
    - Includes package-local `*.patch` files as action inputs (via `srcs`)
    - Realizes provider edges deterministically (via `MODULE_PROVIDERS`)

  Minimal example:

```python
load("@prelude//:rules.bzl", "genrule")
load("//lang:auto_map.bzl", "MODULE_PROVIDERS")
load("//lang:defs_common.bzl", "prepare_package_local_wiring")

def my_pkg_local_rule(name, **kwargs):
    deps = kwargs.pop("deps", [])
    wiring = prepare_package_local_wiring(
        name = name,
        kwargs = kwargs,
        lang = "cpp",
        kind = "lib",
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        base_deps = deps,
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

### Python notes

- Path invariants:
  - Patches are importer-local: `<importer>/patches/python/` (flat, no subdirectories).
  - Lockfile labeling is importer‑scoped: `lockfile:<path>#<importer>`; standard file is `uv.lock`.
  - Macros: use `nix_python_{library,binary,test}` from `python/defs.bzl` and pass `lockfile_label` explicitly.
  - Macro wiring: importer-scoped wiring is centralized via:
    - `//lang:importer_wiring.bzl:prepare_importer_non_genrule_wiring(...)` for `nix_python_library`, `nix_python_test`, and `nix_python_wasm_*`.
    - `//lang:importer_wiring.bzl:prepare_importer_srcsless_rule_wiring(...)` for rule shapes that cannot accept `srcs` (example: prelude `python_binary`).
- Scaffolding:
  - `scaf new python lib <name>` → `libs/<name>` with `pyproject.toml`, `uv.lock`, `TARGETS` using `nix_python_library` and a sample test via `nix_python_test`.
  - `scaf new python app <name>` → `apps/<name>` with a small library and binary (`nix_python_binary`) and importer‑scoped `lockfile_label`.
- Glue:
  - Provider sync reads all `**/uv.lock` and writes `third_party/providers/TARGETS.python.auto` deterministically.
  - Python provider sync does **not** accept a global `patchDir` input; patch discovery is always importer-local under `<importer>/patches/python`.
  - `gen-auto-map.ts` already maps generic `lockfile:` labels to importer providers; no Python‑specific code required.
  - Reuse `tools/lib/importers.ts` to compute the importer string and list importer‑local patches deterministically.

Tip for lockfile-style ecosystems (e.g., Node/PNPM):

Use the shared helpers from `lang/defs_common.bzl` so call sites do not reassemble wiring details:

- `ensure_single_lockfile_label(kwargs, lockfile_label)` enforces exactly one importer-scoped label (`lockfile:<path>#<importer>`) with stable dedupe and canonical error text.
- `include_importer_patches_from_labels(kwargs, lang, into = "srcs")` derives the importer and includes importer-local patches deterministically into a supported input attribute (commonly `srcs` or `resources` depending on the rule shape).
- For importer-scoped, **Nix-calling genrule-style** macros, use:
  - `prepare_importer_nix_calling_genrule_wiring(...)`
    - It composes lockfile enforcement, label stamping, importer patch inputs, provider edge realization into `srcs`, optional `tools/buck/workspace-root.env` injection for dict-shaped `srcs`, and global Nix inputs as real action inputs (optional stamp).

Minimal example (dict-shaped `srcs`):

```python
load("@prelude//:rules.bzl", "genrule")
load("//lang:defs_common.bzl", "prepare_importer_nix_calling_genrule_wiring")

def my_importer_nix_genrule(name, lockfile_label = None):
    # Dict-shaped srcs: preserve caller mapping, and allow shared helper to attach
    # synthetic dict keys for patch inputs / provider edges / global inputs.
    srcs = {
        "package.json": "package.json",
    }
    wiring = prepare_importer_nix_calling_genrule_wiring(
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
- Nix templates live under `tools/nix/templates/<lang>.nix` and are imported by `tools/nix/lang-templates.nix`.
- Language macros live under `<lang>/defs.bzl` and load provider mappings via the stable `//lang:auto_map.bzl` re-export.
- Provider rules live under `//third_party/providers/**` and are generated, not hand-edited.

## Step-by-step

1. Nix template

- Create `tools/nix/templates/<lang>.nix` implementing two functions analogous to Go’s `goApp`/`goLib` (names are up to you):
  - Inputs: `name`, lockfile path (or equivalent), `patchDir`, and optional `devOverrideEnv`.
  - Apply patches deterministically by scanning `patchDir` at evaluation time.
  - Honor `NIX_*_DEV_OVERRIDE_JSON` if you support dev overrides; warn locally and fail in CI.

2. Register in planner

- In the planner’s registry (see `graph-generator.nix`/`LANGS`), add:
  - `isTarget(n) -> bool` to detect language targets (via `rule_type` or `labels`)
  - `kindOf(n) -> "bin"|"lib"|null`
  - `modulesFileFor(name) -> path` to locate your lockfile
  - `mkApp(name)`, `mkLib(name)` that call your Nix template via `tools/nix/lang-templates.nix`.

3. Exporter labels

- Ensure the exporter marks your targets with deterministic labels that identify invalidation inputs. Examples:
  - Per-module style: `module:<import>@<version>`
  - Lockfile style: `lockfile:<path>#<importer>`
- Keep label strings stable; `gen-auto-map.ts` will map these to provider names.

4. Provider sync (optional/when patches exist)

- Add a zx script `tools/buck/sync-providers-<lang>.ts` which:
  - Scans `patches/<lang>/*.patch` (flat), validates shapes, and writes `third_party/providers/TARGETS.<lang>.auto` deterministically
  - Uses helpers from `tools/lib/providers.ts` for naming (stable, hashed suffix)
  - Enforces one-patch-per-key and no subdirectories (warn in non-strict, fail in strict)

5. Auto-map integration

- Extend `tools/buck/gen-auto-map.ts` (if needed) to translate your labels to provider names using `tools/lib/providers.ts` helpers.
- Ensure per-target providers are sorted and deduplicated.

6. Macros

- Add `<lang>/defs.bzl` using `lang/defs_common.bzl` helpers to:
  - Stamp labels (`lang:<id>`, `kind:<bin|lib|test>`) on primary targets
  - Auto-wire tests per your language conventions
  - Append providers from `MODULE_PROVIDERS` loaded via `//lang:auto_map.bzl` (do not load `//third_party/providers:auto_map.bzl` directly)

Stamping belongs in the macro. If your macro synthesizes helper targets (for example `*_test`), keep stamping in the macro implementation rather than repeating `labels = ["lang:<id>", "kind:<kind>"]` at call sites.

7. Scaffolding

- Add templates under `tools/scaffolding/templates/<lang>`.
- Register the language in `tools/lib/langs.ts` (id, display name, requiredPaths, kinds, templatesDir).
- `scaf` will discover your language automatically and expose `scaf new <lang> <kind>`.

8. Tests

- Use `tools/tests/lib/lang-fixtures.ts` to scaffold a minimal repo, generate glue, and build/test.
- Add targeted zx tests that prove:
  - Provider sync determinism and duplicate detection
  - Auto-map wiring correctness for your labels
  - Macros stamp labels and auto-wire tests correctly
  - Importer-scoped macros do not bypass shared wiring helpers (enforcement tests should fail if a macro directly parses lockfile labels instead of routing through `//lang:importer_wiring.bzl`)

## CI and glue

- Glue (export-graph → sync providers → gen auto_map) is generated by zx scripts and not committed.
- `tools/dev/install/glue.ts` detects enabled languages from file presence or `tools/nix/langs.json` and runs only relevant steps (partial clone friendly).

## Sparse checkout expectations

- If your language’s `requiredPaths` are missing, the repo remains fully usable for other languages. Scaffolding and glue skip missing languages gracefully.

## Example references

- Go implementation in this repo:
  - `tools/nix/templates/go.nix`
  - `go/defs.bzl` and `lang/defs_common.bzl`
  - `tools/buck/providers/go.ts` and `tools/buck/providers/index.ts`
  - Node provider generator: `tools/buck/providers/node.ts` (invoked by `tools/buck/sync-providers.ts`; wrapper `tools/buck/sync-providers-node.ts` exists for back-compat and delegates to the orchestrator)
  - `tools/buck/gen-auto-map.ts`
  - `tools/lib/langs.ts` and `tools/scaffolding/registry.ts`
  - `tools/tests/**` (scaffolding, provider sync, auto_map, planner, exporter)
