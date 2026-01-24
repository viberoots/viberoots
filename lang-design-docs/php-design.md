## PHP as a First-class Language: Design Proposal

Audience: Engineers and LLM agents implementing PHP support in this repo.
Scope: Introduce PHP (Composer-based) with hermetic, reproducible builds, Buck2-driven invalidation, Nix templates, provider wiring, and `patch-pkg` integration—aligned with existing Go/Node patterns and the Project Documentation Methodology.

### Alignment with Methodology

- Architectural Minimalism: Small, composable pieces; reuse shared helpers, avoid bespoke tooling.
- Deterministic Operations: Lockfile-driven; Nix applies patches and fixed sources; CI forbids dev overrides.
- Code Quality Standards: Glue scripts in TypeScript (zx wrapper), tiny macros, clear naming; keep files small and well-factored.
- Feature Control: Only the minimal surface required to build, patch, and test PHP targets.

### High-level Goals

- Buck2 remains the source of truth for graph/invalidation; PHP targets carry stable labels that map to providers.
- Nix consumes Composer inputs (composer.json/lock) and applies patches deterministically.
- Patches live in a flat `patches/php/` directory keyed by `vendor__name@version.patch` (slash → `__`).
- `patch-pkg` supports PHP with dev overrides (`NIX_PHP_DEV_OVERRIDE_JSON`) and canonical patch authoring.
- Provider wiring ensures only targets that actually consume a patched package rebuild.

### Linking expectations

I follow the repo-wide linking model described in `cpp-linking.md`, `wasm-linking.md`, and `linking-roadmap.md`. If this language does not introduce native or cross-language linking, `deps` remains a graph edge list and no link intent is inferred.

- `deps` is the Buck graph edge list. It does not imply link intent.
- `link_deps` declares linkable inputs. `header_deps` is include-only when that concept applies.
- Macros compute `deps := deps ∪ link_deps ∪ header_deps` deterministically and validate `link_closure_overrides` keys.
- `link_closure` defaults to `"direct"`. `"transitive"` follows `link_deps` only via `tools/nix/planner/link-closure.nix`.
- Ordering is deterministic and unsupported deps fail fast with targeted errors.

### Path Invariants

- Patches: `patches/php/*.patch` (flat; one patch per `package@version`).
- Nix templates: `tools/nix/templates/php.nix` imported by `tools/nix/lang-templates.nix`.
- Macros: `php/defs.bzl` using `lang/defs_common.bzl` helpers and `third_party/providers:auto_map.bzl`.
- Providers: generated files under `third_party/providers/` (e.g., `TARGETS.php.auto`).
- Glue scripts: zx TypeScript under `tools/buck/**`, `tools/patch/**`.

### End-to-End Architecture (conceptual)

```mermaid
graph LR
  subgraph Dev
    A["buck2 build //target"] -->|configured graph| B(Buck2)
  end

  B -->|export JSON| C[export-graph.ts]
  C -->|graph.json| D[graph-generator.nix]
  D -->|dynamic derivations| E[Nix]
  E -->|hermetic build| F[PHP app/lib artifacts]

  subgraph Patching
    G[patch-pkg] --> H[patch-php.ts]
    H --> I[patches/php/vendor__name@ver.patch]
    H --> J[NIX_PHP_DEV_OVERRIDE_JSON]
    I --> D
    J --> D
  end

  F --> K[Tests via Buck2]
  B --> K
```

### Labels & Provider Strategy

- Label form for PHP targets mirrors importer-scoped Node labels to reuse auto-map and provider naming:
  - `lockfile:<relative/path/to/composer.lock>#<importer>`
  - `<importer>` is the project root containing the `composer.json` (e.g., `apps/php-api`).
- Rationale: Composer lockfiles are per-project; importer ID gives stability if multiple PHP projects exist.
- `tools/buck/gen-auto-map.ts` already maps `lockfile:` labels to provider names via `providerNameForImporter()`; no changes needed.

### Nix Templates (PHP)

Add `tools/nix/templates/php.nix` exposing two functions analogous to Go templates:

- `phpApp { name, composerLock, projectDir ./. , devOverrideEnv ? "NIX_PHP_DEV_OVERRIDE_JSON", patchDir ? ../../patches/php }`
- `phpLib { name, composerLock, projectDir ./. , devOverrideEnv ? "NIX_PHP_DEV_OVERRIDE_JSON", patchDir ? ../../patches/php }`

Responsibilities:

