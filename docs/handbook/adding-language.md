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
  - Do not hardcode reserved synthetic key prefixes. Import `PATCH_INPUTS_KEY_PREFIX`, `PROVIDER_EDGES_KEY_PREFIX`, `GLOBAL_NIX_INPUTS_KEY_PREFIX` from `//build-tools/lang:defs_common.bzl`.
  - Guardrails:
    - `build-tools/tools/tests/lang/dict-inputs.synthetic-prefixes.no-literals.enforcement.test.ts`

## What you’ll implement

- Templates: `build-tools/tools/nix/templates/<lang>.nix` consumed by `build-tools/tools/nix/lang-templates.nix`
- Planner registry entry: `LANGS.<lang>` inside the planner (dispatch predicates + mkApp/mkLib)
- Macros: thin Starlark wrappers using `build-tools/lang/defs_common.bzl` helpers
- Provider sync (optional): implement your generator under `build-tools/tools/buck/providers/<lang>.ts` (scans `patches/<lang>` and writes `.viberoots/workspace/providers/TARGETS.<lang>.auto` deterministically). Provider sync is invoked through the unified orchestrator `build-tools/tools/buck/sync-providers.ts` (for example `node viberoots/build-tools/tools/buck/sync-providers.ts --lang <lang> --no-glue`).
- Scaffolding templates: `build-tools/tools/scaffolding/templates/<lang>/...` + language registry entry
- Tests: zx tests using `build-tools/tools/tests/lib/lang-fixtures.ts`

### Command ownership and tool authority

A language is not integrated until its metadata lifecycle follows the repository command model:

- `u` owns intentional repair. Add the language's conservative lockfile, provider, glue, and other
  deterministic tracked-metadata repair to the update orchestration. An upgrade policy belongs only
  behind `u --upgrade`. When the ecosystem can upgrade dependencies, the language integration must
  implement that upgrade path; do not classify it as reconciliation-only merely because upgrade
  support has not been wired yet. Reconciliation-only is valid only when the language has no
  upgradeable dependency authority, and must not move adjacent source or package authorities.
- `i`, `b`, post-clone, and devshell entry are read-only for tracked files. They may materialize
  ignored local state, but stale lockfiles or generated metadata must fail with `repair: run u` and
  leave the checkout unchanged. They must never invoke the language's reconciliation or dependency
  upgrade command.
- Register enablement, read-only validation, and the bounded or reconciliation-only upgrade policy
  with the shared project-language registry used by `runReadOnlyLanguageConsistencyChecks`. Do not
  add a language-specific commit-check or update-dispatch path.
- Add the language's handler to the exhaustive `ProjectLanguageId` update map. A new registry entry
  must fail type checking until both conservative `u` repair and `u --upgrade` behavior are defined.
- Run conservative repair and upgrade commands through the shared managed-command boundary with a
  documented timeout, awaited process-group shutdown, and byte-exact rollback for every tracked file
  the ecosystem tool can create, remove, or rewrite. A partial multi-project failure must not leave
  the failing project half-reconciled.
- New language work must keep `b` and `install-deps --glue-only` as consumers of checked-in inputs
  and materialized state, not add another tracked-metadata repair path. Run `u` before `b` when
  language metadata is stale.
- `v` owns validation. Add focused positive and negative tests to its target graph, including
  read-only/repair boundaries and deterministic regeneration.
- Invoke the production `u` launcher in a bounded local/offline consumer fixture. Prove both the
  language repair result and that the viberoots gitlink, flake pins, and source-mode metadata remain
  byte-for-byte unchanged. Exercise both plain `u` and `u --upgrade`; prove the exact ecosystem
  upgrade argv, observable dependency-authority movement, and rollback on failure for upgradeable
  languages. For a reconciliation-only language, prove both the reported result and that the
  ecosystem genuinely exposes no upgradeable dependency authority.
