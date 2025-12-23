### Provider sync cookbook

Provider sync writes deterministic Buck provider glue from lockfiles and patch inputs. For importer-scoped ecosystems (Node and Python), patch discovery is importer-local (`<importer>/patches/<lang>`); some ecosystems may also have optional global patch directories (for example `patches/node` for Node global patches).

- **Patch filenames**: `<module path with / → __>@<version>.patch` (dots are preserved).
  - Decoding policy (parity): `__` decodes to `/` only (lossless). Examples:
    - `@scope__pkg@1.2.3.patch` → `@scope/pkg@1.2.3`
    - `lodash___core@4.17.21.patch` → `lodash/_core@4.17.21`
- **Unified sync command (orchestrator)**: `node tools/buck/sync-providers.ts` writes all language-specific provider files deterministically:
  - Go: `third_party/providers/TARGETS.auto`
  - Node (PNPM): `third_party/providers/TARGETS.node.auto` (when lockfiles present)
  - Mapping file: `third_party/providers/nix_attr_map.bzl` (canonical nixpkgs attr map)
- C++: provider sync is a **no-op** by design (see `docs/handbook/cpp-pr2-migration.md`).
- **Idempotency**: re-running should not change output when inputs are unchanged.
- **Tests**: create a single patch using fixtures and assert stable provider name and paths.

Node generator (canonical):

- The canonical generator implementation is `tools/buck/providers/node.ts` (`syncNodeProviders`). The canonical entrypoint is the orchestrator: `node tools/buck/sync-providers.ts`.
  - For Node only (full glue): `node tools/buck/sync-providers.ts --lang node`
  - Providers only (no graph/auto_map): `node tools/buck/sync-providers.ts --lang node --no-glue`

Node‑specific note (clarity):

- The Node provider rule accepts `patch_paths` for diagnostics and visibility only. These paths are not used as Buck `srcs` to avoid cross‑package references from `third_party/providers/`. Invalidation for Node patches is achieved by macros adding importer‑local patch files to target `srcs` (see Patching Handbook).

Importer‑scoped patch inclusion policy (Node vs Python):

- **Node (PNPM)**: provider `patch_paths` includes **all importer-local patches** under `<importer>/patches/node/*.patch` (even when not present in the lockfile effective set). This keeps invalidation simple: any importer-local patch change affects that importer’s provider.
- **Python (uv)**: provider `patch_paths` includes **only importer-local patches that match the `uv.lock` effective set**. This keeps invalidation precise: adding a patch for a package not present in `uv.lock` does not affect the provider or downstream targets.
- The canonical switch is `importerPatchInclusionPolicy: "all" | "effective-set-only"` in `tools/lib/provider-sync-driver.ts`. The policy is required at the driver boundary, and a dedicated regression test locks down the behavior.

Canonical naming and helpers:

- **Source of truth (TS helpers)**: `tools/lib/providers.ts` defines provider naming. Use `providerNameForModuleKey(importPath, version)` for Go module providers and `providerNameForImporter(lockfilePath, importer)` for Node importer‑scoped providers.
- **Go nixpkgs providers (CGO)**: Go macros do not inject direct provider deps for `nixpkg_deps`. Instead, they attach `nixpkg:<attr>` labels and rely on `MODULE_PROVIDERS` loaded via `//lang:auto_map.bzl` (re-export of `third_party/providers/auto_map.bzl`) to map targets to providers (format: `//third_party/providers:nix_<normalized_attr>`; example: `pkgs.openssl` → `nix_pkgs_openssl`). Do not handcraft names.
- **Stamp‑time normalization (Go)**: Go macros stamp `nixpkg:` labels using the shared helper at stamp‑time (via `append_nixpkg_labels`). This only changes where normalization occurs; behavior and mappings are unchanged because the mapper already normalizes.
- **nixpkgs attr map**: The unified orchestrator generates `third_party/providers/nix_attr_map.bzl` deterministically; Starlark macros should load from this mapping instead of deriving attrs heuristically.
- **Patch fixtures**: `tools/tests/lib/fixtures/go.ts: ensurePatch()` creates a correctly named patch file for tests.
- **Starlark nixpkgs stamping (canonical)**: use `lang/defs_common.bzl: append_nixpkg_labels(kwargs, attrs)` to append `nixpkg:<normalized>` labels. Normalization trims, lowercases, ensures the `pkgs.` prefix, and maps `pkgs.gtest` → `pkgs.googletest`. Do not re‑implement label loops in language macros.

#### `nixpkg:` normalization contract (single source of truth)

`nixpkg:` is a cross-language public interface. Normalization must match across:

- Starlark: `lang/nixpkg_labels.bzl:normalize_nix_attr`
- TypeScript: `tools/lib/provider-names.ts:normalizeNixAttr`
- Nix templates: `tools/nix/lib/lang-helpers.nix:normalizeNixAttr`