- Read `patchDir` at evaluation time to build `{ "package@version" = [ /abs/path.patch ... ] }`.
- Read `devOverrideEnv` JSON to map `package@version -> /abs/local/source` for dev iteration.
- In CI (`CI=true`), throw if overrides are present.
- Use a Composer builder (composer2nix or `php.buildComposerProject`) to assemble vendor with:
  - Patch injection: apply patches when fetching packages that match the key.
  - Source override: use local path for a specific package when dev overrides are set.

Sketch (illustrative, mirroring Go):

```nix
{ pkgs }:
let
  lib = pkgs.lib;
  patchesMapFromDir = patchDir: let
    names = if builtins.pathExists patchDir then builtins.attrNames (builtins.readDir patchDir) else [];
    isPatch = name: lib.hasSuffix ".patch" name;
    toKey = name: let base = lib.removeSuffix ".patch" name; parts = lib.splitString "@" base; pkg = lib.concatStringsSep "@" (lib.take (lib.length parts - 1) parts); ver = lib.last parts; importName = lib.replaceStrings ["__"] ["/"] pkg; in lib.toLower "${importName}@${ver}";
    step = acc: name: let key = toKey name; val = (acc.${key} or []) ++ [ "${patchDir}/${name}" ]; in acc // { "${key}" = val; };
  in builtins.foldl' step {} (lib.filter isPatch names);
in {
  phpApp = { name, composerLock, projectDir ? ".", devOverrideEnv ? "NIX_PHP_DEV_OVERRIDE_JSON", patchDir ? ../../patches/php }:
    let patchesMap   = patchesMapFromDir patchDir;
        devOverrides = let v = builtins.getEnv devOverrideEnv; in if v == "" then {} else builtins.fromJSON v;
        _ = if (builtins.getEnv "CI") == "true" && (builtins.getEnv devOverrideEnv) != "" then builtins.throw "Dev overrides are forbidden in CI" else null;
    in pkgs.php.buildComposerProject {
      pname = "php-${name}"; version = "0.1.0"; src = ./.; composerLock = composerLock; projectRoot = projectDir;
      overrides = pkg: old: old // {
        patches = (old.patches or []) ++ (patchesMap.${pkg} or []);
        src     = devOverrides.${pkg} or old.src;
      };
    };

  phpLib = { name, composerLock, projectDir ? ".", devOverrideEnv ? "NIX_PHP_DEV_OVERRIDE_JSON", patchDir ? ../../patches/php }:
    let patchesMap   = patchesMapFromDir patchDir;
        devOverrides = let v = builtins.getEnv devOverrideEnv; in if v == "" then {} else builtins.fromJSON v;
        _ = if (builtins.getEnv "CI") == "true" && (builtins.getEnv devOverrideEnv) != "" then builtins.throw "Dev overrides are forbidden in CI" else null;
    in pkgs.php.buildComposerProject {
      pname = "phplib-${name}"; version = "0.1.0"; src = ./.; composerLock = composerLock; projectRoot = projectDir;
      overrides = pkg: old: old // {
        patches = (old.patches or []) ++ (patchesMap.${pkg} or []);
        src     = devOverrides.${pkg} or old.src;
      };
    };
}
```

Notes:

- Exact builder calls may use `composer2nix` outputs; details validated during implementation.
- Keep templates small; push shared helpers to `tools/nix/planner/lib.nix` if needed.

### Planner Integration (graph-generator.nix)

- Dispatch: Either via `tools/nix/mapping.nix` or simple prefix detection (`php_` rule types) or `labels` including `lang:php`.
- Provide `phpTargets` analogous to `goTargets`, constructing derivations using `lang-templates.nix` → `phpApp`/`phpLib` with inputs:
  - `composerLock` path (relative to repo root)
  - `projectDir` path (root of the PHP project)
- Add to `all` aggregation so individual PHP derivations are reachable.

### Provider Sync (PHP)

Implement `tools/buck/sync-providers-php.ts`:

- Scan `**/composer.lock` (project roots) and `patches/php/*.patch`.
- Build effective set for each importer (project):
  - Parse `composer.lock` (`packages` + `packages-dev`).
  - Effective set = all `name@version` pairs reachable (Composer lock already flattened).
- Include only patch files whose `package@version` is in the importer’s effective set.
- Emit `third_party/providers/TARGETS.php.auto` deterministically with entries like:

