# Adding a Language

This guide explains how to add a new language to the build without touching core planner/exporter logic. The architecture is plugin-style: each language contributes a small set of files and a registry entry. Sparse checkouts are supported — existence of your language files controls enablement.

> Note (Node/PNPM): The Node Nix template at `tools/nix/templates/node.nix` is a discoverability shim only. The authoritative Node planner logic lives in `tools/nix/planner/node.nix`, and Node builds flow through Buck macros plus importer‑scoped providers. Do not implement build logic in `templates/node.nix`; keep logic in the planner plugin and Starlark macros.

## What you’ll implement

- Templates: `tools/nix/templates/<lang>.nix` consumed by `tools/nix/lang-templates.nix`
- Planner registry entry: `LANGS.<lang>` inside the planner (dispatch predicates + mkApp/mkLib)
- Macros: thin Starlark wrappers using `lang/defs_common.bzl` helpers
- Provider sync (optional): implement your generator under `tools/buck/providers/<lang>.ts` (scans `patches/<lang>` and writes `TARGETS.<lang>.auto` deterministically). Optionally expose a thin wrapper `tools/buck/sync-providers-<lang>.ts` that delegates to it (back‑compat/ergonomics).
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

### Python notes

- Path invariants:
  - Patches live under `patches/python/` (flat, no subdirectories).
  - Lockfile labeling is importer‑scoped: `lockfile:<path>#<importer>`; standard file is `uv.lock`.
  - Macros: use `nix_python_{library,binary,test}` from `python/defs.bzl` and pass `lockfile_label` explicitly.
- Scaffolding:
  - `scaf new python lib <name>` → `libs/<name>` with `pyproject.toml`, `uv.lock`, `TARGETS` using `nix_python_library` and a sample test via `nix_python_test`.
  - `scaf new python app <name>` → `apps/<name>` with a small library and binary (`nix_python_binary`) and importer‑scoped `lockfile_label`.
- Glue:
  - Provider sync reads all `**/uv.lock` and writes `third_party/providers/TARGETS.python.auto` deterministically.
  - `gen-auto-map.ts` already maps generic `lockfile:` labels to importer providers; no Python‑specific code required.
  - Reuse `tools/lib/importers.ts` to compute the importer string and list importer‑local patches deterministically.

Tip for lockfile-style ecosystems (e.g., Node/PNPM):

- Use the shared helpers from `lang/defs_common.bzl`:
  - `extract_lockfile_labels(labels)` to find lockfile labels on a rule
  - `ensure_single_lockfile_label(kwargs, lockfile_label)` to enforce exactly one importer-scoped label (`lockfile:<path>#<importer>`) with stable dedupe and canonical error text

## Path invariants (must-follow)

- Patches live under `patches/<lang>/` (flat directory).
- Nix templates live under `tools/nix/templates/<lang>.nix` and are imported by `tools/nix/lang-templates.nix`.
- Language macros live under `<lang>/defs.bzl` and use `//third_party/providers:auto_map.bzl`.
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
  - Append providers from `//third_party/providers:auto_map.bzl`

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
  - Node provider generator: `tools/buck/providers/node.ts` (invoked by `tools/buck/sync-providers.ts`; wrapper `tools/buck/sync-providers-node.ts` delegates)
  - `tools/buck/gen-auto-map.ts`
  - `tools/lib/langs.ts` and `tools/scaffolding/registry.ts`
  - `tools/tests/**` (scaffolding, provider sync, auto_map, planner, exporter)