- Every executable toolchain used by startup checks, update/install orchestration, Buck toolchains,
  or runnable manifests must resolve from `/nix/store`. Route process execution through
  `build-tools/tools/lib/tool-paths.ts` or emit an explicit Nix-store path from Nix. Do not fall back
  to a host tool. Nix itself is the bootstrap exception and may use
  `/nix/var/nix/profiles/default/bin/nix`.

For a future Rust rollout, this means deciding up front whether Cargo metadata is importer-scoped or
package-local, making `u` the only tracked repair owner, keeping `i` read-only, and store-qualifying
`cargo`, `rustc`, and any runnable command. Its registry handler must define bounded Cargo upgrade
semantics and transactional `Cargo.lock` rollback before project templates are considered complete.

### Language contracts and manifest

- The project defines shared TypeScript interfaces in `build-tools/tools/lib/lang-contracts.ts`:
  - `ScaffoldingLanguage` describes discovery metadata for `build-tools/tools/lib/langs.ts`
  - `LanguageProviderSync` is the provider sync adapter surface used by `build-tools/tools/buck/sync-providers.ts`
  - `PlannerLanguage` is used by TS-side helpers that enumerate planner capabilities
- The language registry is manifest‑driven via `build-tools/tools/nix/langs.json`. Discovery is partial‑clone safe:
  - A language must be listed in `enabled`, have a graduated hermetic contract, and have every
    `requiredPaths` entry present before discovery considers it enabled.
  - Orchestrators dynamically derive their registries from this manifest; missing languages are skipped without errors
- When adding a new language, update `build-tools/tools/nix/langs.json` and ensure your `requiredPaths` gate enablement correctly.
- `scaf language new` writes a disabled entry with `hermetic.status = "scaffold"`. It never adds the
  language to `enabled`. Run `scaf language doctor` to see the remaining graduation gaps.
- Change the status to `graduated` and add the language to `enabled` only after the manifest records
  passing source-role, dependency-reconciliation, immutable-bundle, store-tool, selector,
  sandbox/network, remote-execution, and publication gates. `reproducibilityMatrixIds` must name the
  independent-builder cases that prove the language and its mixed-language routes.
- Manifest validation fails when an enabled language is absent, scaffold-only, missing a gate, or
  has no reproducibility matrix ID. Do not catch or downgrade these failures in scaffolding.

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

- Starlark (`build-tools/lang/defs_common.bzl`):

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
load("@workspace_providers//:auto_map.bzl", "MODULE_PROVIDERS")
load("@viberoots//build-tools/lang:defs_common.bzl", "prepare_language_wiring")

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
  - Macros: use `nix_python_{library,binary,test}` from `build-tools/python/defs.bzl` and pass `lockfile_label` explicitly.
    - Do not pass `lockfile:` labels through `labels`; importer identity is derived from `lockfile_label` and macros require exactly one lockfile label.
  - Macro wiring: importer-scoped wiring is centralized via:
    - Prefer `//build-tools/lang:defs_common.bzl:prepare_language_wiring(...)` with `wiring = "non_genrule_nix_calling"` for `nix_python_library`, `nix_python_binary`, `nix_python_test`, and `nix_python_wasm_*` (non-mutating with `global_nix_inputs()` wiring).
    - Keep `wiring = "srcsless_rule"` as a helper for rule shapes that truly cannot carry patch inputs through the normal prepared-kwargs path.
- Scaffolding:
  - `scaf new python lib <name>` → `projects/libs/<name>` with `pyproject.toml`, `uv.lock`, `TARGETS` using `nix_python_library` and a sample test via `nix_python_test`.
  - `scaf new python app <name>` → `projects/apps/<name>` with a small library and binary (`nix_python_binary`) and importer‑scoped `lockfile_label`.
- Glue:
  - Provider sync reads all `**/uv.lock` and writes `.viberoots/workspace/providers/TARGETS.python.auto` deterministically.
  - Python provider sync does **not** accept a global `patchDir` input; patch discovery is always importer-local under `<importer>/patches/python`.
  - `gen-auto-map.ts` already maps generic `lockfile:` labels to importer providers; no Python‑specific code required.
  - Reuse `build-tools/tools/lib/importers.ts` to compute the importer string and list importer‑local patches deterministically.