```python
load("//third_party/providers:defs_php.bzl", "php_importer_deps")

php_importer_deps(
    name = "lf_<hash>_<suffix>",
    lockfile = "apps/php-api/composer.lock",
    importer = "apps/php-api",
    patch_paths = ["patches/php/vendor__name@1.2.3.patch", ...],
)
```

- Duplicate guards:
  - One patch per `package@version`; error on duplicates.
  - No subdirectories under `patches/php`; warn (local) / enforce in CI.
- Idempotency: writing twice with same inputs is a no-op.

Defs: `third_party/providers/defs_php.bzl` mirrors Node/Go stamp pattern:

```python
def php_importer_deps(name, lockfile, importer, patch_paths = []):
    genrule(
        name = name,
        srcs = [lockfile] + patch_paths,
        out = name + ".stamp",
        cmd = "if command -v sha256sum >/dev/null; then cat $SRCS | sha256sum > $OUT; else cat $SRCS | shasum -a 256 > $OUT; fi",
        visibility = ["//visibility:public"],
    )
```

### Auto-map Integration

No changes required. Existing `tools/buck/gen-auto-map.ts` maps `lockfile:<path>#<importer>` labels to providers using `providerNameForImporter()` from `tools/lib/providers.ts`.

### Macros (`php/defs.bzl`)

Provide thin wrappers aligned with `lang/defs_common.bzl`:

- `nix_php_library(name, deps = [], labels = [...], ...)`
- `nix_php_binary(name, deps = [], labels = [...], ...)` (if you package CLI scripts)
- `nix_php_test(name, deps = [], labels = [...], ...)` (to wrap phpunit/integration commands)

Behavior:

- Stamp `lang:php` and `kind:<lib|bin|test>` labels.
- Require/derive one lockfile label `lockfile:<path>#<importer>`.
- Append providers from `//third_party/providers:auto_map.bzl` by key `"//pkg:name"`.

Example TARGETS entries:

```python
load("//php:defs.bzl", "nix_php_library", "nix_php_test")

nix_php_library(
  name = "app_lib",
  srcs = glob(["src/**/*.php"]),
  labels = [
    "lang:php",
    "kind:lib",
    "lockfile:apps/php-api/composer.lock#apps/php-api",
  ],
)

nix_php_test(
  name = "unit",
  srcs = glob(["tests/**.php"]),
  deps = [":app_lib"],
  labels = [
    "lang:php",
    "kind:test",
    "lockfile:apps/php-api/composer.lock#apps/php-api",
  ],
)
```

### Patching Workflow (`patch-pkg php`)

Extend the outer CLI with `patch-php.ts` implementing the common interface:

- `start <package>`: Creates a temp workspace over the resolved source for `<vendor/name>` at the version from `composer.lock` of the importer (prompt or `--lockfile --importer` flags). On macOS, use APFS CoW (`cp -cR`) when possible.
- `apply <package>`: Produces a unified patch file at `patches/php/<vendor__name>@<version>.patch` and clears the dev override.
- `reset <package>`: Discards temp dir and clears override.
- `session <package>`: Interactive session; Ctrl-D applies; Ctrl-C resets.

Naming & dev overrides:

- Filename encoding: `/` → `__`; key is case-preserving `vendor/name@version` in lowercase for map keys.
- Environment variable: `NIX_PHP_DEV_OVERRIDE_JSON` mapping `"vendor/name@version" -> "/abs/tmp/workdir"`.
- CI guard: overrides forbidden; throw in template; print explicit warnings locally.

Source resolution for `start`:

- Read version from the selected `composer.lock`.
- Prefer `dist` URL in lock; fallback to `source` (VCS) URLs.
- Download and unpack to temp if needed; avoid relying on global Composer cache for determinism.

Post-apply glue (same turn):

- `node tools/buck/sync-providers-php.ts`
- `node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`

### Exporter Adapter (optional initial phase)

- Initial: rely on macros to stamp the `lockfile:` label.
- Later: add a PHP adapter so `export-graph.ts` can validate PHP targets (e.g., ensure `lang:php` present when `.php` sources exist) and optionally backfill `lockfile:` when obvious.

### CI Stages

- Reuse the existing sequence:
  1. Export Graph → 2) Sync Providers (Go/Node/PHP) → 3) Generate auto_map → 4) Pre-build guard → 5) Build & Test.
- Provider sync driver (`tools/buck/sync-providers.ts`) should delegate to a PHP driver; runs only if Composer projects or `patches/php/*.patch` exist.

### Tests (zx; one-test-per-file)