Contract:

- Input is trimmed and lowercased.
- `pkgs.` prefix is added if missing.
- Alias mapping is applied (source of truth: `tools/lib/nix-attr-aliases.json`; Starlark mirror: `lang/nix_attr_aliases.bzl`).
- Historical compatibility: `gtest` normalizes to `pkgs.googletest`.

Regression guard:

- `tools/tests/normalization-parity.test.ts` compares Starlark, TS, and Nix on a shared test matrix.

#### C++ provider edges (optional, graph‑shape uniformity)

- C++ macros (`nix_cpp_library`, `nix_cpp_binary`) may realize provider edges for diagnostics and cquery introspection by merging `providers_for(MODULE_PROVIDERS, name)` into their `deps`.
- This aligns the exported graph’s shape with Go/Node without changing build artifacts or invalidation semantics.
- How to read it in `buck2 cquery`:
  - `deps(//pkg:target)` will include provider nodes like `//third_party/providers:nix_pkgs_openssl` when the target carries matching `nixpkg:<attr>` labels.
  - These edges are graph‑only; rule keys are unchanged unless provider files themselves change.

#### Planner-visible stubs (exclude provider deps)

Some macros create planner-visible stub targets for exporter and planner discovery. These stubs are not meant to build, and in some cases they must not depend on provider targets (visibility and graph-shape constraints).

- **Canonical stub rule**: `//lang:planner_stub.bzl:planner_stub` is the only supported mechanism for planner-visible stubs. Do not introduce language-specific stub rules or ad-hoc `genrule` stubs.
- **Canonical macro helper (preferred)**: `//lang:defs_common.bzl:wire_planner_visible_stub(...)` standardizes the safe defaults:
  - strip provider targets from planner-visible `deps` (opt-in)
  - realize provider edges into `deps` or `srcs` (opt-in, for rule shapes that require it)
  - attach package-local patch inputs via `planner_stub_with_package_local_patches(...)` (opt-in, when `lang` is provided)
- **When to include `srcs`**: include `srcs` only when the planner must observe package-local files for discovery or invalidation (for example, a planner-only node that represents a package directory or needs patch file inputs). Prefer `deps` for graph edges; use `srcs` for file-like inputs and the few cases where edges must be realized via `srcs`.
- **Rule of thumb**: when a macro emits a planner-visible stub, pass planner-visible deps through the shared helper `strip_provider_targets(...)` from `//lang:provider_edges.bzl`.
- **Canonical helper**: `strip_provider_targets(deps, provider_prefix = "//third_party/providers:")` preserves order, removes only provider targets, and does not try to interpret non-string entries.

### Shared Nix helpers (lang-helpers)

For Nix templates that need to apply patches or support dev overrides, import the shared helpers from the canonical location:

```nix
# tools/nix/templates/<lang>.nix
{ pkgs }:
let
  lib = pkgs.lib;
  Common = import ../lib/lang-helpers.nix { inherit pkgs; };
in {
  buildFn = args:
    let
      patchesMap = Common.patchesMapFromDir args.patchDir;
      devOverrides = Common.readDevOverrides (args.devOverrideEnv or "");
      _ = Common.guardNoDevOverridesInCI (args.devOverrideEnv or "");
    in pkgs.stdenv.mkDerivation { /* … use patchesMap/devOverrides … */ };
}
```

- `patchesMapFromDir`: builds `{ "module@version" = [ /abs/patch1 … ] }` from `patches/<lang>/*.patch` (flat dir).
- `readDevOverrides ENV`: parses JSON from `ENV` (empty → `{}`); traces a warning locally when non-empty.
- `guardNoDevOverridesInCI ENV`: throws in CI when overrides are present.

These helpers keep behavior consistent across languages and reduce boilerplate in each template.

### Deterministic IO and stamps for provider sync

Leverage the shared utilities in `tools/lib/fs-helpers.ts` to keep outputs stable:

- `writeIfChanged(path, content)` writes only when content differs (prevents churn).
- `writeStamp(file, inputs)` writes a deterministic stamp capturing ordered inputs and their contents.
- `stableUnique(items, keyFn)` deduplicates while preserving first-appearance order.

Example usage in a generator:

```ts
import { writeIfChanged, writeStamp, stableUnique } from "../lib/fs-helpers";

// … compute entries: string[] deterministically …
await writeIfChanged("third_party/providers/TARGETS.auto", header + entries.join("\n") + "\n");

await writeStamp("third_party/providers/TARGETS.auto.stamp", [
  { path: "patches/go/example@v1.2.3.patch" },
  { path: "third_party/providers/TARGETS.auto", content: header },
]);
```