Tip for lockfile-style ecosystems (e.g., Node/PNPM):

Use the shared helpers from `build-tools/lang/defs_common.bzl` so call sites do not reassemble wiring details:

- Supported importer labels are a cross-language contract surface. The importer string must be:
  - defined by `build-tools/tools/lib/importer-roots.json` (single source of truth)
  - rendered to Starlark as `build-tools/lang/importer_roots.bzl`

If you need to change supported importer roots, update `build-tools/tools/lib/importer-roots.json` and run `u`. The parity/enforcement tests will fail if the generated Starlark view is stale. The lower-level `node viberoots/build-tools/tools/buck/glue-pipeline.ts` command is useful for focused development, but `i` must not repair the tracked view.

- `ensure_single_lockfile_label(kwargs, lockfile_label)` enforces exactly one importer-scoped label (`lockfile:<path>#<importer>`) with stable dedupe and canonical error text.
- `include_importer_patches_from_labels(kwargs, lang, into = "srcs")` derives the importer and includes importer-local patches deterministically into a supported input attribute (commonly `srcs` or `resources` depending on the rule shape).
- For importer-scoped, **Nix-calling genrule-style** macros, use:
- `prepare_language_wiring(...)` with `wiring = "nix_calling_genrule"`
  - It composes lockfile enforcement, label stamping, importer patch inputs, provider edge realization into `srcs`, optional `build-tools/tools/buck/workspace-root.env` injection for dict-shaped `srcs`, and global Nix inputs as real action inputs (optional stamp).
  - When you need dict-safe synthetic keys, do not hardcode any reserved prefixes. Import:
    - `PATCH_INPUTS_KEY_PREFIX`
    - `PROVIDER_EDGES_KEY_PREFIX`
    - `GLOBAL_NIX_INPUTS_KEY_PREFIX`
      from `//build-tools/lang:defs_common.bzl`.

Minimal example (dict-shaped `srcs`):

```python
load("@prelude//:rules.bzl", "genrule")
load("@viberoots//build-tools/lang:defs_common.bzl", "prepare_language_wiring")

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

- Patch scope is part of the language contract. Package-local ecosystems such as Go, C++, and Rust
  attach patches from the owning Buck package. Importer-scoped ecosystems such as Node and Python
  attach importer-local patches from `<importer>/patches/<lang>/`; languages may additionally opt
  into an effective-set-gated repo-root `patches/<lang>/` directory when the contract supports it.
- Nix templates live under `build-tools/tools/nix/templates/<lang>.nix` and are imported by `build-tools/tools/nix/lang-templates.nix`.
- Language macros live under `<lang>/defs.bzl` and load provider mappings via the workspace provider cell `@workspace_providers//:auto_map.bzl`.
- Provider rules live under the generated `workspace_providers` cell backed by `.viberoots/workspace/providers/` and are not hand-edited.

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
  - Scans `patches/<lang>/*.patch` (flat), validates shapes, and writes `.viberoots/workspace/providers/TARGETS.<lang>.auto` deterministically
  - Uses helpers from `build-tools/tools/lib/providers.ts` for naming (stable, hashed suffix)
  - Enforces one-patch-per-key and no subdirectories (warn in non-strict, fail in strict)
- Wire the driver into the unified orchestrator `build-tools/tools/buck/sync-providers.ts` so users run:
  - Providers only: `node viberoots/build-tools/tools/buck/sync-providers.ts --lang <lang> --no-glue`
  - Full glue (when appropriate): `node viberoots/build-tools/tools/buck/sync-providers.ts --lang <lang>`

5. Auto-map integration

- Extend `build-tools/tools/buck/gen-auto-map.ts` (if needed) to translate your labels to provider names using `build-tools/tools/lib/providers.ts` helpers.
- Ensure per-target providers are sorted and deduplicated.

6. Macros