- Provider sync determinism: `tools/tests/providers/php.sync-determinism.test.ts`.
- Auto-map wiring: `tools/tests/auto-map/php.auto-map-wiring.test.ts` verifying that a target with `lockfile:` label gains the expected provider dep.
- E2E provider wiring: Adapt `tools/tests/e2e-provider-wiring.ts` calls for a PHP target with a known `vendor/name@version` patch.
- Prebuild guard behavior when Composer lockfiles exist but providers are missing.

### Phased Rollout

Phase A — Scaffolding & Guards

- Create `patches/php/` and `.gitkeep`.
- Add `third_party/providers/defs_php.bzl`.
- Add `tools/buck/sync-providers-php.ts` and register in the sync orchestrator.
- Verify idempotent generation of `TARGETS.php.auto` on an empty repo.

### WASM Targets (Exploratory)

Given repository WASM facilities, PHP can target WASM only via an interpreter compiled to WASM. If we pursue this:

- Add an optional `phpWasmApp` template that packages a minimal PHP runtime + app for WASI.
- Reuse providers/patch maps; no special provider semantics.
- Validate execution under `node:wasi` for simple scripts.

This is not part of the initial PHP scope.

Phase B — Templates & Macros

- Implement `tools/nix/templates/php.nix` with `phpApp`/`phpLib`.
- Land `php/defs.bzl` macros that stamp labels and append providers.
- Convert one small sample PHP target to macros (if a sample app exists) or add tests covering macro output only.

Phase C — Patching

- Implement `tools/patch/patch-php.ts` with start/apply/reset/session.
- Validate canonical filenames and duplicate guards.
- Ensure `apply` runs provider sync + auto-map.

Phase D — CI Wiring & Validation

- Extend CI stages to include PHP provider sync when Composer lockfiles are present.
- Add prebuild guard checks for Composer lockfiles.

Acceptance Criteria

- Provider sync emits stable `TARGETS.php.auto` and respects effective sets per importer.
- Auto-map includes PHP providers for targets labeled with the corresponding `lockfile:`.
- Patching a Composer package used only by one importer invalidates only that importer’s targets.
- CI fails if dev overrides are present or glue is stale/missing.

### Assumptions (to validate)

- Composer is the package manager; `composer.lock` exists per PHP project.
- We can use `composer2nix` or an equivalent stable builder in nixpkgs to realize vendor deterministically.
- Lockfile entries provide `dist` URLs (or `source` fallback) sufficient to fetch sources without network flakiness in CI (via Nix FODs).
- PHP runtime/tooling (php, composer, composer2nix) can be added to devShell/CI without conflicts.

### Risks & Mitigations

- Risk: Variability in Composer packages (dist vs VCS) complicates hermetic fetches.
  - Mitigation: Prefer dist with checksums; for VCS, pin to commit and materialize via fixed-output derivations.
- Risk: Large vendor graphs causing slow Nix builds on first run.
  - Mitigation: Cache FODs; separate store of tarballs; parallelize builds where possible.
- Risk: Dev overrides drift into CI and poison cache keys.
  - Mitigation: Template throws on overrides in CI; startup-check warns locally; prebuild guard validates.
- Risk: Duplicate or misnamed patches break determinism.
  - Mitigation: Sync script enforces one-patch-per-key and flat directory; sorted emission; strong errors on collisions.
- Risk: Auto-map mismatch if labels are missing.
  - Mitigation: Macros require `lockfile:` label; exporter adapter (later) validates presence.

### Areas of Concern

- Composer plugin interactions: avoid plugins that mutate behavior non-deterministically; prefer pure lockfile-driven installs.
- Mixed repositories: If a PHP project also uses Node tooling, ensure labels stay scoped (`lockfile:` pairs for each ecosystem) and providers are independent.
- Windows: Not a target; ensure macOS/Linux parity (APFS CoW vs cp -a); document unsupported platforms.

### Completion Criteria

- Templates/macros/providers/patching implemented and documented; PHP provider sync and auto-map wiring verified via zx tests.
- CI stages integrate PHP sync and guard; builds are reproducible; per-importer invalidation works.
- Developer docs updated: how to patch, where patches live, how labels/providers work.

- Invalidation model: macros include importer‑local patch files in `srcs` (e.g., `<importer>/patches/php/*.patch`) so Buck invalidation is precise; provider stamps remain metadata‑only.
- Auto‑map: existing mapping covers `lockfile:` labels. If a per‑package provider model is introduced later, extend `gen-auto-map.ts` accordingly.
