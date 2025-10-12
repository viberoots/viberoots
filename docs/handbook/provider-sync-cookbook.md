### Provider sync cookbook

Provider sync maps patch files under `patches/<lang>` to Buck providers used in builds. Keep it deterministic and idempotent.

- **Patch filenames**: `<module path with / → __>@<version>.patch` (dots are preserved).
- **Sync command**: `node tools/buck/sync-providers.ts --out third_party/providers/TARGETS.auto`.
- **Idempotency**: re-running should not change output when inputs are unchanged.
- **Tests**: create a single patch using fixtures and assert stable provider name and paths.

Useful helpers:

- `providerNameForModuleKey("github.com/stretchr/testify", "v1.9.0")` to compute labels.
- `tools/tests/lib/fixtures/go.ts: ensurePatch()` to create a patch with correct filename.
- For nixpkgs providers, use the shared helpers in `tools/lib/providers.ts`:
  - `normalizeNixAttr(attr)` ensures a canonical `pkgs.`-prefixed, lowercased attr (maps `pkgs.gtest` → `pkgs.googletest`).
  - `providerNameForNixAttr(attr)` derives the deterministic provider name (e.g., `pkgs.zlib` → `nix_pkgs_pkgs_zlib`).

### Shared Nix helpers (templates-common)

For Nix templates that need to apply patches or support dev overrides, import the shared helpers once:

```nix
# tools/nix/templates/<lang>.nix
{ pkgs }:
let
  lib = pkgs.lib;
  Common = import ../templates-common.nix { inherit pkgs; };
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