- Add `<lang>/defs.bzl` using `build-tools/lang/defs_common.bzl` helpers to:
  - Stamp labels (`lang:<id>`, `kind:<bin|lib|test>`) on primary targets
  - Auto-wire tests per your language conventions
  - Append providers from `MODULE_PROVIDERS` loaded via `@workspace_providers//:auto_map.bzl` (do not load `//:auto_map.bzl` directly)

Stamping belongs in the macro. If your macro synthesizes helper targets (for example `*_test`), keep stamping in the macro implementation rather than repeating `labels = ["lang:<id>", "kind:<kind>"]` at call sites.

7. Scaffolding

- Add templates under `build-tools/tools/scaffolding/templates/<lang>`.
- Scaffold and review its `build-tools/tools/nix/langs.json` entry. Keep it disabled until the
  hermetic graduation contract and matrix evidence are complete.
- `scaf` will discover your language automatically and expose `scaf new <lang> <kind>`.

8. Tests

- Use `build-tools/tools/tests/lib/lang-fixtures.ts` to scaffold a minimal repo, generate glue, and build/test.
- Add targeted zx tests that prove:
  - Provider sync determinism and duplicate detection
  - Auto-map wiring correctness for your labels
  - Macros stamp labels and auto-wire tests correctly
  - Importer-scoped macros do not bypass shared wiring helpers (enforcement tests should fail if a macro directly parses lockfile labels instead of routing through `//build-tools/lang:importer_wiring.bzl`)
  - `u` repairs stale tracked language metadata while `i` and post-clone fail without changing it
  - Startup checks reject host-only toolchains and prefer the real Nix-store tool when a hostile host
    executable appears earlier on `PATH`
  - Buck toolchain paths and prod runnable manifests contain rooted `/nix/store` executables; include
    a negative manifest test for an absolute host or fake nested-store path
  - A temp consumer can run the language's minimal manifest/provider/toolchain path without reading
    undeclared files from the source checkout
  - Separate checkouts on independent same-system builders match derivation, output, and NAR
    identities for every named reproducibility matrix case, including forced rebuild and warm runs

## CI and glue

- Glue follows the ownership declared for each output: `u` refreshes deterministic tracked outputs;
  `i` may materialize ignored local outputs but must fail on tracked drift.
- Enabled languages are detected from file presence or `build-tools/tools/nix/langs.json`, keeping
  update, validation, and partial-clone behavior capability-gated.

## Validation guardrails

- Start with the smallest direct tests for the new registry, metadata repair/read-only boundary,
  provider/glue generation, Buck toolchain, and runnable manifest. Include a temp-repo test when
  source isolation or post-clone behavior is part of the contract.
- Measure elapsed time and disk before and after focused runs using the named-path inventory in
  `docs/handbook/getting-started-on-a-pr.md`. Do not broaden source snapshots or copy shared caches to
  make a fixture pass.
- Run `i && b && v` only after focused tests and scope review are green. Use
  `i && b && ALL_TESTS=1 v` at the plan's full-validation checkpoint, not after every small edit.

## Sparse checkout expectations

- If your language’s `requiredPaths` are missing, the repo remains fully usable for other languages. Scaffolding and glue skip missing languages gracefully.

## Example references

- Go implementation in this repo:
  - `build-tools/tools/nix/templates/go.nix`
  - `build-tools/go/defs.bzl`, `build-tools/go/private/auto_tests.bzl`, and `build-tools/lang/defs_common.bzl`
  - `build-tools/tools/buck/providers/go.ts` and `build-tools/tools/buck/providers/index.ts`
  - Node provider generator: `build-tools/tools/buck/providers/node.ts` (invoked by `build-tools/tools/buck/sync-providers.ts`)
  - `build-tools/tools/buck/gen-auto-map.ts`
  - `build-tools/tools/lib/langs.ts` and `build-tools/tools/scaffolding/registry.ts`
  - `build-tools/tools/tests/**` (scaffolding, provider sync, auto_map, planner, exporter)
