### Provider sync cookbook

Provider sync maps patch files under `patches/<lang>` to Buck providers used in builds. Keep it deterministic and idempotent.

- **Patch filenames**: `<module path with / → __>@<version>.patch` (dots are preserved).
- **Unified sync command (orchestrator)**: `node tools/buck/sync-providers.ts` writes all language-specific provider files deterministically:
  - Go: `third_party/providers/TARGETS.auto`
  - Node (PNPM): `third_party/providers/TARGETS.node.auto` (when lockfiles present)
  - Mapping file: `third_party/providers/nix_attr_map.bzl` (canonical nixpkgs attr map)
- **Idempotency**: re-running should not change output when inputs are unchanged.
- **Tests**: create a single patch using fixtures and assert stable provider name and paths.

Node generator (canonical):

- The canonical generator implementation is `tools/buck/providers/node.ts` (`syncNodeProviders`). The wrapper `tools/buck/sync-providers-node.ts` delegates to it for back‑compat. Prefer invoking the orchestrator: `node tools/buck/sync-providers.ts --lang node`.

Node‑specific note (clarity):

- The Node provider rule accepts `patch_paths` for diagnostics and visibility only. These paths are not used as Buck `srcs` to avoid cross‑package references from `third_party/providers/`. Invalidation for Node patches is achieved by macros adding importer‑local patch files to target `srcs` (see Patching Handbook).

Canonical naming and helpers:

- **Source of truth (TS helpers)**: `tools/lib/providers.ts` defines provider naming. Use `providerNameForModuleKey(importPath, version)` for Go module providers and `providerNameForImporter(lockfilePath, importer)` for Node importer‑scoped providers.
- **Go nixpkgs providers (CGO)**: Go macros do not inject direct provider deps for `nix_cgo_deps`. Instead, they attach `nixpkg:<attr>` labels and rely on `MODULE_PROVIDERS` from `third_party/providers/auto_map.bzl` to map targets to providers (format: `//third_party/providers:nix_<normalized_attr>`; example: `pkgs.openssl` → `nix_pkgs_openssl`). Do not handcraft names.
- **Stamp‑time normalization (Go)**: Go macros stamp `nixpkg:` labels using the shared helper at stamp‑time (via `append_nixpkg_labels`). This only changes where normalization occurs; behavior and mappings are unchanged because the mapper already normalizes.
- **nixpkgs attr map**: The unified orchestrator generates `third_party/providers/nix_attr_map.bzl` deterministically; Starlark macros should load from this mapping instead of deriving attrs heuristically.
- **Patch fixtures**: `tools/tests/lib/fixtures/go.ts: ensurePatch()` creates a correctly named patch file for tests.
- **Starlark nixpkgs stamping (canonical)**: use `lang/defs_common.bzl: append_nixpkg_labels(kwargs, attrs)` to append `nixpkg:<normalized>` labels. Normalization trims, lowercases, ensures the `pkgs.` prefix, and maps `pkgs.gtest` → `pkgs.googletest`. Do not re‑implement label loops in language macros.

#### C++ provider edges (optional, graph‑shape uniformity)

- C++ macros (`nix_cpp_library`, `nix_cpp_binary`) may realize provider edges for diagnostics and cquery introspection by merging `providers_for(MODULE_PROVIDERS, name)` into their `deps`.
- This aligns the exported graph’s shape with Go/Node without changing build artifacts or invalidation semantics.
- How to read it in `buck2 cquery`:
  - `deps(//pkg:target)` will include provider nodes like `//third_party/providers:nix_pkgs_openssl` when the target carries matching `nixpkg:<attr>` labels.
  - These edges are graph‑only; rule keys are unchanged unless provider files themselves change.

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
